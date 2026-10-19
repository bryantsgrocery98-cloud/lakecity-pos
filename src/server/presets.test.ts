import { describe, expect, it } from 'vitest';
import { openDb, getSetting } from './db.js';
import { applyDealPresets } from './deal-presets.js';

describe('shelf deal presets', () => {
  it('sets deals on matching items once, never overwriting a hand-set deal', () => {
    const db = openDb(':memory:');
    const ins = db.prepare(`INSERT INTO items (name, size, price_cents, category, authority_id, age_min, color, frequent, qty_on_hand, deal_qty, deal_cents) VALUES (?, ?, ?, 'Snack', NULL, NULL, '#000', 0, 0, ?, ?)`);
    ins.run("Gurley’s Gummy Bears", null, 129, null, null);
    ins.run("Gurley's Natural Pistachios", '2.25 oz', 309, null, null); // price does not match: left alone
    ins.run('Planters Honey Roasted Peanuts', '1', 69, null, null);
    ins.run('Slim Jim small', '0.28 OZ', 49, 3, 100);                      // already has a deal: left alone
    ins.run("Herb's Pickled Hot Sausage", '0.70 Oz', 59, null, null);
    const n = applyDealPresets(db);
    expect(n).toBe(3);
    const rows = db.prepare(`SELECT name, deal_qty q, deal_cents c FROM items ORDER BY id`).all() as { name: string; q: number | null; c: number | null }[];
    expect(rows[0]).toMatchObject({ q: 2, c: 200 });
    expect(rows[1]).toMatchObject({ q: null, c: null });
    expect(rows[2]).toMatchObject({ q: 2, c: 109 });
    expect(rows[3]).toMatchObject({ q: 3, c: 100 });
    expect(rows[4]).toMatchObject({ q: 2, c: 100 });
    expect(getSetting(db, 'deal_presets_applied', '')).toBe('1');
    expect(applyDealPresets(db)).toBe(0); // second run does nothing
  });
});

describe('linking quick buttons to items', () => {
  it('ties a button to the one item with the same name, never to an ambiguous one', async () => {
    const { linkButtonsToItems } = await import('./deal-presets.js');
    const db = openDb(':memory:');
    const item = db.prepare(`INSERT INTO items (name, size, price_cents, category, authority_id, age_min, color, frequent, qty_on_hand) VALUES (?, ?, ?, 'Snack', NULL, NULL, '#000', 0, 0)`);
    item.run('Red Solo Cup', null, 25); item.run('Ice Bag', '10 lb', 249); item.run('Ice Bag', '20 lb', 399);
    db.prepare(`INSERT INTO pages (name, pos) VALUES ('P', 0)`).run();
    const btn = db.prepare(`INSERT INTO buttons (page_id, pos, name, price_cents, price_mode, item_id, authority_id, category, age_min, shape, fill, border, text_color) VALUES (1, ?, ?, ?, 'fixed', NULL, NULL, 'x', NULL, 'box', '#fff', '#000', '#000')`);
    btn.run(0, 'RED SOLO CUP', 25); btn.run(1, 'Ice Bag', 249); btn.run(2, 'Ice Bag 20 lb', 399);
    expect(linkButtonsToItems(db)).toBe(2);
    const rows = db.prepare(`SELECT name, item_id FROM buttons ORDER BY pos`).all() as { name: string; item_id: number | null }[];
    expect(rows[0]!.item_id).toBe(1);
    expect(rows[1]!.item_id).toBeNull(); // two "Ice Bag" items: ambiguous
    expect(rows[2]!.item_id).toBe(3);
    expect(linkButtonsToItems(db)).toBe(0);
  });
});

describe('clearing wrong ID flags', () => {
  it('clears 21+ on sodas and leaves beer and cigarettes alone', async () => {
    const { clearWrongAgeFlags } = await import('./deal-presets.js');
    const db = openDb(':memory:');
    const item = db.prepare(`INSERT INTO items (name, size, price_cents, category, authority_id, age_min, color, frequent, qty_on_hand) VALUES (?, ?, 100, ?, NULL, ?, '#000', 0, 0)`);
    item.run('Coke', '20 oz', 'Drinks', 21); item.run('Natural Light Can', '12 oz', 'Beer', 21); item.run('Newport Box', null, 'Tobacco', 21); item.run('Root Beer', '20 oz', 'Drinks', 21); item.run('Mountain Dew', '20 oz', 'Alcohol', 21);
    expect(clearWrongAgeFlags(db)).toBe(3); // Coke, Root Beer, Mountain Dew (soda wrongly filed under Alcohol)
    const rows = db.prepare(`SELECT name, age_min FROM items ORDER BY id`).all() as { name: string; age_min: number | null }[];
    expect(rows.map((r) => r.age_min)).toEqual([null, 21, 21, null, null]);
    expect(clearWrongAgeFlags(db)).toBe(0);
  });
});

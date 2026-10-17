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

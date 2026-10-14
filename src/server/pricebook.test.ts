import { describe, expect, it } from 'vitest';
import { applyImport, parseCsv, planImport, unwrap } from './pricebook.js';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';

const HEADER = 'Upc,Department,qty,cents,incltaxes,inclfees,Name,size,ebt,byweight,Fee Multiplier,cost_qty,cost_cents,variable_price,addstock,setstock,pack_name,pack_qty,pack_upc,unit_upc,unit_count,is_oneclick,oc_color,oc_border_color,oc_text_color,oc_fixedpos,oc_page,oc_key,oc_relpos';
const row = (o: Record<string, string>) => HEADER.split(',').map((h) => o[h] ?? '').map((v) => (v.includes(',') ? `"${v}"` : v)).join(',');
const sample = [
  HEADER,
  row({ Upc: '="abc|69847"', Department: 'Alcohol 8 %', cents: '749', Name: '6 Pack', setstock: '="0"', is_oneclick: 'y', oc_color: '#c8e6c9', oc_border_color: '#000000', oc_page: 'ICE COLD BEER', oc_key: '6 Pack', oc_relpos: '1', 'Fee Multiplier': '1', cost_cents: '0' }),
  row({ Upc: '="def|69847"', Department: 'Snack, Drinks & Food 1%', cents: '229', Name: 'Pepsi Cola', size: '20 oz', setstock: '="-5"', cost_cents: '120', 'Fee Multiplier': '1' }),
  row({ Upc: '="ghi|69847"', Department: 'Household 8 %', cents: '0', Name: 'Ivory Soap', size: '1', setstock: '="3"', 'Fee Multiplier': '1', cost_cents: '0' }),
  row({ Upc: '="jkl|69847"', Department: 'TAB PAYMENT NO TAX', cents: '0', Name: 'REFUND', setstock: '="0"', is_oneclick: 'y', oc_page: 'Checks & Services', oc_key: 'REFUND', oc_relpos: '1', 'Fee Multiplier': '1', cost_cents: '0' }),
  row({ Upc: '="mno|69847"', Department: 'Checking Service Fee', cents: '0', Name: 'Checking Service Fee', setstock: '="0"', 'Fee Multiplier': '1', cost_cents: '0' }),
  row({ Upc: '="def|69847"', Department: 'Snack, Drinks & Food 1%', cents: '229', Name: 'Pepsi Cola dup', setstock: '="0"', 'Fee Multiplier': '1', cost_cents: '0' }),
].join('\r\n');

describe('price book import', () => {
  it('unwraps Excel ="..." values', () => {
    expect(unwrap('="0"')).toBe('0');
    expect(unwrap(' plain ')).toBe('plain');
  });

  it('parses and plans the store export', () => {
    const rows = parseCsv(sample);
    expect(rows).toHaveLength(6);
    const plan = planImport(rows);
    expect(plan.items.map((i) => i.name)).toEqual(['6 Pack', 'Pepsi Cola', 'Ivory Soap', 'Checking Service Fee']);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['The register has its own button for this', 'Duplicate ID in the file']);
    const pepsi = plan.items[1]!;
    expect(pepsi.size).toBe('20 oz'); expect(pepsi.costCents).toBe(120); expect(pepsi.qtyOnHand).toBe(-5); expect(pepsi.authorityTitle).toBe('Food and Drink');
    const soap = plan.items[2]!;
    expect(soap.size).toBeNull(); expect(soap.warnings[0]).toMatch(/\$0/);
    expect(plan.items[0]!.ageMin).toBe(21);
    expect(plan.items[3]!.priceMode).toBe('ask');
    expect(plan.buttons).toHaveLength(1);
    expect(plan.buttons[0]).toMatchObject({ page: 'ICE COLD BEER', name: '6 Pack', shape: 'six', fill: '#c8e6c9', border: '#000000', ageMin: 21 });
    expect(plan.counts).toMatchObject({ rows: 6, items: 4, buttons: 1, zeroPrice: 1, negativeStock: 1 });
  });

  it('applies the plan, replaces demo items, and updates on re-import', () => {
    const db = openDb(':memory:');
    seedIfEmpty(db);
    const plan = planImport(parseCsv(sample));
    const r1 = applyImport(db, plan, 'Owner', true);
    expect(r1.removedDemo).toBeGreaterThan(50);
    expect(r1.added).toBe(4);
    const items = db.prepare(`SELECT name, external_id, price_cents, qty_on_hand FROM items ORDER BY name`).all() as Record<string, any>[];
    expect(items.every((i) => i.external_id)).toBe(true);
    // service buttons kept
    const names = (db.prepare(`SELECT name FROM buttons ORDER BY name`).all() as { name: string }[]).map((b) => b.name);
    expect(names).toEqual(['6 Pack', 'Check Cashing Fee', 'Non-listed Item']);
    // re-import with a price change updates in place and keeps barcodes
    const id = (db.prepare(`SELECT id FROM items WHERE external_id = 'def|69847'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO barcodes (code, item_id) VALUES ('012000001234', ?)`).run(id);
    const changed = sample.replace('cents: 229', 'x').replace(',229,', ',249,');
    const r2 = applyImport(db, planImport(parseCsv(changed)), 'Owner', false);
    expect(r2.added).toBe(0); expect(r2.updated).toBe(4);
    expect((db.prepare(`SELECT price_cents FROM items WHERE id = ?`).get(id) as { price_cents: number }).price_cents).toBe(249);
    expect(db.prepare(`SELECT 1 FROM barcodes WHERE item_id = ?`).get(id)).toBeTruthy();
    expect((db.prepare(`SELECT COUNT(*) AS n FROM buttons`).get() as { n: number }).n).toBe(3);
  });
});

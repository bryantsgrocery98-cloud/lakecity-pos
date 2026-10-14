import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { openDb, type DB } from './db.js';
import { seedIfEmpty } from './seed.js';
import type { Bootstrap, Receipt } from '../core/types.js';

let server: Server;
let base = '';
let db: DB;
let boot: Bootstrap;

const post = (p: string, body: unknown) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db);
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  boot = (await (await fetch(base + '/api/bootstrap')).json()) as Bootstrap;
});
afterAll(() => { server.close(); });

const item = (name: string) => boot.items.find((i) => i.name === name)!;
const button = (name: string) => boot.pages.flatMap((p) => p.buttons).find((b) => b.name === name)!;

describe('bootstrap', () => {
  it('has the store, five authorities, four pages and demo items', () => {
    expect(boot.store.name).toBe('BRYANTS GROCERY');
    expect(boot.authorities.map((a) => a.title)).toEqual(['Alcohol', 'Food and Drink', 'Grocery All', 'Motor oils', 'Tobacco']);
    expect(boot.pages.map((p) => p.name)).toEqual(['ICE COLD BEER', 'Checks & Services', 'Gas', 'No Code Items']);
    expect(boot.pages[0]!.buttons).toHaveLength(10);
    expect(boot.items.length).toBeGreaterThanOrEqual(55);
  });
});

describe('sales', () => {
  it('prices on the server, ignoring client prices, and splits tax by authority', async () => {
    const res = await post('/api/sales', {
      cashier: 'Dee', discountPct: 0,
      lines: [{ kind: 'item', itemId: item('Cola').id, qty: 1, unitCents: 1 }, { kind: 'item', itemId: item('Nacho Chips').id, qty: 1 }],
      payment: { tender: 'cash', tenderedCents: 1000 },
    });
    expect(res.status).toBe(200);
    const r = (await res.json()) as Receipt;
    expect(r.totals.subtotalCents).toBe(229 + 279);
    expect(r.totals.taxLines).toEqual([{ authorityId: expect.any(Number), title: 'Food and Drink', cents: 5 }]);
    expect(r.payment.changeCents).toBe(1000 - 513);
    expect(r.receiptNo).toMatch(/^R\d{6}$/);
  });

  it('blocks age-restricted items without an ID check', async () => {
    const res = await post('/api/sales', {
      cashier: 'Dee', discountPct: 0, lines: [{ kind: 'item', itemId: item('Cigarettes').id, qty: 1 }],
      payment: { tender: 'cash', tenderedCents: 2000 },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/ID is required/);
  });

  it('accepts a scanned ID pass and rejects a failed one', async () => {
    const line = { kind: 'button', buttonId: button('12 Pack').id, qty: 1 };
    const ok = await post('/api/sales', {
      cashier: 'Dee', discountPct: 0, lines: [line], payment: { tender: 'card', reference: '4242' },
      ageCheck: { method: 'scan', result: 'passed' },
    });
    expect(ok.status).toBe(200);
    const r = (await ok.json()) as Receipt;
    expect(r.totals.totalCents).toBe(1699 + 136);
    const bad = await post('/api/sales', {
      cashier: 'Dee', discountPct: 0, lines: [line], payment: { tender: 'card', reference: '4242' },
      ageCheck: { method: 'scan', result: 'failed' },
    });
    expect(bad.status).toBe(403);
  });

  it('needs a manager PIN for manual birth date entry when Scan ID only is on', async () => {
    const body = (pin?: string) => ({
      cashier: 'Dee', discountPct: 0, lines: [{ kind: 'item', itemId: item('Cigarettes').id, qty: 1 }],
      payment: { tender: 'cash', tenderedCents: 2000 }, ageCheck: { method: 'manual_dob', result: 'passed', managerPin: pin },
    });
    expect((await post('/api/sales', body())).status).toBe(403);
    expect((await post('/api/sales', body('1111'))).status).toBe(403); // cashier PIN is not enough
    expect((await post('/api/sales', body('2222'))).status).toBe(200);
  });

  it('never logs ID details, only the result', () => {
    const rows = db.prepare(`SELECT detail FROM audit_log WHERE action = 'id_check'`).all() as { detail: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.detail).toMatch(/^(scan|manual_dob|manager_override) (passed|failed) \d+\+$/);
  });

  it('rejects short cash and missing card reference', async () => {
    const lines = [{ kind: 'item', itemId: item('Cola').id, qty: 1 }];
    expect((await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines, payment: { tender: 'cash', tenderedCents: 100 } })).status).toBe(400);
    expect((await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines, payment: { tender: 'card' } })).status).toBe(400);
    expect((await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines: [], payment: { tender: 'cash', tenderedCents: 100 } })).status).toBe(400);
  });

  it('rings lottery as quantity x amount with no tax and no discount', async () => {
    const res = await post('/api/sales', {
      cashier: 'Dee', discountPct: 20, lines: [{ kind: 'lottery', qty: 5, unitCents: 100 }],
      payment: { tender: 'cash', tenderedCents: 500 },
    });
    const r = (await res.json()) as Receipt;
    expect(r.lines[0]!.name).toBe('Lottery 5 x $1.00');
    expect(r.totals.totalCents).toBe(500);
    expect(r.totals.taxCents).toBe(0);
  });

  it('requires a price for ask-at-sale buttons', async () => {
    const b = button('Non-listed Item');
    const bad = await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines: [{ kind: 'ask', buttonId: b.id, qty: 1 }], payment: { tender: 'cash', tenderedCents: 500 } });
    expect(bad.status).toBe(400);
    const ok = await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines: [{ kind: 'ask', buttonId: b.id, qty: 1, unitCents: 450 }], payment: { tender: 'cash', tenderedCents: 500 } });
    const r = (await ok.json()) as Receipt;
    expect(r.totals.taxCents).toBe(36); // 8% Grocery All
  });

  it('lowers stock when an item is sold', () => {
    // Cola starts with 12 on hand in the demo data and was sold once above.
    const row = db.prepare(`SELECT qty_on_hand FROM items WHERE id = ?`).get(item('Cola').id) as { qty_on_hand: number };
    expect(row.qty_on_hand).toBe(11);
  });
});

describe('holds, drawer, barcodes, audit', () => {
  it('holds sales with automatic customer numbers and recalls them', async () => {
    const lines = [{ key: 'a', kind: 'item', name: 'Cola', qty: 1, unitCents: 229, authorityId: 2, category: 'Drinks', ageMin: null, itemId: 1 }];
    const a = (await (await post('/api/holds', { cashier: 'Dee', lines, discountPct: 0 })).json()) as { id: number; label: string };
    const b = (await (await post('/api/holds', { cashier: 'Dee', lines, discountPct: 0 })).json()) as { id: number; label: string };
    expect([a.label, b.label]).toEqual(['Customer 1', 'Customer 2']);
    const list = (await (await fetch(base + '/api/holds')).json()) as { id: number }[];
    expect(list).toHaveLength(2);
    expect((await fetch(`${base}/api/holds/${a.id}?cashier=Dee`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}/api/holds/${a.id}?cashier=Dee`, { method: 'DELETE' })).status).toBe(404);
    expect((await post('/api/holds', { cashier: 'Dee', lines: [] })).status).toBe(400);
  });

  it('logs no-sale and can require a manager PIN', async () => {
    expect((await post('/api/no-sale', { cashier: 'Dee' })).status).toBe(200);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('no_sale_requires_pin', 'true')`).run();
    expect((await post('/api/no-sale', { cashier: 'Dee' })).status).toBe(403);
    expect((await post('/api/no-sale', { cashier: 'Dee', pin: '2222' })).status).toBe(200);
    db.prepare(`DELETE FROM settings WHERE key = 'no_sale_requires_pin'`).run();
    const n = (db.prepare(`SELECT COUNT(*) n FROM cash_events WHERE type = 'no_sale'`).get() as { n: number }).n;
    expect(n).toBe(2);
  });

  it('links a barcode once', async () => {
    const target = boot.items.find((i) => !i.hasBarcode)!;
    expect((await post('/api/barcodes/link', { code: '012345678905', itemId: target.id, cashier: 'Dee' })).status).toBe(200);
    expect((await post('/api/barcodes/link', { code: '012345678905', itemId: target.id, cashier: 'Dee' })).status).toBe(409);
    const found = (await (await fetch(base + '/api/scan/012345678905')).json()) as { itemId: number };
    expect(found.itemId).toBe(target.id);
    expect((await fetch(base + '/api/scan/000000000000')).status).toBe(404);
  });

  it('keeps the audit log read-only', () => {
    expect(() => db.prepare(`UPDATE audit_log SET action = 'x'`).run()).toThrow(/cannot be changed/);
    expect(() => db.prepare(`DELETE FROM audit_log`).run()).toThrow(/cannot be changed/);
  });

  it('refuses a tax authority with both a percent and a flat amount', () => {
    expect(() => db.prepare(`INSERT INTO authorities (title, type, rate_bp, flat_cents) VALUES ('Bad', 'tax', 100, 5)`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO authorities (title, type, rate_bp, flat_cents) VALUES ('Bad2', 'tax', NULL, NULL)`).run()).toThrow();
  });

  it('summarises today', async () => {
    const t = (await (await fetch(base + '/api/reports/today')).json()) as { sales: { n: number }; lotterySales: number; noSales: number };
    expect(t.sales.n).toBeGreaterThan(3);
    expect(t.lotterySales).toBe(500);
    expect(t.noSales).toBe(2);
  });

  it('logs in by PIN', async () => {
    expect((await post('/api/login', { pin: '1111' })).status).toBe(200);
    expect((await post('/api/login', { pin: '0000' })).status).toBe(401);
  });
});

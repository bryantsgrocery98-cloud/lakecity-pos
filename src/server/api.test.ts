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

  it('rejects short cash, accepts a card sale with no reference', async () => {
    const lines = [{ kind: 'item', itemId: item('Cola').id, qty: 1 }];
    expect((await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines, payment: { tender: 'cash', tenderedCents: 100 } })).status).toBe(400);
    expect((await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines, payment: { tender: 'card' } })).status).toBe(200);
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

  it('lowers stock when an item is sold', async () => {
    const q = () => (db.prepare(`SELECT qty_on_hand FROM items WHERE id = ?`).get(item('Cola').id) as { qty_on_hand: number }).qty_on_hand;
    const before = q();
    await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines: [{ kind: 'item', itemId: item('Cola').id, qty: 3 }], payment: { tender: 'cash', tenderedCents: 2000 } });
    expect(q()).toBe(before - 3);
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

describe('voids, refunds and the Z report', () => {
  const ring = async (qty = 2) => {
    const res = await post('/api/sales', { cashier: 'Dee', discountPct: 0, lines: [{ kind: 'item', itemId: item('Cola').id, qty }], payment: { tender: 'cash', tenderedCents: 2000 } });
    return (await res.json()) as Receipt;
  };
  const stock = () => (db.prepare(`SELECT qty_on_hand q FROM items WHERE id = ?`).get(item('Cola').id) as { q: number }).q;

  it('voids a sale with a manager PIN, puts stock back, and drops it from the report', async () => {
    const before = stock();
    const r = await ring(2);
    expect(stock()).toBe(before - 2);
    const denied = await post(`/api/sales/${r.receiptNo}/void`, { pin: '1111', cashier: 'Dee', reason: 'wrong item' });
    expect(denied.status).toBe(403);
    const ok = await post(`/api/sales/${r.receiptNo}/void`, { pin: '2222', cashier: 'Dee', reason: 'wrong item' });
    expect(ok.status).toBe(200);
    expect(stock()).toBe(before);
    const again = await post(`/api/sales/${r.receiptNo}/void`, { pin: '2222', cashier: 'Dee', reason: 'x' });
    expect(again.status).toBe(409);
    const list = (await (await fetch(base + '/api/sales')).json()) as { receiptNo: string; voided: boolean }[];
    expect(list.find((s) => s.receiptNo === r.receiptNo)?.voided).toBe(true);
    const day = (await (await fetch(base + '/api/reports/day')).json()) as { voids: { count: number } };
    expect(day.voids.count).toBeGreaterThanOrEqual(1);
  });

  it('refunds part of a sale with proportional tax and refuses over-refunds', async () => {
    const r = await ring(2);
    const list = (await (await fetch(base + '/api/sales')).json()) as { receiptNo: string; lines: { id: number; qty: number }[] }[];
    const lineId = list.find((s) => s.receiptNo === r.receiptNo)!.lines[0]!.id;
    const tooMany = await post(`/api/sales/${r.receiptNo}/refund`, { pin: '2222', cashier: 'Dee', reason: 'bad', lines: [{ id: lineId, qty: 3 }] });
    expect(tooMany.status).toBe(400);
    const one = await post(`/api/sales/${r.receiptNo}/refund`, { pin: '2222', cashier: 'Dee', reason: 'bad', lines: [{ id: lineId, qty: 1 }] });
    expect(one.status).toBe(200);
    const body = (await one.json()) as { totalCents: number; tender: string };
    expect(body.totalCents).toBe(229 + 3); // half of 458, plus half of the 5c tax rounded to 3
    const rest = await post(`/api/sales/${r.receiptNo}/refund`, { pin: '2222', cashier: 'Dee', reason: 'bad', lines: [{ id: lineId, qty: 2 }] });
    expect(rest.status).toBe(400);
    const cannotVoid = await post(`/api/sales/${r.receiptNo}/void`, { pin: '2222', cashier: 'Dee', reason: 'x' });
    expect(cannotVoid.status).toBe(409);
  });

  it('closes the day with a Z report and blocks voids afterwards', async () => {
    const r = await ring(1);
    const z = await post('/api/reports/z', { pin: '3333', cashier: 'Owner', print: false });
    expect(z.status).toBe(200);
    const body = (await z.json()) as { report: { title: string; sales: { count: number }; byCategory: { category: string }[] }; printed: boolean };
    expect(body.report.title).toBe('Z REPORT');
    expect(body.report.sales.count).toBeGreaterThanOrEqual(1);
    expect(body.printed).toBe(false);
    const after = await post(`/api/sales/${r.receiptNo}/void`, { pin: '2222', cashier: 'Dee', reason: 'late' });
    expect(after.status).toBe(409);
  });
});

describe('customer display', () => {
  it('starts idle, mirrors a ticket, and reports the sale result', async () => {
    const get = async () => (await fetch(base + '/api/display')).json() as Promise<Record<string, unknown>>;
    expect((await get()).mode).toBe('idle');
    const r1 = await post('/api/display', { mode: 'ticket', lines: [{ name: 'Coke 20oz', qty: 2, cents: 398 }], subtotalCents: 398, taxCents: 4, totalCents: 402 });
    expect(r1.status).toBe(200);
    const s1 = await get();
    expect(s1.mode).toBe('ticket');
    expect((s1.lines as { name: string }[])[0]!.name).toBe('Coke 20oz');
    expect(s1.totalCents).toBe(402);
    await post('/api/display', { mode: 'paid', totalCents: 402, tender: 'cash', tenderedCents: 500, changeCents: 98 });
    expect((await get()).changeCents).toBe(98);
    await post('/api/display', { mode: 'idle' });
    expect((await get()).mode).toBe('idle');
    const w = (await (await fetch(base + '/api/display/welcome')).json()) as { welcome: string };
    expect(typeof w.welcome).toBe('string');
  });
});

describe('quick add from a scan', () => {
  it('creates the item, links the barcode, and the code scans next time', async () => {
    const r = await post('/api/items/quick', { pin: '2222', cashier: 'Mgr', code: '041570054321', name: 'Test Chips', size: '2.75 oz', priceCents: 199, category: 'Snack', authorityId: boot.authorities[0]!.id, ageMin: null });
    expect(r.status).toBe(200);
    const it = (await r.json()) as { id: number; name: string; hasBarcode: boolean };
    expect(it.name).toBe('Test Chips');
    expect(it.hasBarcode).toBe(true);
    const s = await (await fetch(base + '/api/scan/041570054321')).json() as { itemId: number };
    expect(s.itemId).toBe(it.id);
    const dup = await post('/api/items/quick', { pin: '2222', code: '041570054321', name: 'Again', priceCents: 100, category: 'Snack' });
    expect(dup.status).toBe(409);
    const noPin = await post('/api/items/quick', { pin: '1111', code: '041570099999', name: 'X', priceCents: 100, category: 'Snack' });
    expect(noPin.status).toBe(403);
  });
});

describe('find pictures online', () => {
  it('starts a background job over items with barcodes and no picture', async () => {
    const r = await post('/api/find-images', { pin: '2222', cashier: 'Mgr' });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { total: number; running: boolean };
    expect(j.total).toBeGreaterThan(0); // the quick-added test item has a real-looking barcode
    for (let i = 0; i < 40; i++) {
      const s = (await (await fetch(base + '/api/find-images/status')).json()) as { running: boolean; done: number; total: number };
      if (!s.running) { expect(s.done).toBe(s.total); return; }
      await new Promise((r) => setTimeout(r, 250));
    }
  });
});

describe('gas and check cashing', () => {
  it('rings gas with no tax and settles a cashed check with the fee on the ticket', async () => {
    const gas = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'gas', qty: 1, unitCents: 2500 }], payment: { tender: 'cash', tenderedCents: 2500 } });
    expect(gas.status).toBe(200);
    const g = (await gas.json()) as Receipt;
    expect(g.totals.taxCents).toBe(0);
    expect(g.lines[0]!.name).toBe('Gas');
    expect(g.totals.totalCents).toBe(2500);

    // $500 check, $1 fee: fee on the ticket, $499.00 cash to the customer
    const chk = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'check_fee', qty: 1, unitCents: 100, baseCents: 50000 }], payment: { tender: 'check', tenderedCents: 50000 } });
    expect(chk.status).toBe(200);
    const c = (await chk.json()) as Receipt;
    expect(c.totals.totalCents).toBe(100);
    expect(c.lines[0]!.name).toContain('$500.00');
    expect(c.payment.tender).toBe('check');
    expect(c.payment.changeCents).toBe(49900);

    // a check too small for the ticket is refused
    const bad = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'check_fee', qty: 1, unitCents: 100, baseCents: 100 }, { kind: 'item', itemId: item('Cola').id, qty: 1 }], payment: { tender: 'check', tenderedCents: 100 } });
    expect(bad.status).toBe(400);

    const day = (await (await fetch(base + '/api/reports/day')).json()) as { checks: { count: number; tendered: number; cashOut: number }; byCategory: { category: string; cents: number }[] };
    expect(day.checks.count).toBeGreaterThanOrEqual(1);
    expect(day.byCategory.some((c) => c.category === 'Gas')).toBe(true);
  });
});

describe('deal pricing through the API', () => {
  it('saves a deal on an item and applies it on a sale', async () => {
    const it = item('Cola');
    const r = await post(`/api/items/${it.id}`, { pin: '2222', cashier: 'Mgr', dealQty: 2, dealCents: 300 });
    expect(r.status).toBe(200);
    const saved = (await r.json()) as { dealQty: number; dealCents: number };
    expect(saved.dealQty).toBe(2);
    const sale = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'item', itemId: it.id, qty: 1 }, { kind: 'item', itemId: it.id, qty: 1 }], payment: { tender: 'cash', tenderedCents: 1000 } });
    expect(sale.status).toBe(200);
    const rc = (await sale.json()) as Receipt;
    expect(rc.totals.subtotalCents - rc.totals.discountCents).toBe(300);
    await post(`/api/items/${it.id}`, { pin: '2222', cashier: 'Mgr', dealQty: null, dealCents: null });
  });
});

describe('settings and tax groups', () => {
  it('adds, changes, and removes a tax group; flags mismatched items', async () => {
    const add = await post('/api/authorities', { pin: '2222', cashier: 'Mgr', title: 'Prepared Food', rateBp: 900, flatCents: null });
    expect(add.status).toBe(200);
    const { id } = (await add.json()) as { id: number };
    const st = (await (await fetch(base + '/api/settings')).json()) as { authorities: { id: number; title: string; rateBp: number; inUse: number }[]; checkFeeBp: number };
    const a = st.authorities.find((x) => x.id === id)!;
    expect(a.rateBp).toBe(900);
    expect(a.inUse).toBe(0);
    const ch = await post(`/api/authorities/${id}`, { pin: '2222', cashier: 'Mgr', rateBp: 950 });
    expect(ch.status).toBe(200);
    const dup = await post('/api/authorities', { pin: '2222', title: 'Prepared Food', rateBp: 100 });
    expect(dup.status).toBe(409);
    const del = await post(`/api/authorities/${id}/delete`, { pin: '2222', cashier: 'Mgr' });
    expect(del.status).toBe(200);
    const fee = await post('/api/settings', { pin: '2222', cashier: 'Mgr', checkFeeCents: 200, trackStock: false });
    expect(fee.status).toBe(200);
    const st2 = (await (await fetch(base + '/api/settings')).json()) as { checkFeeCents: number; trackStock: boolean };
    expect(st2.checkFeeCents).toBe(200);
    expect(st2.trackStock).toBe(false);
    await post('/api/settings', { pin: '2222', checkFeeCents: 100, trackStock: true });

    // put a beer under Food and Drink; the checker should flag it
    const beer = boot.items.find((i) => i.name === 'Light Lager')!;
    const food = boot.authorities.find((x) => /food/i.test(x.title))!;
    const alcohol = boot.authorities.find((x) => /alcohol/i.test(x.title))!;
    await post(`/api/items/${beer.id}`, { pin: '2222', cashier: 'Mgr', authorityId: food.id });
    const chk = (await (await fetch(base + '/api/tax-check')).json()) as { items: { id: number; suggestedId: number }[] };
    const flagged = chk.items.find((x) => x.id === beer.id);
    expect(flagged?.suggestedId).toBe(alcohol.id);
    await post(`/api/items/${beer.id}`, { pin: '2222', cashier: 'Mgr', authorityId: alcohol.id });
  });
});

describe('customer tabs', () => {
  it('charges a taxed sale to a tab, takes an untaxed payment, keeps the balance right', async () => {
    const c = (await (await post('/api/customers', { cashier: 'Dee', name: 'Mr. Johnson', phone: '843-555-0100' })).json()) as { id: number; balanceCents: number };
    expect(c.balanceCents).toBe(0);
    const sale = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'item', itemId: item('Cola').id, qty: 2 }], payment: { tender: 'tab', customerId: c.id } });
    expect(sale.status).toBe(200);
    const rc = (await sale.json()) as Receipt;
    expect(rc.payment.tender).toBe('tab');
    expect(rc.payment.customerName).toBe('Mr. Johnson');
    expect(rc.totals.taxCents).toBeGreaterThan(0);
    expect(rc.payment.tabBalanceCents).toBe(rc.totals.totalCents);
    // partial payment, no tax involved
    const pay = await post(`/api/customers/${c.id}/payment`, { cashier: 'Dee', cents: 100, tender: 'cash' });
    expect(pay.status).toBe(200);
    expect(((await pay.json()) as { balanceCents: number }).balanceCents).toBe(rc.totals.totalCents - 100);
    const list = (await (await fetch(base + '/api/customers')).json()) as { id: number; balanceCents: number }[];
    expect(list.find((x) => x.id === c.id)!.balanceCents).toBe(rc.totals.totalCents - 100);
    const hist = (await (await fetch(base + `/api/customers/${c.id}/history`)).json()) as { kind: string }[];
    expect(hist.map((h) => h.kind)).toEqual(['payment', 'charge']);
    // forgive the rest (manager)
    const adj = await post(`/api/customers/${c.id}/adjust`, { pin: '2222', cashier: 'Mgr', cents: -(rc.totals.totalCents - 100), note: 'written off' });
    expect(((await adj.json()) as { balanceCents: number }).balanceCents).toBe(0);
    // the day report shows the charge and the payment separately
    const day = (await (await fetch(base + '/api/reports/day')).json()) as { tabs: { charged: number; paymentsTotal: number } ; tenders: { tender: string; cents: number }[] };
    expect(day.tabs.charged).toBeGreaterThanOrEqual(rc.totals.totalCents);
    expect(day.tabs.paymentsTotal).toBeGreaterThanOrEqual(100);
    expect(day.tenders.some((t) => t.tender === 'Charged to tabs')).toBe(true);
    // unknown customer is refused
    const bad = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'item', itemId: item('Cola').id, qty: 1 }], payment: { tender: 'tab', customerId: 999999 } });
    expect(bad.status).toBe(400);
  });
});

describe('lottery winnings as payment', () => {
  it('pays for the purchase and hands back the rest; counts as a lottery payout', async () => {
    const cola = item('Cola');
    const r = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'item', itemId: cola.id, qty: 1 }, { kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 2000 }], payment: { tender: 'lottery' } });
    expect(r.status).toBe(200);
    const rc = (await r.json()) as Receipt;
    expect(rc.payment.tender).toBe('lottery');
    expect(rc.payment.tenderedCents).toBe(2000);
    expect(rc.payment.changeCents).toBe(2000 - rc.totals.totalCents);
    expect(rc.lines.some((l) => l.name.startsWith('Lottery winnings'))).toBe(true);
    // straight payout with nothing bought
    const r2 = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 500 }], payment: { tender: 'lottery' } });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as Receipt).payment.changeCents).toBe(500);
    // winnings too small
    const bad = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'item', itemId: cola.id, qty: 5 }, { kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 100 }], payment: { tender: 'lottery' } });
    expect(bad.status).toBe(400);
    const day = (await (await fetch(base + '/api/reports/day')).json()) as { lottery: { payouts: number } };
    expect(day.lottery.payouts).toBeGreaterThanOrEqual(2500);
  });
});

describe('quick pages and buttons', () => {
  it('adds an item button to a page, edits, moves and removes it; manages pages', async () => {
    const pg = await post('/api/pages', { pin: '2222', cashier: 'Mgr', name: 'Smokes' });
    expect(pg.status).toBe(200);
    const { id: pageId } = (await pg.json()) as { id: number };
    const cig = boot.items.find((i) => /cigarettes/i.test(i.name))!;
    const b = await post('/api/buttons', { pin: '2222', cashier: 'Mgr', pageId, itemId: cig.id, fill: '#FFE0B2' });
    expect(b.status).toBe(200);
    const { id: btnId } = (await b.json()) as { id: number };
    let bs = (await (await fetch(base + '/api/bootstrap')).json()) as Bootstrap;
    const page = bs.pages.find((p) => p.id === pageId)!;
    expect(page.buttons[0]!.itemId).toBe(cig.id);
    expect(page.buttons[0]!.priceCents).toBe(cig.priceCents);
    expect(page.buttons[0]!.ageMin).toBe(21);
    const e = await post(`/api/buttons/${btnId}`, { pin: '2222', cashier: 'Mgr', name: 'Smokes pack', fill: '#1d5fd1' });
    expect(e.status).toBe(200);
    bs = (await (await fetch(base + '/api/bootstrap')).json()) as Bootstrap;
    const btn = bs.pages.find((p) => p.id === pageId)!.buttons[0]!;
    expect(btn.name).toBe('Smokes pack');
    expect(btn.textColor).toBe('#ffffff'); // dark fill -> white text
    const noDel = await post(`/api/pages/${pageId}/delete`, { pin: '2222', cashier: 'Mgr' });
    expect(noDel.status).toBe(400);
    expect((await post(`/api/buttons/${btnId}/delete`, { pin: '2222', cashier: 'Mgr' })).status).toBe(200);
    expect((await post(`/api/pages/${pageId}/delete`, { pin: '2222', cashier: 'Mgr' })).status).toBe(200);
    expect((await post('/api/buttons', { pin: '1111', pageId: 1, itemId: cig.id })).status).toBe(403);
  });
});

describe('manual item', () => {
  it('rings an amount in a chosen tax group with no ID check', async () => {
    const alcohol = boot.authorities.find((a) => /alcohol/i.test(a.title))!;
    const r = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'manual', qty: 1, unitCents: 1000, authorityId: alcohol.id, category: 'Beer' }], payment: { tender: 'cash', tenderedCents: 2000 } });
    expect(r.status).toBe(200); // no ageCheck sent, still fine
    const rc = (await r.json()) as Receipt;
    expect(rc.totals.taxCents).toBe(80);
    expect(rc.lines[0]!.name).toBe(`Manual item (${alcohol.title})`);
    const nt = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'service', service: 'manual', qty: 1, unitCents: 500, authorityId: null, category: 'Manual' }], payment: { tender: 'cash', tenderedCents: 500 } });
    expect(((await nt.json()) as Receipt).totals.taxCents).toBe(0);
  });
});

describe('lottery winnings smaller than the ticket', () => {
  it('applies the winnings and takes the rest in cash; payouts count only the winnings', async () => {
    const before = (await (await fetch(base + '/api/reports/day')).json()) as { lottery: { payouts: number } };
    const r = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'lottery', qty: 1, unitCents: 1000 }, { kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 500 }], payment: { tender: 'lottery', cashCents: 500 } });
    expect(r.status).toBe(200);
    const rc = (await r.json()) as Receipt;
    expect(rc.payment.tenderedCents).toBe(500);
    expect(rc.payment.cashCents).toBe(500);
    expect(rc.payment.changeCents).toBe(0);
    const after = (await (await fetch(base + '/api/reports/day')).json()) as { lottery: { payouts: number } };
    expect(after.lottery.payouts - before.lottery.payouts).toBe(500);
    // cash given with change
    const r2 = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'lottery', qty: 1, unitCents: 1000 }, { kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 500 }], payment: { tender: 'lottery', cashCents: 2000 } });
    expect(((await r2.json()) as Receipt).payment.changeCents).toBe(1500);
    // not enough
    const bad = await post('/api/sales', { cashier: 'Dee', lines: [{ kind: 'lottery', qty: 1, unitCents: 1000 }, { kind: 'service', service: 'lottery_win', qty: 1, unitCents: 0, baseCents: 500 }], payment: { tender: 'lottery', cashCents: 100 } });
    expect(bad.status).toBe(400);
  });
});

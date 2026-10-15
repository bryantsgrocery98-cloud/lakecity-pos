import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { audit, getSetting, type DB } from './db.js';
import type { Authority } from '../core/tax.js';
import { computeTotals, lotteryLabel, type TicketLine } from '../core/ticket.js';
import { workdayFor } from '../core/workday.js';
import type { createUpdater } from './updater.js';
import { applyImport, fetchImportImages, looksLikePricebook, parseCsv, planImport } from './pricebook.js';
import { drawerBytes, receiptBytes, testBytes, zReportBytes, type ReceiptText } from './escpos.js';
import { listPrinters, listSerialPorts, pulseSerialDrawer, sendToPrinter } from './printer.js';
import { createDisplay, listScreens, openCustomerWindow, type DisplayState } from './display.js';
import { buildDayReport } from './reports.js';
import type {
  AgeCheckInput, Bootstrap, ButtonDto, HoldDto, ItemDto, Receipt, SaleInput, SaleLineInput, StoreDto,
} from '../core/types.js';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type AuthRow = { id: number; title: string; type: 'tax' | 'fee'; rate_bp: number | null; flat_cents: number | null };

function loadAuthorities(db: DB): Authority[] {
  return (db.prepare(`SELECT * FROM authorities ORDER BY title`).all() as AuthRow[])
    .map((r) => ({ id: r.id, title: r.title, type: r.type, rateBp: r.rate_bp, flatCents: r.flat_cents }));
}

function loadStore(db: DB): StoreDto {
  return {
    name: getSetting(db, 'store_name', 'My Store'),
    address: getSetting(db, 'store_address', ''),
    phone: getSetting(db, 'store_phone', ''),
    footer: getSetting(db, 'receipt_footer', ''),
    refundPolicy: getSetting(db, 'refund_policy', ''),
  };
}

function isManagerPin(db: DB, pin: string | undefined): boolean {
  if (!pin) return false;
  const u = db.prepare(`SELECT role FROM users WHERE pin = ? AND active = 1`).get(pin) as { role: string } | undefined;
  return !!u && (u.role === 'manager' || u.role === 'owner');
}

export type AppExtras = { updater?: ReturnType<typeof createUpdater>; version?: string; imagesDir?: string; root?: string; display?: ReturnType<typeof createDisplay> };

export function createApp(db: DB, staticDir?: string, extras: AppExtras = {}) {
  const app = express();
  /** Opens the cash drawer: through its own USB/COM port when one is set, otherwise through the receipt printer. */
  const openDrawer = async (): Promise<void> => {
    const port = getSetting(db, 'drawer_port', '');
    if (port) { await pulseSerialDrawer(port, drawerBytes()); return; }
    const printer = getSetting(db, 'printer_target', '');
    if (!printer) throw new Error('No cash drawer is set up. Pick the drawer port or receipt printer under Manage → Printer.');
    await sendToPrinter({ target: printer }, drawerBytes());
  };
  const receiptText = (): ReceiptText => ({
    headerLines: getSetting(db, 'receipt_header', [getSetting(db, 'store_address', ''), getSetting(db, 'store_phone', '')].filter(Boolean).join('\n')).split('\n'),
    footerLines: getSetting(db, 'receipt_footer', 'Thank you! Please come again.').split('\n'),
    showCashier: getSetting(db, 'receipt_show_cashier', 'false') === 'true',
  });
  app.use(express.json({ limit: '6mb' }));
  const imagesDir = extras.imagesDir ?? path.join(process.cwd(), 'data', 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  app.use('/images', express.static(imagesDir, { maxAge: '1h' }));

  const wrap = (fn: (req: express.Request, res: express.Response) => unknown): express.RequestHandler =>
    (req, res, next) => {
      try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); }
    };

  app.get('/api/bootstrap', wrap((_req, res) => {
    const items = (db.prepare(`
      SELECT i.*, EXISTS(SELECT 1 FROM barcodes b WHERE b.item_id = i.id) AS has_bc
      FROM items i WHERE i.active = 1 ORDER BY i.name, i.size`).all() as Record<string, any>[])
      .map((r): ItemDto => ({
        id: r.id, name: r.name, size: r.size, priceCents: r.price_cents, category: r.category,
        authorityId: r.authority_id, ageMin: r.age_min, color: r.color, frequent: !!r.frequent, hasBarcode: !!r.has_bc, imageVersion: r.image_version,
      }));
    const pages = (db.prepare(`SELECT id, name FROM pages ORDER BY pos`).all() as { id: number; name: string }[])
      .map((p) => ({
        ...p,
        buttons: (db.prepare(`SELECT * FROM buttons WHERE page_id = ? ORDER BY pos`).all(p.id) as Record<string, any>[])
          .map((b): ButtonDto => ({
            id: b.id, name: b.name, priceCents: b.price_cents, priceMode: b.price_mode, authorityId: b.authority_id,
            category: b.category, ageMin: b.age_min, shape: b.shape, fill: b.fill, border: b.border, textColor: b.text_color,
          })),
      }));
    const body: Bootstrap = {
      store: loadStore(db),
      settings: {
        discountButtons: getSetting(db, 'discount_buttons', '5,10,15,20').split(',').map(Number).filter((n) => n > 0 && n < 100),
        warnQty: parseInt(getSetting(db, 'warn_qty', '99'), 10),
        warnTotalCents: parseInt(getSetting(db, 'warn_total_cents', '99999'), 10),
        scanIdOnly: getSetting(db, 'scan_id_only', 'true') === 'true',
      },
      authorities: loadAuthorities(db),
      pages,
      items,
      holdCount: (db.prepare(`SELECT COUNT(*) AS n FROM holds`).get() as { n: number }).n,
      version: extras.version ?? '0',
    };
    res.json(body);
  }));

  app.post('/api/login', wrap((req, res) => {
    const u = db.prepare(`SELECT name, role FROM users WHERE pin = ? AND active = 1`).get(String(req.body?.pin ?? '')) as
      { name: string; role: string } | undefined;
    if (!u) throw new HttpError(401, 'That PIN did not match. Try again.');
    audit(db, u.name, 'login');
    res.json(u);
  }));

  app.get('/api/scan/:code', wrap((req, res) => {
    // Scanners differ on leading zeros (UPC-A as 12 or 13 digits, EAN-8/UPC-E as 8), so try the common forms.
    const raw = String(req.params.code).trim();
    const forms = [raw];
    if (/^\d+$/.test(raw)) {
      if (raw.length === 13 && raw.startsWith('0')) forms.push(raw.slice(1));
      if (raw.length === 12) forms.push('0' + raw);
      if (raw.length === 11) forms.push('0' + raw);
      forms.push(raw.replace(/^0+/, ''));
    }
    let row: { item_id: number } | undefined;
    for (const f of forms) { row = db.prepare(`SELECT item_id FROM barcodes WHERE code = ?`).get(f) as typeof row; if (row) break; }
    if (!row) throw new HttpError(404, 'Barcode not found.');
    res.json({ itemId: row.item_id });
  }));

  app.post('/api/barcodes/link', wrap((req, res) => {
    const { code, itemId, cashier } = req.body ?? {};
    if (typeof code !== 'string' || !/^[0-9A-Za-z\-]{4,64}$/.test(code)) throw new HttpError(400, 'That barcode looks wrong.');
    if (!db.prepare(`SELECT 1 FROM items WHERE id = ? AND active = 1`).get(itemId)) throw new HttpError(400, 'Pick an item first.');
    if (db.prepare(`SELECT 1 FROM barcodes WHERE code = ?`).get(code)) throw new HttpError(409, 'That barcode is already linked to an item.');
    db.prepare(`INSERT INTO barcodes (code, item_id) VALUES (?, ?)`).run(code, itemId);
    audit(db, String(cashier ?? 'unknown'), 'barcode_linked', `item ${itemId}`);
    res.json({ ok: true });
  }));

  // ---------- sales ----------
  app.post('/api/sales', wrap((req, res) => {
    const input = req.body as SaleInput;
    if (!input || !Array.isArray(input.lines) || input.lines.length === 0) throw new HttpError(400, 'The ticket is empty.');
    const discountPct = Number.isInteger(input.discountPct) && input.discountPct >= 0 && input.discountPct < 100 ? input.discountPct : 0;
    const authorities = loadAuthorities(db);
    const lines = input.lines.map((l, i) => buildLine(db, l, i));
    const { totals, perLine } = computeTotals(lines, authorities, discountPct);

    if (totals.ageRequired !== null) checkAge(db, input.ageCheck, input.cashier, totals.ageRequired);

    const pay = input.payment;
    if (!pay || (pay.tender !== 'cash' && pay.tender !== 'card')) throw new HttpError(400, 'Choose how the customer is paying.');
    let tendered: number | null = null;
    let change: number | null = null;
    let reference: string | null = null;
    if (pay.tender === 'cash') {
      tendered = Number.isInteger(pay.tenderedCents) ? (pay.tenderedCents as number) : 0;
      if (tendered < totals.totalCents) throw new HttpError(400, 'The cash given is less than the total.');
      change = tendered - totals.totalCents;
    } else {
      // The card machine runs the charge on its own; the register only records that the sale was paid by card.
      reference = String(pay.reference ?? '').trim().slice(0, 16) || null;
    }

    const now = new Date();
    const workday = workdayFor(now, getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
    const store = loadStore(db);

    const receipt = db.transaction((): Receipt => {
      const r = db.prepare(`INSERT INTO sales (receipt_no, created_at, workday, cashier, subtotal_cents, discount_cents, tax_cents, total_cents, discount_pct, age_check)
        VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(now.toISOString(), workday, input.cashier, totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents,
          discountPct, input.ageCheck ? `${input.ageCheck.method}:${input.ageCheck.result}` : null);
      const saleId = Number(r.lastInsertRowid);
      const receiptNo = `R${String(saleId).padStart(6, '0')}`;
      db.prepare(`UPDATE sales SET receipt_no = ? WHERE id = ?`).run(receiptNo, saleId);

      const insLine = db.prepare(`INSERT INTO sale_lines (sale_id, name, kind, qty, unit_cents, gross_cents, discount_cents, tax_cents, authority_id, category, age_min)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const decStock = db.prepare(`UPDATE items SET qty_on_hand = qty_on_hand - ? WHERE id = ? AND qty_on_hand > 0`);
      lines.forEach((l, i) => {
        const p = perLine[i]!;
        insLine.run(saleId, l.name, l.kind, l.qty, l.unitCents, p.grossCents, p.discountCents, p.taxCents, l.authorityId, l.category, l.ageMin);
        if (l.itemId) decStock.run(l.qty, l.itemId);
      });
      const insTax = db.prepare(`INSERT INTO sale_tax (sale_id, authority_id, title, cents) VALUES (?, ?, ?, ?)`);
      for (const t of totals.taxLines) insTax.run(saleId, t.authorityId, t.title, t.cents);
      db.prepare(`INSERT INTO payments (sale_id, tender, amount_cents, tendered_cents, change_cents, reference) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(saleId, pay.tender, totals.totalCents, tendered, change, reference);
      audit(db, input.cashier, 'sale', `${receiptNo} total ${totals.totalCents} ${pay.tender}`);

      return {
        receiptNo, createdAt: now.toISOString(), cashier: input.cashier, store,
        lines: lines.map((l, i) => ({ name: l.name, qty: l.qty, unitCents: l.unitCents, grossCents: perLine[i]!.grossCents, discountCents: perLine[i]!.discountCents })),
        totals,
        payment: { tender: pay.tender, amountCents: totals.totalCents, tenderedCents: tendered, changeCents: change, reference },
      };
    })();

    res.json(receipt);
    // After the sale: kick the drawer on cash, and print a receipt if that's turned on. Never block the sale on the printer.
    const printer = getSetting(db, 'printer_target', '');
    const kick = pay.tender === 'cash' && getSetting(db, 'drawer_kick', 'true') === 'true';
    const auto = getSetting(db, 'print_receipts', 'false') === 'true';
    const viaPrinter = !getSetting(db, 'drawer_port', '');
    if (kick && !viaPrinter) openDrawer().catch((e) => console.log(`[drawer] ${(e as Error).message}`));
    if (printer && ((kick && viaPrinter) || auto)) {
      const bytes = auto ? receiptBytes(receipt, { kickDrawer: kick && viaPrinter, text: receiptText() }) : drawerBytes();
      sendToPrinter({ target: printer }, bytes).catch((e) => console.log(`[printer] ${(e as Error).message}`));
    }
  }));

  // ---------- printing ----------
  app.get('/api/printer', wrap(async (_req, res) => {
    const t = receiptText();
    res.json({ target: getSetting(db, 'printer_target', ''), printReceipts: getSetting(db, 'print_receipts', 'false') === 'true',
      drawerKick: getSetting(db, 'drawer_kick', 'true') === 'true', available: await listPrinters(),
      drawerPort: getSetting(db, 'drawer_port', ''), serialPorts: await listSerialPorts(),
      storeName: getSetting(db, 'store_name', ''), header: t.headerLines.join('\n'), footer: t.footerLines.join('\n'), showCashier: t.showCashier });
  }));
  app.post('/api/printer', wrap((req, res) => {
    const { pin, cashier, target, printReceipts, drawerKick, drawerPort, storeName, header, footer, showCashier } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed.');
    const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const changes: string[] = [];
    if (target !== undefined) { set.run('printer_target', String(target).trim().slice(0, 120)); changes.push('printer'); }
    if (printReceipts !== undefined) { set.run('print_receipts', printReceipts ? 'true' : 'false'); changes.push(`auto receipts ${printReceipts ? 'on' : 'off'}`); }
    if (drawerKick !== undefined) { set.run('drawer_kick', drawerKick ? 'true' : 'false'); changes.push(`drawer kick ${drawerKick ? 'on' : 'off'}`); }
    if (drawerPort !== undefined) { set.run('drawer_port', String(drawerPort).trim().slice(0, 40)); changes.push(`drawer port ${String(drawerPort).trim() || 'printer'}`); }
    if (storeName !== undefined) {
      if (!String(storeName).trim()) throw new HttpError(400, 'The store name cannot be blank.');
      set.run('store_name', String(storeName).trim().slice(0, 40)); changes.push('store name');
    }
    if (header !== undefined) { set.run('receipt_header', String(header).slice(0, 400)); changes.push('receipt header'); }
    if (footer !== undefined) { set.run('receipt_footer', String(footer).slice(0, 400)); changes.push('receipt footer'); }
    if (showCashier !== undefined) { set.run('receipt_show_cashier', showCashier ? 'true' : 'false'); changes.push('cashier on receipt'); }
    if (changes.length) audit(db, String(cashier ?? ''), 'settings', changes.join(', '));
    res.json({ ok: true });
  }));
  app.post('/api/printer/test', wrap(async (req, res) => {
    const target = String(req.body?.target ?? getSetting(db, 'printer_target', ''));
    await sendToPrinter({ target }, testBytes(getSetting(db, 'store_name', 'POS')));
    res.json({ ok: true });
  }));
  app.post('/api/printer/drawer', wrap(async (req, res) => {
    if (!isManagerPin(db, req.body?.pin) && getSetting(db, 'no_sale_requires_pin', 'false') === 'true') throw new HttpError(403, 'A manager PIN is needed.');
    await openDrawer();
    res.json({ ok: true });
  }));
  app.post('/api/sales/:receiptNo/print', wrap(async (req, res) => {
    const r = loadReceipt(db, String(req.params.receiptNo));
    if (!r) throw new HttpError(404, 'Receipt not found.');
    await sendToPrinter({ target: getSetting(db, 'printer_target', '') }, receiptBytes(r, { text: receiptText() }));
    res.json({ ok: true });
  }));

  // ---------- sales lookup, voids, refunds ----------
  app.get('/api/sales', wrap((req, res) => {
    const q = String(req.query.q ?? '').trim();
    const workday = workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
    const rows = (q
      ? db.prepare(`SELECT * FROM sales WHERE receipt_no LIKE ? ORDER BY id DESC LIMIT 50`).all(`%${q.toUpperCase().replace(/^R?0*/, '')}%`)
      : db.prepare(`SELECT * FROM sales WHERE workday = ? ORDER BY id DESC LIMIT 100`).all(workday)) as Record<string, any>[];
    res.json(rows.map((r) => ({
      receiptNo: r.receipt_no, createdAt: r.created_at, cashier: r.cashier, totalCents: r.total_cents, voided: !!r.voided_at, voidReason: r.void_reason,
      tender: (db.prepare(`SELECT tender FROM payments WHERE sale_id = ?`).get(r.id) as { tender: string } | undefined)?.tender ?? '',
      refundedCents: (db.prepare(`SELECT COALESCE(SUM(total_cents),0) c FROM refunds WHERE sale_id = ?`).get(r.id) as { c: number }).c,
      lines: (db.prepare(`SELECT id, name, qty, unit_cents, gross_cents, discount_cents, tax_cents, category, authority_id FROM sale_lines WHERE sale_id = ?`).all(r.id) as Record<string, any>[])
        .map((l) => ({ id: l.id, name: l.name, qty: l.qty, unitCents: l.unit_cents, grossCents: l.gross_cents, discountCents: l.discount_cents, taxCents: l.tax_cents, category: l.category,
          refundedQty: (db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM refund_lines WHERE sale_line_id = ?`).get(l.id) as { q: number }).q })),
    })));
  }));

  app.post('/api/sales/:receiptNo/void', wrap((req, res) => {
    const { pin, cashier, reason } = req.body ?? {};
    const manager = managerName(db, pin);
    if (!manager) throw new HttpError(403, 'A manager PIN is needed to void a sale.');
    const why = String(reason ?? '').trim();
    if (!why) throw new HttpError(400, 'Give a reason for the void.');
    const sale = db.prepare(`SELECT * FROM sales WHERE receipt_no = ?`).get(String(req.params.receiptNo)) as Record<string, any> | undefined;
    if (!sale) throw new HttpError(404, 'Receipt not found.');
    if (sale.voided_at) throw new HttpError(409, 'That sale is already voided.');
    if (sale.workday_closed) throw new HttpError(409, 'That workday is closed. Use a refund instead.');
    if ((db.prepare(`SELECT COUNT(*) n FROM refunds WHERE sale_id = ?`).get(sale.id) as { n: number }).n) throw new HttpError(409, 'That sale has refunds. Refund the rest instead of voiding.');
    db.transaction(() => {
      db.prepare(`UPDATE sales SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`).run(new Date().toISOString(), manager, why.slice(0, 200), sale.id);
      // Put stock back.
      for (const l of db.prepare(`SELECT name, qty, kind FROM sale_lines WHERE sale_id = ? AND kind = 'item'`).all(sale.id) as { name: string; qty: number }[]) {
        db.prepare(`UPDATE items SET qty_on_hand = qty_on_hand + ? WHERE (CASE WHEN size IS NULL THEN name ELSE name || ' ' || size END) = ?`).run(l.qty, l.name);
      }
      audit(db, String(cashier ?? ''), 'void_sale', `${sale.receipt_no} ${formatMoney(sale.total_cents)} by ${manager}: ${why}`);
    })();
    res.json({ ok: true });
  }));

  app.post('/api/sales/:receiptNo/refund', wrap((req, res) => {
    const { pin, cashier, reason, lines } = req.body as { pin?: string; cashier?: string; reason?: string; lines?: { id: number; qty: number }[] };
    const manager = managerName(db, pin);
    if (!manager) throw new HttpError(403, 'A manager PIN is needed to refund.');
    const why = String(reason ?? '').trim();
    if (!why) throw new HttpError(400, 'Give a reason for the refund.');
    if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, 'Pick what is being refunded.');
    const sale = db.prepare(`SELECT * FROM sales WHERE receipt_no = ?`).get(String(req.params.receiptNo)) as Record<string, any> | undefined;
    if (!sale) throw new HttpError(404, 'Receipt not found.');
    if (sale.voided_at) throw new HttpError(409, 'That sale was voided.');
    const tender = (db.prepare(`SELECT tender FROM payments WHERE sale_id = ?`).get(sale.id) as { tender: string }).tender;
    const now = new Date();
    const workday = workdayFor(now, getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
    let subtotal = 0, tax = 0;
    const planned: { line: Record<string, any>; qty: number; cents: number; taxCents: number }[] = [];
    for (const req of lines) {
      const l = db.prepare(`SELECT * FROM sale_lines WHERE id = ? AND sale_id = ?`).get(req.id, sale.id) as Record<string, any> | undefined;
      if (!l) throw new HttpError(400, 'A line does not belong to that sale.');
      const already = (db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM refund_lines WHERE sale_line_id = ?`).get(l.id) as { q: number }).q;
      const qty = Math.floor(Number(req.qty));
      if (!Number.isInteger(qty) || qty < 1 || qty > l.qty - already) throw new HttpError(400, `${l.name}: only ${l.qty - already} can still be refunded.`);
      const net = l.gross_cents - l.discount_cents;
      const cents = Math.round(net * qty / l.qty);
      const taxCents = Math.round(l.tax_cents * qty / l.qty);
      subtotal += cents; tax += taxCents;
      planned.push({ line: l, qty, cents, taxCents });
    }
    const total = subtotal + tax;
    db.transaction(() => {
      const r = db.prepare(`INSERT INTO refunds (sale_id, created_at, workday, cashier, manager, reason, tender, subtotal_cents, tax_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sale.id, now.toISOString(), workday, String(cashier ?? ''), manager, why.slice(0, 200), tender, subtotal, tax, total);
      for (const p of planned) {
        db.prepare(`INSERT INTO refund_lines (refund_id, sale_line_id, name, qty, cents, tax_cents, category, authority_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.lastInsertRowid, p.line.id, p.line.name, p.qty, p.cents, p.taxCents, p.line.category, p.line.authority_id);
        if (p.line.kind === 'item') db.prepare(`UPDATE items SET qty_on_hand = qty_on_hand + ? WHERE (CASE WHEN size IS NULL THEN name ELSE name || ' ' || size END) = ?`).run(p.qty, p.line.name);
      }
      audit(db, String(cashier ?? ''), 'refund', `${sale.receipt_no} ${formatMoney(total)} ${tender} by ${manager}: ${why}`);
    })();
    if (tender === 'cash' && getSetting(db, 'drawer_kick', 'true') === 'true') openDrawer().catch((e) => console.log(`[drawer] ${(e as Error).message}`));
    res.json({ ok: true, totalCents: total, tender });
  }));

  // ---------- X / Z reports ----------
  app.get('/api/reports/day', wrap((req, res) => {
    const workday = String(req.query.workday ?? workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00')));
    const closed = db.prepare(`SELECT closed_at, cashier FROM z_reports WHERE workday = ? ORDER BY id DESC LIMIT 1`).get(workday) as { closed_at: string; cashier: string } | undefined;
    res.json({ ...buildDayReport(db, workday, String(req.query.cashier ?? ''), closed ? 'Z REPORT (closed)' : 'X REPORT'), closed: closed ?? null });
  }));
  app.post('/api/reports/z', wrap(async (req, res) => {
    const { pin, cashier, print } = req.body ?? {};
    const manager = managerName(db, pin);
    if (!manager) throw new HttpError(403, 'A manager PIN is needed to close the day.');
    const workday = workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
    const report = buildDayReport(db, workday, manager, 'Z REPORT');
    db.transaction(() => {
      db.prepare(`INSERT INTO z_reports (workday, closed_at, cashier, report_json) VALUES (?, ?, ?, ?)`).run(workday, new Date().toISOString(), manager, JSON.stringify(report));
      db.prepare(`UPDATE sales SET workday_closed = 1 WHERE workday = ?`).run(workday);
      audit(db, String(cashier ?? ''), 'z_report', `${workday} total ${formatMoney(report.sales.total)} by ${manager}`);
    })();
    let printed = false, printError = '';
    if (print && getSetting(db, 'printer_target', '')) {
      try { await sendToPrinter({ target: getSetting(db, 'printer_target', '') }, zReportBytes(report, getSetting(db, 'store_name', 'POS'), { items: true })); printed = true; }
      catch (e) { printError = (e as Error).message; }
    }
    res.json({ report, printed, printError });
  }));
  app.post('/api/reports/print', wrap(async (req, res) => {
    const workday = String(req.body?.workday ?? workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00')));
    const closed = db.prepare(`SELECT 1 FROM z_reports WHERE workday = ?`).get(workday);
    const report = buildDayReport(db, workday, String(req.body?.cashier ?? ''), closed ? 'Z REPORT (reprint)' : 'X REPORT');
    await sendToPrinter({ target: getSetting(db, 'printer_target', '') }, zReportBytes(report, getSetting(db, 'store_name', 'POS'), { items: !!req.body?.items }));
    res.json({ ok: true });
  }));

  // ---------- holds ----------
  app.get('/api/holds', wrap((_req, res) => {
    const rows = db.prepare(`SELECT * FROM holds ORDER BY id`).all() as Record<string, any>[];
    res.json(rows.map((r): HoldDto => ({
      id: r.id, label: r.label, cashier: r.cashier, createdAt: r.created_at, discountPct: r.discount_pct, lines: JSON.parse(r.lines_json),
    })));
  }));

  app.post('/api/holds', wrap((req, res) => {
    const { label, lines, discountPct, cashier } = req.body ?? {};
    if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'There is nothing to hold.');
    let name = typeof label === 'string' ? label.trim().slice(0, 40) : '';
    if (!name) {
      const labels = db.prepare(`SELECT label FROM holds`).all() as { label: string }[];
      const max = labels.reduce((m, r) => Math.max(m, Number(/^Customer (\d+)$/.exec(r.label)?.[1] ?? 0)), 0);
      name = `Customer ${max + 1}`;
    }
    const r = db.prepare(`INSERT INTO holds (label, lines_json, discount_pct, cashier, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(name, JSON.stringify(lines), Number(discountPct) || 0, String(cashier ?? ''), new Date().toISOString());
    audit(db, String(cashier ?? ''), 'hold', name);
    res.json({ id: Number(r.lastInsertRowid), label: name });
  }));

  app.delete('/api/holds/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT label FROM holds WHERE id = ?`).get(req.params.id) as { label: string } | undefined;
    if (!row) throw new HttpError(404, 'That held sale is already gone.');
    db.prepare(`DELETE FROM holds WHERE id = ?`).run(req.params.id);
    audit(db, String(req.query.cashier ?? ''), 'recall', row.label);
    res.json({ ok: true });
  }));

  // ---------- drawer and cash events ----------
  app.post('/api/no-sale', wrap((req, res) => {
    const { cashier, pin } = req.body ?? {};
    if (getSetting(db, 'no_sale_requires_pin', 'false') === 'true' && !isManagerPin(db, pin)) {
      throw new HttpError(403, 'A manager PIN is needed to open the drawer without a sale.');
    }
    db.prepare(`INSERT INTO cash_events (ts, cashier, type, amount_cents) VALUES (?, ?, 'no_sale', 0)`)
      .run(new Date().toISOString(), String(cashier ?? ''));
    audit(db, String(cashier ?? ''), 'no_sale');
    // Open the drawer through the receipt printer. The event is logged either way.
    if (!getSetting(db, 'drawer_port', '') && !getSetting(db, 'printer_target', '')) { res.json({ ok: true, drawer: 'no-printer' }); return; }
    openDrawer()
      .then(() => res.json({ ok: true, drawer: 'opened' }))
      .catch((e) => { console.log(`[printer] ${(e as Error).message}`); res.json({ ok: true, drawer: 'failed', message: (e as Error).message }); });
  }));

  app.post('/api/lottery-payout', wrap((req, res) => {
    const { cashier, amountCents } = req.body ?? {};
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10_000_000) throw new HttpError(400, 'Enter the payout amount.');
    db.prepare(`INSERT INTO cash_events (ts, cashier, type, amount_cents) VALUES (?, ?, 'lottery_payout', ?)`)
      .run(new Date().toISOString(), String(cashier ?? ''), amountCents);
    audit(db, String(cashier ?? ''), 'lottery_payout', String(amountCents));
    res.json({ ok: true });
  }));

  const CLIENT_AUDIT = new Set(['void_ticket', 'id_check_refused', 'id_check_passed', 'sale_cancelled']);
  app.post('/api/audit', wrap((req, res) => {
    const { cashier, action, detail } = req.body ?? {};
    if (!CLIENT_AUDIT.has(action)) throw new HttpError(400, 'Unknown action.');
    audit(db, String(cashier ?? ''), action, String(detail ?? '').slice(0, 200));
    res.json({ ok: true });
  }));

  // ---------- items and inventory ----------
  const itemRow = (r: Record<string, any>) => ({
    id: r.id, name: r.name, size: r.size, priceCents: r.price_cents, costCents: r.cost_cents, category: r.category,
    authorityId: r.authority_id, ageMin: r.age_min, qtyOnHand: r.qty_on_hand, active: !!r.active, frequent: !!r.frequent,
    color: r.color, imageVersion: r.image_version, barcodes: r.codes ? String(r.codes).split(' ') : [],
  });
  const ITEM_SQL = `SELECT i.*, (SELECT GROUP_CONCAT(code, ' ') FROM barcodes b WHERE b.item_id = i.id) AS codes FROM items i`;

  app.get('/api/items', wrap((_req, res) => {
    res.json((db.prepare(`${ITEM_SQL} ORDER BY i.name, i.size`).all() as Record<string, any>[]).map(itemRow));
  }));

  const categories = () => (db.prepare(`SELECT DISTINCT category FROM items ORDER BY category`).all() as { category: string }[]).map((c) => c.category);
  app.get('/api/categories', wrap((_req, res) => res.json(categories())));

  type ItemBody = { pin?: string; cashier?: string; name?: string; size?: string | null; priceCents?: number; costCents?: number | null;
    category?: string; authorityId?: number | null; ageMin?: number | null; qtyOnHand?: number; frequent?: boolean; active?: boolean; reason?: string };

  function validateItem(b: ItemBody, partial: boolean) {
    const out: Record<string, unknown> = {};
    if (b.name !== undefined || !partial) {
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, 'Give the item a name.');
      out.name = name.slice(0, 80);
    }
    if (b.size !== undefined) out.size = b.size ? String(b.size).trim().slice(0, 40) : null;
    if (b.priceCents !== undefined || !partial) {
      const p = b.priceCents ?? 0;
      if (!Number.isInteger(p) || p < 0 || p > 10_000_000) throw new HttpError(400, 'That price is not valid.');
      out.price_cents = p;
    }
    if (b.costCents !== undefined) {
      if (b.costCents !== null && (!Number.isInteger(b.costCents) || b.costCents < 0)) throw new HttpError(400, 'That cost is not valid.');
      out.cost_cents = b.costCents;
    }
    if (b.category !== undefined || !partial) {
      const c = String(b.category ?? '').trim();
      if (!c) throw new HttpError(400, 'Pick a category.');
      out.category = c.slice(0, 40);
    }
    if (b.authorityId !== undefined) {
      if (b.authorityId !== null && !db.prepare(`SELECT 1 FROM authorities WHERE id = ?`).get(b.authorityId)) throw new HttpError(400, 'That tax does not exist.');
      out.authority_id = b.authorityId;
    }
    if (b.ageMin !== undefined) {
      if (b.ageMin !== null && (!Number.isInteger(b.ageMin) || b.ageMin < 1 || b.ageMin > 99)) throw new HttpError(400, 'That minimum age is not valid.');
      out.age_min = b.ageMin;
    }
    if (b.qtyOnHand !== undefined) {
      if (!Number.isInteger(b.qtyOnHand) || b.qtyOnHand < -100_000 || b.qtyOnHand > 1_000_000) throw new HttpError(400, 'That stock count is not valid.');
      out.qty_on_hand = b.qtyOnHand;
    }
    if (b.frequent !== undefined) out.frequent = b.frequent ? 1 : 0;
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    return out;
  }

  app.post('/api/items', wrap((req, res) => {
    const b = req.body as ItemBody;
    if (!isManagerPin(db, b.pin)) throw new HttpError(403, 'A manager PIN is needed to add items.');
    const v = validateItem(b, false);
    const cols = Object.keys(v);
    const r = db.prepare(`INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => v[c]));
    audit(db, String(b.cashier ?? ''), 'item_add', String(v.name));
    res.json(itemRow(db.prepare(`${ITEM_SQL} WHERE i.id = ?`).get(r.lastInsertRowid) as Record<string, any>));
  }));

  app.post('/api/items/:id', wrap((req, res) => {
    const b = req.body as ItemBody;
    if (!isManagerPin(db, b.pin)) throw new HttpError(403, 'A manager PIN is needed to change items.');
    const id = Number(req.params.id);
    const cur = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as Record<string, any> | undefined;
    if (!cur) throw new HttpError(404, 'That item no longer exists.');
    const v = validateItem(b, true);
    const cols = Object.keys(v);
    if (cols.length) {
      db.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), id);
      const changes = cols.filter((c) => String(cur[c]) !== String(v[c])).map((c) => `${c} ${cur[c]} -> ${v[c]}`);
      if (changes.length) audit(db, String(b.cashier ?? ''), 'item_edit', `${cur.name}: ${changes.join(', ')}${b.reason ? ` (${String(b.reason).slice(0, 80)})` : ''}`);
    }
    res.json(itemRow(db.prepare(`${ITEM_SQL} WHERE i.id = ?`).get(id) as Record<string, any>));
  }));

  app.post('/api/items/:id/barcodes', wrap((req, res) => {
    const { pin, cashier, code } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed.');
    const id = Number(req.params.id);
    if (typeof code !== 'string' || !/^[0-9A-Za-z\-]{4,64}$/.test(code)) throw new HttpError(400, 'That barcode looks wrong.');
    if (!db.prepare(`SELECT 1 FROM items WHERE id = ?`).get(id)) throw new HttpError(404, 'That item no longer exists.');
    const owner = db.prepare(`SELECT i.name FROM barcodes b JOIN items i ON i.id = b.item_id WHERE b.code = ?`).get(code) as { name: string } | undefined;
    if (owner) throw new HttpError(409, `That barcode already belongs to ${owner.name}.`);
    db.prepare(`INSERT INTO barcodes (code, item_id) VALUES (?, ?)`).run(code, id);
    audit(db, String(cashier ?? ''), 'barcode_linked', `item ${id} ${code}`);
    res.json({ ok: true });
  }));

  app.delete('/api/items/:id/barcodes/:code', wrap((req, res) => {
    if (!isManagerPin(db, String(req.query.pin ?? ''))) throw new HttpError(403, 'A manager PIN is needed.');
    db.prepare(`DELETE FROM barcodes WHERE code = ? AND item_id = ?`).run(req.params.code, Number(req.params.id));
    audit(db, String(req.query.cashier ?? ''), 'barcode_unlinked', `item ${req.params.id} ${req.params.code}`);
    res.json({ ok: true });
  }));

  // Image upload: the screen already shrinks the picture to about 480px, sent as a JPEG data URL.
  app.post('/api/items/:id/image', wrap((req, res) => {
    const { pin, cashier, dataUrl } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed.');
    const id = Number(req.params.id);
    const cur = db.prepare(`SELECT image_version FROM items WHERE id = ?`).get(id) as { image_version: number } | undefined;
    if (!cur) throw new HttpError(404, 'That item no longer exists.');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
    if (!m) throw new HttpError(400, 'That picture could not be read.');
    const buf = Buffer.from(m[1]!, 'base64');
    if (buf.length > 1_500_000) throw new HttpError(400, 'That picture is too big.');
    fs.writeFileSync(path.join(imagesDir, `${id}.jpg`), buf);
    const version = cur.image_version + 1;
    db.prepare(`UPDATE items SET image_version = ? WHERE id = ?`).run(version, id);
    audit(db, String(cashier ?? ''), 'item_image', `item ${id}`);
    res.json({ ok: true, imageVersion: version });
  }));

  app.delete('/api/items/:id/image', wrap((req, res) => {
    if (!isManagerPin(db, String(req.query.pin ?? ''))) throw new HttpError(403, 'A manager PIN is needed.');
    const id = Number(req.params.id);
    fs.rmSync(path.join(imagesDir, `${id}.jpg`), { force: true });
    db.prepare(`UPDATE items SET image_version = 0 WHERE id = ?`).run(id);
    res.json({ ok: true });
  }));

  // ---------- price book import ----------
  const importBody = express.json({ limit: '20mb' });
  app.post('/api/import/pricebook/preview', importBody, wrap((req, res) => {
    const { pin, csv } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed to import.');
    const rows = parseCsv(String(csv ?? ''));
    if (!rows.length || !looksLikePricebook(Object.keys(rows[0]!))) throw new HttpError(400, 'That file does not look like the price book export (Upc, Department, cents, Name…).');
    const plan = planImport(rows);
    const demoCount = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE external_id IS NULL`).get() as { n: number }).n;
    const existing = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE external_id IS NOT NULL`).get() as { n: number }).n;
    res.json({ counts: plan.counts, warnings: plan.warnings.slice(0, 200), skipped: plan.skipped, pages: plan.pages, demoCount, existing,
      sample: plan.items.slice(0, 8).map((i) => ({ name: i.name, size: i.size, priceCents: i.priceCents, category: i.category, authority: i.authorityTitle, qty: i.qtyOnHand })) });
  }));
  app.post('/api/import/pricebook', importBody, wrap((req, res) => {
    const { pin, csv, cashier, replaceDemo } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed to import.');
    const rows = parseCsv(String(csv ?? ''));
    if (!rows.length || !looksLikePricebook(Object.keys(rows[0]!))) throw new HttpError(400, 'That file does not look like the price book export.');
    const result = applyImport(db, planImport(rows), String(cashier ?? ''), !!replaceDemo);
    const { pendingImages, ...summary } = result;
    // Pictures download in the background; the inventory page shows them as they land.
    imageJob = { total: pendingImages.length, done: 0, ok: 0, running: pendingImages.length > 0 };
    if (pendingImages.length) {
      fetchImportImages(db, imagesDir, pendingImages, (d) => { imageJob.done = d; })
        .then((ok) => { imageJob.ok = ok; imageJob.running = false; })
        .catch(() => { imageJob.running = false; });
    }
    res.json(summary);
  }));
  let imageJob = { total: 0, done: 0, ok: 0, running: false };
  app.get('/api/import/images/status', wrap((_req, res) => res.json(imageJob)));

  // ---------- version and activity (the screen reloads itself after an update; the updater waits while a ticket is open) ----------
  app.get('/api/version', (_req, res) => { res.json({ version: extras.version ?? '0' }); });

  // ---------- customer display ----------
  const display = extras.display ?? createDisplay();
  app.get('/api/display', (_req, res) => { res.json(display.get()); });
  app.get('/api/display/events', (_req, res) => { display.subscribe(res); });
  app.post('/api/display', wrap((req, res) => {
    const b = (req.body ?? {}) as Partial<DisplayState>;
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200).map((l) => ({ name: String(l.name ?? '').slice(0, 60), qty: Number(l.qty) || 1, cents: Number(l.cents) || 0 })) : [];
    display.set({ mode: b.mode === 'ticket' || b.mode === 'paid' ? b.mode : 'idle', lines,
      subtotalCents: Number(b.subtotalCents) || 0, taxCents: Number(b.taxCents) || 0, discountCents: Number(b.discountCents) || 0, totalCents: Number(b.totalCents) || 0,
      tender: b.tender === 'cash' || b.tender === 'card' ? b.tender : undefined, tenderedCents: Number(b.tenderedCents) || undefined, changeCents: Number(b.changeCents) || 0 });
    res.json({ ok: true, viewers: display.clientCount() });
  }));
  app.get('/api/display/settings', wrap(async (_req, res) => {
    res.json({ enabled: getSetting(db, 'customer_display', 'true') === 'true', welcome: getSetting(db, 'display_welcome', 'Welcome!'),
      screens: await listScreens(), viewers: display.clientCount(), storeName: getSetting(db, 'store_name', '') });
  }));
  app.post('/api/display/settings', wrap((req, res) => {
    const { pin, cashier, enabled, welcome } = req.body ?? {};
    if (!isManagerPin(db, pin)) throw new HttpError(403, 'A manager PIN is needed.');
    const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    if (enabled !== undefined) set.run('customer_display', enabled ? 'true' : 'false');
    if (welcome !== undefined) set.run('display_welcome', String(welcome).slice(0, 80));
    audit(db, String(cashier ?? ''), 'settings', 'customer display');
    res.json({ ok: true });
  }));
  app.post('/api/display/open', wrap(async (req, res) => {
    const url = `http://localhost:${req.socket.localPort}/customer`;
    res.json({ message: await openCustomerWindow(extras.root ?? process.cwd(), url) });
  }));
  app.get('/api/display/welcome', (_req, res) => { res.json({ welcome: getSetting(db, 'display_welcome', 'Welcome!'), storeName: getSetting(db, 'store_name', '') }); });
  app.post('/api/activity', wrap((req, res) => {
    const open = !!req.body?.ticketOpen;
    extras.updater?.setBusy(open);
    res.json({ ok: true });
  }));

  // ---------- updates ----------
  app.get('/api/update/status', wrap((_req, res) => {
    res.json(extras.updater ? extras.updater.status() : { current: extras.version ?? '0', latest: null, state: 'idle', message: 'Auto-update is off.', checkedAt: null, source: '' });
  }));
  app.post('/api/update/check', wrap(async (req, res) => {
    if (!isManagerPin(db, req.body?.pin)) throw new HttpError(403, 'A manager PIN is needed.');
    if (!extras.updater) throw new HttpError(400, 'Auto-update is off.');
    res.json(await extras.updater.check(true));
  }));

  // ---------- quick daily summary ----------
  app.get('/api/reports/today', wrap((_req, res) => {
    const workday = workdayFor(new Date(), getSetting(db, 'timezone', 'America/New_York'), getSetting(db, 'workday_start', '00:00'));
    const one = <T,>(sql: string) => db.prepare(sql).get(workday) as T;
    const all = <T,>(sql: string) => db.prepare(sql).all(workday) as T[];
    res.json({
      workday,
      sales: one<{ n: number; total: number; tax: number }>(
        `SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) total, COALESCE(SUM(tax_cents),0) tax FROM sales WHERE workday = ? AND voided_at IS NULL`),
      byCategory: all<{ category: string; cents: number }>(
        `SELECT category, SUM(gross_cents - discount_cents) cents FROM sale_lines WHERE sale_id IN (SELECT id FROM sales WHERE workday = ? AND voided_at IS NULL) GROUP BY category ORDER BY cents DESC`),
      byAuthority: all<{ title: string; cents: number }>(
        `SELECT title, SUM(cents) cents FROM sale_tax WHERE sale_id IN (SELECT id FROM sales WHERE workday = ? AND voided_at IS NULL) GROUP BY title ORDER BY title`),
      noSales: one<{ n: number }>(
        `SELECT COUNT(*) n FROM cash_events WHERE type = 'no_sale' AND ts >= (SELECT COALESCE(MIN(created_at), '9') FROM sales WHERE workday = ?)`).n,
      lotterySales: one<{ cents: number }>(
        `SELECT COALESCE(SUM(gross_cents),0) cents FROM sale_lines WHERE kind = 'lottery' AND sale_id IN (SELECT id FROM sales WHERE workday = ?)`).cents,
    });
  }));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // Friendly errors only. Never send a stack trace to the register screen.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

function managerName(db: DB, pin: string | undefined): string | null {
  if (!pin) return null;
  const u = db.prepare(`SELECT name, role FROM users WHERE pin = ? AND active = 1`).get(pin) as { name: string; role: string } | undefined;
  return u && (u.role === 'manager' || u.role === 'owner') ? u.name : null;
}
function formatMoney(c: number): string { return `$${(c / 100).toFixed(2)}`; }

function loadReceipt(db: DB, receiptNo: string): Receipt | null {
  const s = db.prepare(`SELECT * FROM sales WHERE receipt_no = ?`).get(receiptNo) as Record<string, any> | undefined;
  if (!s) return null;
  const lines = db.prepare(`SELECT * FROM sale_lines WHERE sale_id = ?`).all(s.id) as Record<string, any>[];
  const taxLines = db.prepare(`SELECT authority_id, title, cents FROM sale_tax WHERE sale_id = ?`).all(s.id) as { authority_id: number; title: string; cents: number }[];
  const pay = db.prepare(`SELECT * FROM payments WHERE sale_id = ?`).get(s.id) as Record<string, any>;
  return {
    receiptNo: s.receipt_no, createdAt: s.created_at, cashier: s.cashier, store: loadStore(db),
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, unitCents: l.unit_cents, grossCents: l.gross_cents, discountCents: l.discount_cents })),
    totals: { subtotalCents: s.subtotal_cents, discountCents: s.discount_cents, taxCents: s.tax_cents, totalCents: s.total_cents,
      taxLines: taxLines.map((t) => ({ authorityId: t.authority_id, title: t.title, cents: t.cents })), ageRequired: null },
    payment: { tender: pay.tender, amountCents: pay.amount_cents, tenderedCents: pay.tendered_cents, changeCents: pay.change_cents, reference: pay.reference },
  };
}

function buildLine(db: DB, l: SaleLineInput, i: number): TicketLine {
  if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 10_000) throw new HttpError(400, 'A quantity on the ticket is not valid.');
  const key = `L${i}`;
  if (l.kind === 'item') {
    const r = db.prepare(`SELECT * FROM items WHERE id = ? AND active = 1`).get(l.itemId) as Record<string, any> | undefined;
    if (!r) throw new HttpError(400, 'An item on the ticket no longer exists.');
    const name = r.size ? `${r.name} ${r.size}` : r.name;
    return { key, kind: 'item', name, qty: l.qty, unitCents: r.price_cents, authorityId: r.authority_id, category: r.category,
      ageMin: r.age_min, feeMultiplier: r.fee_multiplier, itemId: r.id };
  }
  if (l.kind === 'button' || l.kind === 'ask') {
    const b = db.prepare(`SELECT * FROM buttons WHERE id = ?`).get(l.buttonId) as Record<string, any> | undefined;
    if (!b) throw new HttpError(400, 'A button on the ticket no longer exists.');
    let unit = b.price_cents;
    if (b.price_mode === 'ask') {
      if (!Number.isInteger(l.unitCents) || (l.unitCents as number) <= 0 || (l.unitCents as number) > 10_000_000) throw new HttpError(400, 'Enter a price for that item.');
      unit = l.unitCents;
    }
    return { key, kind: b.price_mode === 'ask' ? 'ask' : 'button', name: b.name, qty: l.qty, unitCents: unit,
      authorityId: b.authority_id, category: b.category, ageMin: b.age_min, buttonId: b.id };
  }
  if (l.kind === 'lottery') {
    if (!Number.isInteger(l.unitCents) || (l.unitCents as number) <= 0 || (l.unitCents as number) > 100_000) throw new HttpError(400, 'Enter the lottery amount.');
    return { key, kind: 'lottery', name: lotteryLabel(l.qty, l.unitCents as number), qty: l.qty, unitCents: l.unitCents as number,
      authorityId: null, category: 'Lottery', ageMin: null };
  }
  throw new HttpError(400, 'Unknown line type.');
}

function checkAge(db: DB, check: AgeCheckInput | undefined, cashier: string, minAge: number): void {
  if (!check) throw new HttpError(403, `ID is required: this ticket has items for ${minAge}+.`);
  if (check.result !== 'passed') throw new HttpError(403, 'The ID check did not pass. Remove the age-restricted items to continue.');
  const needsPin = check.method === 'manager_override' ||
    (check.method === 'manual_dob' && getSetting(db, 'scan_id_only', 'true') === 'true');
  if (needsPin && !isManagerPin(db, check.managerPin)) throw new HttpError(403, 'A manager PIN is needed for that kind of ID check.');
  // Only the result is logged. No name, address, license number, or barcode text is ever stored.
  audit(db, cashier, 'id_check', `${check.method} ${check.result} ${minAge}+`);
}

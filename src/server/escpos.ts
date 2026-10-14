// ESC/POS formatting for 80mm thermal receipt printers (Rongta RP326 and most Epson-compatible models).
// Builds raw bytes; sending them to the printer is in printer.ts.

import { formatCents } from '../core/money.js';
import type { Receipt } from '../core/types.js';

const ESC = 0x1b, GS = 0x1d;
export const COLS = 48; // characters per line at the default font on 80mm paper. NEEDS VERIFICATION per printer (42 on some).

export class EscPos {
  private parts: Buffer[] = [];
  constructor(private cols = COLS) { this.raw([ESC, 0x40]); } // initialize
  raw(bytes: number[] | Buffer) { this.parts.push(Buffer.from(bytes)); return this; }
  text(s: string) { this.parts.push(Buffer.from(s.replace(/[^\x20-\x7e\n]/g, '?'), 'latin1')); return this; }
  line(s = '') { return this.text(s + '\n'); }
  align(a: 'left' | 'center' | 'right') { return this.raw([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]); }
  bold(on: boolean) { return this.raw([ESC, 0x45, on ? 1 : 0]); }
  size(w: 1 | 2, h: 1 | 2) { return this.raw([GS, 0x21, ((w - 1) << 4) | (h - 1)]); }
  feed(n = 1) { return this.raw([ESC, 0x64, n]); }
  cut() { return this.feed(3).raw([GS, 0x56, 0x42, 0x00]); } // partial cut
  /** Open the cash drawer. Pulses both drawer pins with a long pulse so any wiring works. */
  drawer() { return this.raw(drawerBytes()); }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  /** Two columns: left text and right-aligned value on one line. */
  row(left: string, right: string) {
    const r = right.slice(0, this.cols - 1);
    const maxL = this.cols - r.length - 1;
    const l = left.length > maxL ? left.slice(0, maxL) : left;
    return this.line(l + ' '.repeat(Math.max(1, this.cols - l.length - r.length)) + r);
  }
  bytes(): Buffer { return Buffer.concat(this.parts); }
}

/** ESC p m t1 t2: drawer kick on pin 2 then pin 5, 200 ms on / 500 ms off. Works with the Rongta RP326 and most drawers. */
export function drawerBytes(): Buffer {
  return Buffer.from([ESC, 0x70, 0x00, 0x64, 0xfa, ESC, 0x70, 0x01, 0x64, 0xfa]);
}

export type ReceiptText ={ headerLines: string[]; footerLines: string[]; showCashier: boolean };

export function receiptBytes(r: Receipt, opts: { kickDrawer?: boolean; cols?: number; text?: ReceiptText } = {}): Buffer {
  const p = new EscPos(opts.cols);
  if (opts.kickDrawer) p.drawer();
  const text = opts.text ?? { headerLines: [r.store.address, r.store.phone].filter(Boolean), footerLines: [r.store.footer].filter(Boolean), showCashier: false };
  p.align('center').bold(true).size(2, 2).line(r.store.name).size(1, 1).bold(false);
  for (const h of text.headerLines) if (h.trim()) p.line(h.trim());
  p.line('').align('left');
  const when = new Date(r.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  p.row(`Receipt ${r.receiptNo}`, when);
  if (text.showCashier) p.row(`Cashier: ${r.cashier}`, '');
  p.rule();
  for (const l of r.lines) {
    const amount = formatCents(l.grossCents - l.discountCents);
    if (l.qty === 1) p.row(l.name, amount);
    else { p.line(l.name); p.row(`  ${l.qty} @ ${formatCents(l.unitCents)}`, amount); }
    if (l.discountCents) p.row('  discount', `-${formatCents(l.discountCents)}`);
  }
  p.rule();
  p.row('Subtotal', formatCents(r.totals.subtotalCents));
  if (r.totals.discountCents) p.row('Discount', `-${formatCents(r.totals.discountCents)}`);
  for (const t of r.totals.taxLines) p.row(t.title, formatCents(t.cents));
  p.bold(true).size(1, 2).row('TOTAL', formatCents(r.totals.totalCents)).size(1, 1).bold(false);
  p.rule();
  if (r.payment.tender === 'cash') {
    p.row('Cash', formatCents(r.payment.tenderedCents ?? r.totals.totalCents));
    p.row('Change', formatCents(r.payment.changeCents ?? 0));
  } else {
    p.row('Card', formatCents(r.payment.amountCents));
    if (r.payment.reference) p.row('Ref', r.payment.reference);
  }
  p.line('').align('center');
  for (const f of text.footerLines) if (f.trim()) p.line(f.trim());
  p.cut();
  return p.bytes();
}

export function testBytes(storeName: string): Buffer {
  const p = new EscPos();
  p.align('center').bold(true).size(2, 2).line(storeName).size(1, 1).bold(false);
  p.line('Printer test').line(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  p.rule().align('left');
  p.line('If you can read this, the register can print.');
  p.row('Left column', 'Right column');
  p.row('Ruler (48 cols)', '12345678');
  p.rule('=');
  p.cut();
  return p.bytes();
}

export type ZReport = {
  title: string; workday: string; from: string; to: string; cashier: string;
  sales: { count: number; subtotal: number; discount: number; tax: number; total: number };
  voids: { count: number; total: number }; refunds: { count: number; total: number };
  byCategory: { category: string; qty: number; cents: number }[];
  byAuthority: { title: string; cents: number }[];
  tenders: { tender: string; cents: number; count: number }[];
  lottery: { sales: number; payouts: number }; noSales: number;
  items: { name: string; qty: number; cents: number }[];
};

export function zReportBytes(z: ZReport, storeName: string, opts: { items?: boolean } = {}): Buffer {
  const p = new EscPos();
  p.align('center').bold(true).size(2, 2).line(storeName).size(1, 2).line(z.title).size(1, 1).bold(false);
  p.line(`Workday ${z.workday}`).line(`Printed ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`).line(`By ${z.cashier}`);
  p.rule('=').align('left');
  p.bold(true).line('SALES').bold(false);
  p.row('Tickets', String(z.sales.count));
  p.row('Subtotal', formatCents(z.sales.subtotal));
  if (z.sales.discount) p.row('Discounts', `-${formatCents(z.sales.discount)}`);
  p.row('Tax', formatCents(z.sales.tax));
  p.bold(true).row('Total taken', formatCents(z.sales.total)).bold(false);
  if (z.voids.count) p.row(`Voided tickets (${z.voids.count})`, `-${formatCents(z.voids.total)}`);
  if (z.refunds.count) p.row(`Refunds (${z.refunds.count})`, `-${formatCents(z.refunds.total)}`);
  p.rule();
  p.bold(true).line('BY DEPARTMENT (before tax)').bold(false);
  for (const c of z.byCategory) p.row(`${c.category} (${c.qty})`, formatCents(c.cents));
  p.rule();
  p.bold(true).line('TAX BY AUTHORITY').bold(false);
  for (const a of z.byAuthority) p.row(a.title, formatCents(a.cents));
  p.rule();
  p.bold(true).line('TENDERS').bold(false);
  for (const t of z.tenders) p.row(`${t.tender} (${t.count})`, formatCents(t.cents));
  p.rule();
  p.row('Lottery sales', formatCents(z.lottery.sales));
  p.row('Lottery payouts', `-${formatCents(z.lottery.payouts)}`);
  p.row('No Sale opens', String(z.noSales));
  if (opts.items && z.items.length) {
    p.rule();
    p.bold(true).line('ITEMS SOLD').bold(false);
    for (const it of z.items) p.row(`${it.qty} x ${it.name}`, formatCents(it.cents));
  }
  p.rule('=');
  p.align('center').line('For filing prep only. Verify tax rates with SC DOR.');
  p.cut();
  return p.bytes();
}

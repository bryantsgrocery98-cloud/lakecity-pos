// X and Z reports for one workday. Voided sales are excluded from every total; refunds are listed separately.
import { audit, type DB } from './db.js';
import type { ZReport } from './escpos.js';

export function buildDayReport(db: DB, workday: string, cashier: string, title: string): ZReport {
  const one = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
  const all = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];
  const live = `SELECT id FROM sales WHERE workday = ? AND voided_at IS NULL`;

  const sales = one<{ n: number; subtotal: number; discount: number; tax: number; total: number; from: string | null; to: string | null }>(
    `SELECT COUNT(*) n, COALESCE(SUM(subtotal_cents),0) subtotal, COALESCE(SUM(discount_cents),0) discount, COALESCE(SUM(tax_cents),0) tax,
            COALESCE(SUM(total_cents),0) total, MIN(created_at) "from", MAX(created_at) "to" FROM sales WHERE workday = ? AND voided_at IS NULL`, workday);
  const voids = one<{ n: number; total: number }>(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) total FROM sales WHERE workday = ? AND voided_at IS NOT NULL`, workday);
  const refunds = one<{ n: number; total: number }>(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) total FROM refunds WHERE workday = ?`, workday);
  const byCategory = all<{ category: string; qty: number; cents: number }>(
    `SELECT category, SUM(qty) qty, SUM(gross_cents - discount_cents) cents FROM sale_lines WHERE kind != 'lottery' AND sale_id IN (${live}) GROUP BY category ORDER BY cents DESC`, workday);
  const byAuthority = all<{ title: string; cents: number }>(
    `SELECT title, SUM(cents) cents FROM sale_tax WHERE sale_id IN (${live}) GROUP BY title ORDER BY title`, workday);
  const tenders = all<{ tender: string; cents: number; count: number }>(
    `SELECT tender, SUM(amount_cents) cents, COUNT(*) count FROM payments WHERE sale_id IN (${live}) GROUP BY tender ORDER BY tender`, workday);
  const lotterySales = one<{ c: number }>(`SELECT COALESCE(SUM(gross_cents),0) c FROM sale_lines WHERE kind = 'lottery' AND sale_id IN (${live})`, workday).c;
  const dayStart = sales.from ?? `${workday}T00:00:00`;
  const payouts = one<{ c: number }>(`SELECT COALESCE(SUM(amount_cents),0) c FROM cash_events WHERE type = 'lottery_payout' AND substr(ts,1,10) = ?`, workday).c
    + one<{ c: number }>(`SELECT COALESCE(SUM(tendered_cents),0) c FROM payments WHERE tender = 'lottery' AND sale_id IN (${live})`, workday).c;
  const noSales = one<{ n: number }>(`SELECT COUNT(*) n FROM cash_events WHERE type = 'no_sale' AND substr(ts,1,10) = ?`, workday).n;
  // Checks taken in and the cash handed back for them (so the drawer count works out).
  // Tab payments received today (money in that is not a sale), and what was charged to tabs.
  const tabPay = all<{ tender: string; cents: number; count: number }>(`SELECT tender, SUM(cents) cents, COUNT(*) count FROM tab_entries WHERE kind = 'payment' AND workday = ? GROUP BY tender`, workday);
  const tabCharged = one<{ c: number; n: number }>(`SELECT COALESCE(SUM(cents),0) c, COUNT(*) n FROM tab_entries WHERE kind = 'charge' AND workday = ?`, workday);
  const tabOwed = one<{ c: number }>(`SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN -cents ELSE cents END),0) c FROM tab_entries`);
  const checks = one<{ n: number; tendered: number; cashOut: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(tendered_cents),0) tendered, COALESCE(SUM(change_cents),0) cashOut FROM payments WHERE tender = 'check' AND sale_id IN (${live})`, workday);
  const items = all<{ name: string; qty: number; cents: number }>(
    `SELECT name, SUM(qty) qty, SUM(gross_cents - discount_cents) cents FROM sale_lines WHERE sale_id IN (${live}) GROUP BY name ORDER BY cents DESC, name`, workday);
  void dayStart;
  return {
    title, workday, from: sales.from ?? '', to: sales.to ?? '', cashier,
    sales: { count: sales.n, subtotal: sales.subtotal, discount: sales.discount, tax: sales.tax, total: sales.total },
    voids: { count: voids.n, total: voids.total }, refunds: { count: refunds.n, total: refunds.total },
    byCategory, byAuthority, tenders: tenders.map((t) => ({ ...t, tender: t.tender === 'cash' ? 'Cash' : t.tender === 'check' ? 'Checks cashed' : t.tender === 'tab' ? 'Charged to tabs' : t.tender === 'lottery' ? 'Paid with lottery winnings' : 'Card' })),
    lottery: { sales: lotterySales, payouts }, noSales, items,
    checks: { count: checks.n, tendered: checks.tendered, cashOut: checks.cashOut },
    tabs: { charged: tabCharged.c, chargedCount: tabCharged.n, payments: tabPay.map((t) => ({ tender: t.tender, cents: t.cents, count: t.count })), paymentsTotal: tabPay.reduce((a, t) => a + t.cents, 0), owedTotal: tabOwed.c },
  };
}

/**
 * Closes every earlier workday that still has open sales, so each day starts from zero without anyone
 * remembering to run the Z. Returns the reports it closed (the caller may print them).
 */
export function autoCloseWorkdays(db: DB, currentWorkday: string): ZReport[] {
  const open = db.prepare(
    `SELECT DISTINCT workday FROM sales WHERE workday < ? AND workday NOT IN (SELECT workday FROM z_reports) ORDER BY workday`).all(currentWorkday) as { workday: string }[];
  const out: ZReport[] = [];
  for (const { workday } of open) {
    const report = buildDayReport(db, workday, 'Auto close', 'Z REPORT');
    db.transaction(() => {
      db.prepare(`INSERT INTO z_reports (workday, closed_at, cashier, report_json) VALUES (?, ?, ?, ?)`).run(workday, new Date().toISOString(), 'Auto close', JSON.stringify(report));
      db.prepare(`UPDATE sales SET workday_closed = 1 WHERE workday = ?`).run(workday);
      audit(db, 'system', 'z_report', `${workday} total $${(report.sales.total / 100).toFixed(2)} (closed automatically at end of day)`);
    })();
    out.push(report);
  }
  return out;
}

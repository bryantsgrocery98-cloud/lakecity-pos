// X and Z reports for one workday. Voided sales are excluded from every total; refunds are listed separately.
import type { DB } from './db.js';
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
  const payouts = one<{ c: number }>(`SELECT COALESCE(SUM(amount_cents),0) c FROM cash_events WHERE type = 'lottery_payout' AND substr(ts,1,10) = ?`, workday).c;
  const noSales = one<{ n: number }>(`SELECT COUNT(*) n FROM cash_events WHERE type = 'no_sale' AND substr(ts,1,10) = ?`, workday).n;
  // Checks taken in and the cash handed back for them (so the drawer count works out).
  const checks = one<{ n: number; tendered: number; cashOut: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(tendered_cents),0) tendered, COALESCE(SUM(change_cents),0) cashOut FROM payments WHERE tender = 'check' AND sale_id IN (${live})`, workday);
  const items = all<{ name: string; qty: number; cents: number }>(
    `SELECT name, SUM(qty) qty, SUM(gross_cents - discount_cents) cents FROM sale_lines WHERE sale_id IN (${live}) GROUP BY name ORDER BY cents DESC, name`, workday);
  void dayStart;
  return {
    title, workday, from: sales.from ?? '', to: sales.to ?? '', cashier,
    sales: { count: sales.n, subtotal: sales.subtotal, discount: sales.discount, tax: sales.tax, total: sales.total },
    voids: { count: voids.n, total: voids.total }, refunds: { count: refunds.n, total: refunds.total },
    byCategory, byAuthority, tenders: tenders.map((t) => ({ ...t, tender: t.tender === 'cash' ? 'Cash' : t.tender === 'check' ? 'Checks cashed' : 'Card' })),
    lottery: { sales: lotterySales, payouts }, noSales, items,
    checks: { count: checks.n, tendered: checks.tendered, cashOut: checks.cashOut },
  };
}

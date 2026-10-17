import { percentOfCents } from './money.js';
import { Authority, authorityAmountCents } from './tax.js';

export type LineKind = 'item' | 'button' | 'ask' | 'lottery' | 'service';
export type ServiceId = 'gas' | 'check_fee' | 'lottery_win' | 'manual';

export type TicketLine = {
  /** Unique id inside the ticket (not a database id). */
  key: string;
  kind: LineKind;
  name: string;
  qty: number;
  unitCents: number;
  authorityId: number | null;
  category: string;
  /** Minimum age to buy this line, or null. */
  ageMin: number | null;
  feeMultiplier?: number;
  itemId?: number | null;
  buttonId?: number | null;
  /** Multi-buy deal on the item, e.g. 2 for $1.00: dealQty = 2, dealCents = 100. */
  dealQty?: number | null;
  dealCents?: number | null;
  /** Built-in services (gas, check cashing). */
  service?: ServiceId;
  /** For a check-cashing fee: the amount of the check the fee was figured from. */
  baseCents?: number;
};

/** "Check cashing (check $500.00)" — the fee itself is whatever the cashier charged. */
export function checkFeeLabel(checkCents: number): string {
  return `Check cashing (check $${(checkCents / 100).toFixed(2)})`;
}

export type TaxLine = { authorityId: number; title: string; cents: number };

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  taxLines: TaxLine[];
  taxCents: number;
  totalCents: number;
  /** Strictest age rule on the ticket, or null if nothing is age-restricted. */
  ageRequired: number | null;
};

export type LineTotals = { key: string; grossCents: number; discountCents: number; netCents: number; taxCents: number };

/**
 * Totals for a ticket. discountPct is a whole-percent ticket discount (5, 10, 15, 20)
 * applied to each line before tax. Lottery lines are never discounted.
 */
export function computeTotals(
  lines: TicketLine[],
  authorities: Authority[],
  discountPct = 0,
): { totals: Totals; perLine: LineTotals[] } {
  const byId = new Map(authorities.map((a) => [a.id, a]));
  const taxMap = new Map<number, number>();
  const perLine: LineTotals[] = [];
  let subtotal = 0;
  let discount = 0;
  let ageRequired: number | null = null;

  const dealSavings = dealSavingsByLine(lines);
  for (const l of lines) {
    const gross = l.unitCents * l.qty;
    const deal = dealSavings.get(l.key) ?? 0;
    const pct = l.kind === 'lottery' || l.kind === 'service' || discountPct <= 0 ? 0 : percentOfCents(gross - deal, discountPct * 100);
    const d = deal + pct;
    const net = gross - d;
    const authority = l.authorityId === null ? undefined : byId.get(l.authorityId);
    const tax = authorityAmountCents(authority, net, l.qty, l.feeMultiplier ?? 1);
    if (authority && tax !== 0) taxMap.set(authority.id, (taxMap.get(authority.id) ?? 0) + tax);
    subtotal += gross;
    discount += d;
    perLine.push({ key: l.key, grossCents: gross, discountCents: d, netCents: net, taxCents: tax });
    if (l.ageMin !== null && (ageRequired === null || l.ageMin > ageRequired)) ageRequired = l.ageMin;
  }

  const taxLines: TaxLine[] = [...taxMap.entries()]
    .map(([authorityId, cents]) => ({ authorityId, title: byId.get(authorityId)!.title, cents }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const taxCents = taxLines.reduce((s, t) => s + t.cents, 0);

  return {
    totals: {
      subtotalCents: subtotal,
      discountCents: discount,
      taxLines,
      taxCents,
      totalCents: subtotal - discount + taxCents,
      ageRequired,
    },
    perLine,
  };
}

/**
 * Multi-buy deals ("2 for $1.00"). The same item may sit on several lines; its total quantity across the
 * ticket is grouped into full deals, the rest stays at the unit price. The saving is spread over that
 * item's lines in order, so each line's net is never negative.
 */
export function dealSavingsByLine(lines: TicketLine[]): Map<string, number> {
  const out = new Map<string, number>();
  const groups = new Map<number, TicketLine[]>();
  for (const l of lines) {
    if (l.kind !== 'item' || !l.itemId || !l.dealQty || l.dealQty < 2 || l.dealCents === null || l.dealCents === undefined) continue;
    if (!groups.has(l.itemId)) groups.set(l.itemId, []);
    groups.get(l.itemId)!.push(l);
  }
  for (const ls of groups.values()) {
    const first = ls[0]!;
    const dealQty = first.dealQty!, dealCents = first.dealCents!;
    const qty = ls.reduce((s, l) => s + l.qty, 0);
    const full = Math.floor(qty / dealQty);
    if (full === 0) continue;
    const regular = ls.reduce((s, l) => s + l.unitCents * l.qty, 0);
    const dealPrice = full * dealCents + (qty - full * dealQty) * first.unitCents;
    let saving = Math.max(0, regular - dealPrice);
    for (const l of ls) {
      if (saving <= 0) break;
      const take = Math.min(saving, l.unitCents * l.qty);
      out.set(l.key, take);
      saving -= take;
    }
  }
  return out;
}

/** "2 for $1.00" */
export function dealLabel(dealQty: number, dealCents: number): string {
  return `${dealQty} for $${(dealCents / 100).toFixed(2)}`;
}

export function changeDueCents(totalCents: number, tenderedCents: number): number {
  return Math.max(0, tenderedCents - totalCents);
}

/** "Lottery 5 x $1.00" style label. */
export function lotteryLabel(qty: number, unitCents: number): string {
  const dollars = (unitCents / 100).toFixed(2);
  return `Lottery ${qty} x $${dollars}`;
}

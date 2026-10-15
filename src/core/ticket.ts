import { percentOfCents } from './money.js';
import { Authority, authorityAmountCents } from './tax.js';

export type LineKind = 'item' | 'button' | 'ask' | 'lottery' | 'service';
export type ServiceId = 'gas' | 'check_fee';

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
  /** Built-in services (gas, check cashing). */
  service?: ServiceId;
  /** For a check-cashing fee: the amount of the check the fee was figured from. */
  baseCents?: number;
};

/** Check-cashing fee for a check amount, in cents, at a rate in basis points (100 = 1%). Half-up rounding. */
export function checkFeeCents(checkCents: number, rateBp: number): number {
  return Math.floor((checkCents * rateBp + 5000) / 10000);
}

export function checkFeeLabel(checkCents: number, rateBp: number): string {
  const pct = rateBp % 100 === 0 ? String(rateBp / 100) : (rateBp / 100).toFixed(2);
  return `Check cashing ${pct}% (check $${(checkCents / 100).toFixed(2)})`;
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

  for (const l of lines) {
    const gross = l.unitCents * l.qty;
    const d = l.kind === 'lottery' || l.kind === 'service' || discountPct <= 0 ? 0 : percentOfCents(gross, discountPct * 100);
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

export function changeDueCents(totalCents: number, tenderedCents: number): number {
  return Math.max(0, tenderedCents - totalCents);
}

/** "Lottery 5 x $1.00" style label. */
export function lotteryLabel(qty: number, unitCents: number): string {
  const dollars = (unitCents / 100).toFixed(2);
  return `Lottery ${qty} x $${dollars}`;
}

// Revenue authorities (taxes and fees). All tax rules live in this one module.
// NEEDS VERIFICATION: rates and what is taxable must be confirmed with the
// SC Department of Revenue for Florence/Williamsburg County, Lake City.

import { percentOfCents } from './money.js';

export type Authority = {
  id: number;
  title: string;
  type: 'tax' | 'fee';
  /** Percent rate in basis points (800 = 8%). Exactly one of rateBp / flatCents is set. */
  rateBp: number | null;
  /** Flat amount in cents per unit. Exactly one of rateBp / flatCents is set. */
  flatCents: number | null;
};

export function validateAuthority(a: Pick<Authority, 'title' | 'rateBp' | 'flatCents'>): string | null {
  if (!a.title.trim()) return 'Give this tax or fee a name.';
  const hasRate = a.rateBp !== null && a.rateBp !== undefined;
  const hasFlat = a.flatCents !== null && a.flatCents !== undefined;
  if (hasRate && hasFlat) return 'Choose either a percent or a flat amount, not both.';
  if (!hasRate && !hasFlat) return 'Enter a percent or a flat amount.';
  if (hasRate && (!Number.isInteger(a.rateBp) || (a.rateBp as number) < 0)) return 'The percent must be zero or more.';
  if (hasFlat && (!Number.isInteger(a.flatCents) || (a.flatCents as number) < 0)) return 'The flat amount must be zero or more.';
  return null;
}

/**
 * Tax or fee for one ticket line.
 * Percent: line amount (after discounts) x rate, rounded half-up per line.
 * Flat: amount per unit x quantity x fee multiplier.
 */
export function authorityAmountCents(
  authority: Authority | undefined,
  lineAmountCents: number,
  qty: number,
  feeMultiplier = 1,
): number {
  if (!authority) return 0;
  if (authority.flatCents !== null) return authority.flatCents * qty * feeMultiplier;
  if (authority.rateBp !== null) return percentOfCents(lineAmountCents, authority.rateBp);
  return 0;
}

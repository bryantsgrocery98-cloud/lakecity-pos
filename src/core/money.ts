// All money is integer cents. Rates are integer basis points (100 bp = 1%).
// Never use floating point for money.

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${rem.toString().padStart(2, '0')}`;
}

/** "12.5" -> 1250, "$3" -> 300, "" -> 0. Returns null when it is not a valid amount. */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (s === '') return 0;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '.') return null;
  const [d = '0', c = ''] = s.split('.');
  return parseInt(d || '0', 10) * 100 + parseInt(c.padEnd(2, '0') || '0', 10);
}

/** amount * basisPoints / 10000, rounded half-up, using integers only. */
export function percentOfCents(amountCents: number, basisPoints: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  const abs = Math.abs(amountCents);
  return sign * Math.floor((abs * basisPoints + 5000) / 10000);
}

/** Builds a cents value from a keypad that only types digits ("1", "12", "125" -> 1, 12, 125 cents). */
export function centsFromKeypadDigits(digits: string): number {
  const clean = digits.replace(/\D/g, '').slice(0, 9);
  return clean === '' ? 0 : parseInt(clean, 10);
}

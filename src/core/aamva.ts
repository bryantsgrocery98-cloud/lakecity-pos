// AAMVA driver license / ID barcode (PDF417) parser. Age check only.
// PRIVACY: this module returns only what the age check needs. It never returns
// the name, address or license number, and callers must not store the raw text.
// NEEDS VERIFICATION with SC law / a lawyer before relying on it.

export type IdAgeResult =
  | { ok: true; birthDate: string; expiresOn: string | null; ageYears: number; expired: boolean }
  | { ok: false; reason: string };

/** True when scanner text looks like an AAMVA barcode (starts with "@" and contains "ANSI"). */
export function looksLikeAamva(text: string): boolean {
  const t = text.trimStart();
  // Some scanners drop the leading "@"; the ANSI header plus a birth-date field is proof enough.
  return (t.startsWith('@') && t.includes('ANSI')) || (t.includes('ANSI') && /DBB\d{8}/.test(t));
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** AAMVA dates are MMDDYYYY (US) or YYYYMMDD (Canada). Returns ISO yyyy-mm-dd or null. */
export function parseAamvaDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const us = { m: +raw.slice(0, 2), d: +raw.slice(2, 4), y: +raw.slice(4, 8) };
  if (validDate(us.y, us.m, us.d)) return iso(us.y, us.m, us.d);
  const ca = { y: +raw.slice(0, 4), m: +raw.slice(4, 6), d: +raw.slice(6, 8) };
  if (validDate(ca.y, ca.m, ca.d)) return iso(ca.y, ca.m, ca.d);
  return null;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole years between an ISO birth date and "today" (ISO). */
export function ageOn(birthIso: string, todayIso: string): number {
  const [by, bm, bd] = birthIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = todayIso.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

export function todayIso(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function evaluateBirthDate(birthIso: string, expiresIso: string | null, today = todayIso()): IdAgeResult {
  const ageYears = ageOn(birthIso, today);
  if (ageYears < 0 || ageYears > 120) return { ok: false, reason: 'The birth date does not look right.' };
  const expired = expiresIso !== null && expiresIso < today;
  return { ok: true, birthDate: birthIso, expiresOn: expiresIso, ageYears, expired };
}

/** Pulls only the birth date and expiry from the scan, then evaluates age. */
export function parseAamvaForAge(text: string, today = todayIso()): IdAgeResult {
  if (!looksLikeAamva(text)) return { ok: false, reason: 'That does not look like the barcode on the back of an ID.' };
  const dob = /DBB(\d{8})/.exec(text);
  if (!dob) return { ok: false, reason: 'The birth date was not found in the barcode.' };
  const birth = parseAamvaDate(dob[1]!);
  if (!birth) return { ok: false, reason: 'The birth date in the barcode is not valid.' };
  const exp = /DBA(\d{8})/.exec(text);
  const expires = exp ? parseAamvaDate(exp[1]!) : null;
  return evaluateBirthDate(birth, expires, today);
}

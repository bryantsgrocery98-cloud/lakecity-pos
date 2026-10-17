import { describe, expect, it } from 'vitest';
import { centsFromKeypadDigits, formatCents, parseDollarsToCents, percentOfCents } from './money.js';
import { Authority, authorityAmountCents, validateAuthority } from './tax.js';
import { TicketLine, changeDueCents, computeTotals, lotteryLabel } from './ticket.js';
import { ageOn, evaluateBirthDate, looksLikeAamva, parseAamvaDate, parseAamvaForAge } from './aamva.js';

const food: Authority = { id: 1, title: 'Food and Drink', type: 'tax', rateBp: 100, flatCents: null };
const tobacco: Authority = { id: 2, title: 'Tobacco', type: 'tax', rateBp: 800, flatCents: null };
const alcohol: Authority = { id: 3, title: 'Alcohol', type: 'tax', rateBp: 800, flatCents: null };
const deposit: Authority = { id: 4, title: 'Bottle deposit', type: 'fee', rateBp: null, flatCents: 5 };
const all = [food, tobacco, alcohol, deposit];

const line = (p: Partial<TicketLine> & { key: string }): TicketLine => ({
  kind: 'item', name: p.key, qty: 1, unitCents: 100, authorityId: null, category: 'Misc', ageMin: null, ...p,
});

describe('money', () => {
  it('formats cents', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-250)).toBe('-$2.50');
  });
  it('parses dollars', () => {
    expect(parseDollarsToCents('12.5')).toBe(1250);
    expect(parseDollarsToCents('$3')).toBe(300);
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
  });
  it('rounds percent half-up on integers', () => {
    expect(percentOfCents(250, 100)).toBe(3); // 2.5 cents -> 3
    expect(percentOfCents(249, 100)).toBe(2); // 2.49 -> 2
    expect(percentOfCents(1699, 800)).toBe(136); // 135.92 -> 136
    expect(percentOfCents(0, 800)).toBe(0);
  });
  it('builds cents from keypad digits', () => {
    expect(centsFromKeypadDigits('')).toBe(0);
    expect(centsFromKeypadDigits('5')).toBe(5);
    expect(centsFromKeypadDigits('2299')).toBe(2299);
  });
});

describe('revenue authorities', () => {
  it('requires a percent OR a flat amount, never both', () => {
    expect(validateAuthority({ title: 'X', rateBp: 100, flatCents: 5 })).toMatch(/not both/);
    expect(validateAuthority({ title: 'X', rateBp: null, flatCents: null })).toMatch(/Enter/);
    expect(validateAuthority({ title: '', rateBp: 100, flatCents: null })).toMatch(/name/);
    expect(validateAuthority({ title: 'X', rateBp: 100, flatCents: null })).toBeNull();
    expect(validateAuthority({ title: 'X', rateBp: null, flatCents: 5 })).toBeNull();
  });
  it('applies flat fees per unit x quantity x multiplier', () => {
    expect(authorityAmountCents(deposit, 999, 3, 2)).toBe(30);
  });
  it('applies percent rates per line', () => {
    expect(authorityAmountCents(tobacco, 949, 1)).toBe(76);
    expect(authorityAmountCents(undefined, 949, 1)).toBe(0);
  });
});

describe('ticket totals', () => {
  it('handles a 1% food line and 8% lines on the same ticket', () => {
    const lines = [
      line({ key: 'cola', unitCents: 229, authorityId: 1 }),
      line({ key: 'cigs', unitCents: 949, authorityId: 2, ageMin: 21 }),
      line({ key: '12pk', unitCents: 1699, authorityId: 3, ageMin: 21 }),
      line({ key: 'chips', unitCents: 279, authorityId: 1 }),
      line({ key: 'lotto', kind: 'lottery', qty: 5, unitCents: 100 }),
    ];
    const { totals } = computeTotals(lines, all);
    expect(totals.subtotalCents).toBe(229 + 949 + 1699 + 279 + 500);
    // food: 1% of 229 = 2.29 -> 2, 1% of 279 = 2.79 -> 3 (per line) = 5
    expect(totals.taxLines.find((t) => t.title === 'Food and Drink')?.cents).toBe(5);
    expect(totals.taxLines.find((t) => t.title === 'Tobacco')?.cents).toBe(76);
    expect(totals.taxLines.find((t) => t.title === 'Alcohol')?.cents).toBe(136);
    expect(totals.taxCents).toBe(5 + 76 + 136);
    expect(totals.totalCents).toBe(3656 + 217);
    expect(totals.ageRequired).toBe(21);
  });
  it('does not tax lottery and never discounts it', () => {
    const { totals } = computeTotals([line({ key: 'l', kind: 'lottery', qty: 2, unitCents: 500 })], all, 20);
    expect(totals.taxCents).toBe(0);
    expect(totals.discountCents).toBe(0);
    expect(totals.totalCents).toBe(1000);
  });
  it('discounts before tax', () => {
    const { totals } = computeTotals([line({ key: 'a', unitCents: 1000, authorityId: 2 })], all, 10);
    expect(totals.discountCents).toBe(100);
    expect(totals.taxCents).toBe(72); // 8% of 900
    expect(totals.totalCents).toBe(972);
  });
  it('adds a flat fee per unit', () => {
    const { totals } = computeTotals([line({ key: 'b', qty: 6, unitCents: 200, authorityId: 4 })], all);
    expect(totals.taxCents).toBe(30);
  });
  it('uses the strictest age rule', () => {
    const { totals } = computeTotals(
      [line({ key: 'a', ageMin: 18 }), line({ key: 'b', ageMin: 21 })], all);
    expect(totals.ageRequired).toBe(21);
  });
  it('computes change and lottery labels', () => {
    expect(changeDueCents(3873, 4000)).toBe(127);
    expect(changeDueCents(3873, 3000)).toBe(0);
    expect(lotteryLabel(5, 100)).toBe('Lottery 5 x $1.00');
  });
});

describe('AAMVA age check', () => {
  const sample = (dob: string, exp = '20300101') =>
    `@\n\x1e\rANSI 636046090002DL00410288ZS03290008DL\nDLDAQD1234567\nDCSDOE\nDACJOHN\nDBB${dob}\nDBA${exp}\nDAJSC\r`;

  it('recognises the AAMVA header', () => {
    expect(looksLikeAamva(sample('01011990'))).toBe(true);
    expect(looksLikeAamva('012345678905')).toBe(false);
  });
  it('parses US and Canadian date orders', () => {
    expect(parseAamvaDate('07151990')).toBe('1990-07-15');
    expect(parseAamvaDate('19900715')).toBe('1990-07-15');
    expect(parseAamvaDate('13451990')).toBeNull();
    expect(parseAamvaDate('abc')).toBeNull();
  });
  it('computes age around birthdays', () => {
    expect(ageOn('1990-07-15', '2026-07-14')).toBe(35);
    expect(ageOn('1990-07-15', '2026-07-15')).toBe(36);
  });
  it('passes an adult and reports age', () => {
    const r = parseAamvaForAge(sample('07151990'), '2026-10-12');
    expect(r).toMatchObject({ ok: true, ageYears: 36, expired: false });
  });
  it('flags an under-age customer and an expired ID', () => {
    const young = parseAamvaForAge(sample('10122007'), '2026-10-12');
    expect(young).toMatchObject({ ok: true, ageYears: 19 });
    const old = parseAamvaForAge(sample('01011980', '20200101'), '2026-10-12');
    expect(old).toMatchObject({ ok: true, expired: true });
  });
  it('turns the day before the 21st birthday into 20', () => {
    const r = parseAamvaForAge(sample('10132005'), '2026-10-12');
    expect(r).toMatchObject({ ok: true, ageYears: 21 - 1 });
  });
  it('rejects missing or bad data', () => {
    expect(parseAamvaForAge('hello')).toMatchObject({ ok: false });
    expect(parseAamvaForAge('@\nANSI 6360\nDAQ123\n')).toMatchObject({ ok: false });
    expect(evaluateBirthDate('2999-01-01', null, '2026-10-12')).toMatchObject({ ok: false });
  });
  it('never returns name or license number', () => {
    const r = parseAamvaForAge(sample('07151990'), '2026-10-12');
    expect(JSON.stringify(r)).not.toMatch(/DOE|JOHN|D1234567/);
  });
});

describe('aamva tolerance', () => {
  it('reads a scan whose leading @ was dropped by the scanner', async () => {
    const { parseAamvaForAge, looksLikeAamva } = await import('./aamva.js');
    const text = 'ANSI 636005090002DL00410278ZS03190024DLDAQ123\nDCSDOE\nDBB03041990\nDBA03042031\nDAJSC\n';
    expect(looksLikeAamva(text)).toBe(true);
    const r = parseAamvaForAge(text, '2026-10-14');
    expect(r.ok && r.ageYears).toBe(36);
  });
});

describe('scanner-parsed ID line', () => {
  it('reads birth and expiry from an ID: line and ignores everything else', async () => {
    const { looksLikeId, parseIdForAge } = await import('./aamva.js');
    const line = 'ID:07/14/1995|12/06/2032|FIRST|MIDDLE|LAST|000000000|SC|6\'-0"|BRO';
    expect(looksLikeId(line)).toBe(true);
    const r = parseIdForAge(line, '2026-10-14');
    expect(r.ok && r.ageYears).toBe(31);
    expect(r.ok && r.expired).toBe(false);
    const under = parseIdForAge('ID:01/01/2008|01/01/2030|A|B|C', '2026-10-14');
    expect(under.ok && under.ageYears).toBe(18);
    const exp = parseIdForAge('ID:01/01/1980|01/01/2020|A|B|C', '2026-10-14');
    expect(exp.ok && exp.expired).toBe(true);
  });
});

describe('ID line field order', () => {
  it('finds the birth date wherever it sits on the line', async () => {
    const { parseIdForAge } = await import('./aamva.js');
    const r = parseIdForAge('ID:12/06/2032|FIRST|LAST|07/14/1995|01/15/2023|GA', '2026-10-14');
    expect(r.ok && r.ageYears).toBe(31);
    expect(r.ok && r.expired).toBe(false);
  });
});

describe('multi-buy deals', () => {
  it('prices 2 for $1.00 across separate lines, leftovers at unit price', async () => {
    const { computeTotals } = await import('./ticket.js');
    const auth = [{ id: 1, title: 'Food and Drink', type: 'tax' as const, rateBp: 100, flatCents: null }];
    const line = (key: string) => ({ key, kind: 'item' as const, name: 'Red Hot Sausage', qty: 1, unitCents: 65, authorityId: 1, category: 'Food', ageMin: null, itemId: 7, dealQty: 2, dealCents: 100 });
    const one = computeTotals([line('a')], auth);
    expect(one.totals.discountCents).toBe(0);
    expect(one.totals.subtotalCents).toBe(65);
    const two = computeTotals([line('a'), line('b')], auth);
    expect(two.totals.subtotalCents).toBe(130);
    expect(two.totals.discountCents).toBe(30);           // $1.30 -> $1.00
    expect(two.totals.totalCents).toBe(101);             // + 1% tax on $1.00
    const three = computeTotals([line('a'), line('b'), line('c')], auth);
    expect(three.totals.subtotalCents - three.totals.discountCents).toBe(165); // $1.00 + $0.65
    const five = computeTotals([line('a'), line('b'), line('c'), line('d'), line('e')], auth);
    expect(five.totals.subtotalCents - five.totals.discountCents).toBe(265); // 2 deals + 1 single
  });
});

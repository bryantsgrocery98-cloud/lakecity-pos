// One-time deal presets from the store's shelf tags (Oct 2026). Applied once per preset version at startup,
// only to items that match by name (case-insensitive) and still have no deal, so hand-set deals are never overwritten.
import { audit, getSetting, type DB } from './db.js';

export const PRESET_VERSION = '1';

type Preset = { match: RegExp; priceCents?: number; dealQty: number; dealCents: number; label: string };

export const DEAL_PRESETS: Preset[] = [
  { match: /^planters.*(salted peanuts|honey roasted peanuts|heat peanuts)/i, priceCents: 69, dealQty: 2, dealCents: 109, label: 'Planters 2 for $1.09' },
  { match: /^gurley/i, priceCents: 129, dealQty: 2, dealCents: 200, label: "Gurley's 2 for $2.00" },
  { match: /^slim jim small/i, priceCents: 49, dealQty: 2, dealCents: 89, label: 'Slim Jim 2 for 89¢' },
  { match: /^herb'?s.*sausage/i, priceCents: 59, dealQty: 2, dealCents: 100, label: "Herb's 2 for $1.00" },
];

export function applyDealPresets(db: DB): number {
  if (getSetting(db, 'deal_presets_applied', '') === PRESET_VERSION) return 0;
  const rows = db.prepare(`SELECT id, name, price_cents, deal_qty FROM items WHERE active = 1`).all() as { id: number; name: string; price_cents: number; deal_qty: number | null }[];
  const upd = db.prepare(`UPDATE items SET deal_qty = ?, deal_cents = ? WHERE id = ?`);
  let n = 0;
  const hits: string[] = [];
  db.transaction(() => {
    for (const r of rows) {
      if (r.deal_qty) continue;
      const p = DEAL_PRESETS.find((x) => x.match.test(r.name.trim()) && (x.priceCents === undefined || x.priceCents === r.price_cents));
      if (!p) continue;
      upd.run(p.dealQty, p.dealCents, r.id);
      n++; hits.push(p.label);
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('deal_presets_applied', ?)`).run(PRESET_VERSION);
  })();
  if (n) audit(db, 'system', 'deal_presets', `${n} items: ${[...new Set(hits)].join(', ')}`);
  return n;
}

/**
 * Buttons that came from the old register's one-click pages are not tied to inventory items. Where exactly one
 * active item has the same name (and the button is a plain fixed-price button), tie them together so the
 * button shows the item's picture and follows its price. Safe to run every start.
 */
export function linkButtonsToItems(db: DB): number {
  const buttons = db.prepare(`SELECT id, name, price_cents FROM buttons WHERE item_id IS NULL AND price_mode = 'fixed'`).all() as { id: number; name: string; price_cents: number }[];
  if (!buttons.length) return 0;
  const items = db.prepare(`SELECT id, name, size, price_cents FROM items WHERE active = 1`).all() as { id: number; name: string; size: string | null; price_cents: number }[];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName = new Map<string, number[]>();
  for (const it of items) {
    for (const key of [norm(it.name), norm(`${it.name} ${it.size ?? ''}`)]) {
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      if (!byName.get(key)!.includes(it.id)) byName.get(key)!.push(it.id);
    }
  }
  const upd = db.prepare(`UPDATE buttons SET item_id = ? WHERE id = ?`);
  let n = 0;
  for (const b of buttons) {
    const ids = byName.get(norm(b.name));
    if (ids && ids.length === 1) { upd.run(ids[0], b.id); n++; }
  }
  return n;
}

export const SOFT_RE = /root beer|ginger beer|birch beer|non-?alcoholic|alcohol-free|beer nuts|beer cheese|beer batter|rum cake|bourbon chicken|wine gums/gi;
export const FOOD_RE = /\b(soda|cola|coke|pepsi|sprite|dr pepper|mountain dew|fanta|water|juice|tea|coffee|milk|energy|gatorade|powerade|monster|red bull|starbucks|chips|candy|chocolate|cookie|cookies|cake|gum|snack|crackers|jerky|nuts|peanuts|honey bun|donut|bread|sausage|hot dog|pickle|egg|cheese|sandwich|burrito|pizza|ice cream|popsicle|cereal|rice|beans|sugar|flour|ketchup|mustard|mayo|syrup|oatmeal|noodle|ramen|soup|fruit|banana|apple|ice bag|ice cup|cup)\b/i;
export const RESTRICTED_RE = /alcohol|beer|wine|liquor|lager|\bale\b|seltzer|malt|cider|vodka|whiskey|whisky|bourbon|rum\b|tequila|gin\b|brandy|moonshine|margarita|twisted tea|smirnoff|four loko|mike'?s|buzzball|tobacco|cig|cigar|vape|vapor|nicotine|zyn|snuff|\bdip\b|grizzly|skoal|copenhagen|swisher|black ?& ?mild|backwoods|newport|marlboro|camel|pall mall|kool|lighter|rolling paper|\bwraps?\b|lottery|geek bar|elf bar|hookah|rizla|zig.?zag|natural light|natty|busch|coors|miller lite|bud light|budweiser|michelob|corona|modelo|heineken|yuengling|white claw|truly|high noon|nutrl|steel reserve|old english|colt 45|icehouse|keystone|milwaukee|pabst|pbr\b/i;

/**
 * Clears the 21+ flag from items and quick buttons that are not alcohol or tobacco by name or category.
 * Runs once per cleanup version; everything it changes is written to the audit log.
 */
export const AGE_CLEANUP_VERSION = '1';
export function clearWrongAgeFlags(db: DB): number {
  if (getSetting(db, 'age_cleanup_applied', '') === AGE_CLEANUP_VERSION) return 0;
  const items = db.prepare(`SELECT id, name, category FROM items WHERE age_min IS NOT NULL`).all() as { id: number; name: string; category: string }[];
  const buttons = db.prepare(`SELECT id, name, category FROM buttons WHERE age_min IS NOT NULL`).all() as { id: number; name: string; category: string }[];
  const wrong = (name: string, category: string) => {
    const n = name.replace(SOFT_RE, ''); // "root beer" is not beer
    if (RESTRICTED_RE.test(n)) return false;                 // the name says alcohol/tobacco: keep the flag
    if (!RESTRICTED_RE.test(category)) return true;          // neither name nor category restricted: clear
    return FOOD_RE.test(n);                                  // category says alcohol but the name is plainly a soda/snack: clear
  };
  const wrongItems = items.filter((i) => wrong(i.name, i.category));
  const wrongButtons = buttons.filter((b) => wrong(b.name, b.category));
  db.transaction(() => {
    const ui = db.prepare(`UPDATE items SET age_min = NULL WHERE id = ?`);
    const ub = db.prepare(`UPDATE buttons SET age_min = NULL WHERE id = ?`);
    for (const i of wrongItems) ui.run(i.id);
    for (const b of wrongButtons) ub.run(b.id);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('age_cleanup_applied', ?)`).run(AGE_CLEANUP_VERSION);
  })();
  const n = wrongItems.length + wrongButtons.length;
  if (n) audit(db, 'system', 'age_cleanup', `cleared ID flag on ${wrongItems.length} items, ${wrongButtons.length} buttons: ${[...wrongItems, ...wrongButtons].map((x) => x.name).slice(0, 40).join(', ')}`);
  return n;
}

/** Product barcodes are 6, 8, 12, 13 or 14 digits (or a short PLU). Anything else is probably the number off a driver's license. */
export function looksLikeIdNumber(code: string): boolean {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return /^[A-Z]\d{6,}$/i.test(c) && c.length >= 7; // letter + digits, like many state license numbers
  return c.length === 9 || c.length === 10 || c.length === 11 || c.length >= 15;
}

/** Stricter than looksLikeIdNumber: never a product code (UPC/EAN are 6, 8, 12, 13 or 14 digits; 11 is a UPC missing its leading zero). */
export function certainlyIdNumber(code: string): boolean {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return /^[A-Z]\d{6,}$/i.test(c) && c.length >= 7;
  return c.length === 9 || c.length === 10 || c.length >= 15;
}

/**
 * Removes barcodes on age-restricted items that look like a license number rather than a product code (linked by
 * accident from the "New barcode" screen). That is how scanning an ID could ring up a beer. Runs once; returns what it fixed.
 */
export function unlinkIdBarcodes(db: DB): string[] {
  // The first pass (once) also dropped 11-digit codes; every start since then drops only codes that can never be a product.
  const firstPass = getSetting(db, 'id_barcode_cleanup_applied', '') !== '1';
  const rows = db.prepare(`SELECT b.code, b.item_id, i.name FROM barcodes b JOIN items i ON i.id = b.item_id WHERE i.age_min IS NOT NULL`).all() as { code: string; item_id: number; name: string }[];
  const fixed: string[] = [];
  for (const r of rows) {
    if (!(firstPass ? looksLikeIdNumber(r.code) : certainlyIdNumber(r.code))) continue;
    db.prepare(`DELETE FROM barcodes WHERE code = ? AND item_id = ?`).run(r.code, r.item_id);
    db.prepare(`INSERT INTO audit_log (ts, cashier, action, detail) VALUES (?, 'system', 'barcode_unlinked', ?)`).run(new Date().toISOString(), `${r.name}: ${r.code} looked like an ID number, not a product barcode`);
    fixed.push(`${r.name} (${r.code})`);
  }
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('id_barcode_cleanup_applied', '1')`).run();
  return fixed;
}

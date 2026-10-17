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

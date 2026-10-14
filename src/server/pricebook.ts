// Price book import: the CSV export from the store's previous register.
// Columns: Upc, Department, qty, cents, incltaxes, inclfees, Name, size, ebt, byweight, Fee Multiplier,
// cost_qty, cost_cents, variable_price, addstock, setstock, pack_name, pack_qty, pack_upc, unit_upc,
// unit_count, is_oneclick, oc_color, oc_border_color, oc_text_color, oc_fixedpos, oc_page, oc_key, oc_relpos
//
// The "Upc" column holds long hash IDs ending in "|69847". They are NOT barcodes: they are stored as
// external_id, and real barcodes get linked by scanning at the register.

import { audit, type DB } from './db.js';
import type { ButtonShape } from '../core/types.js';

export type PbRow = Record<string, string>;

export type PlannedItem = {
  externalId: string; name: string; size: string | null; priceCents: number; costCents: number | null;
  category: string; authorityTitle: string | null; ageMin: number | null; qtyOnHand: number; priceMode: 'fixed' | 'ask';
  feeMultiplier: number; ebt: boolean; warnings: string[];
};
export type PlannedButton = {
  page: string; pos: number; name: string; priceCents: number; priceMode: 'fixed' | 'ask'; authorityTitle: string | null;
  category: string; ageMin: number | null; shape: ButtonShape; fill: string; border: string; textColor: string; externalId: string;
};
export type Plan = {
  items: PlannedItem[]; buttons: PlannedButton[]; pages: string[];
  skipped: { name: string; reason: string }[];
  counts: { rows: number; items: number; buttons: number; zeroPrice: number; negativeStock: number; noCost: number; byDepartment: Record<string, number> };
  warnings: { name: string; note: string }[];
};

/** Strips Excel's ="..." wrapper and whitespace. */
export function unwrap(v: string | undefined): string {
  const s = (v ?? '').trim();
  const m = /^="(.*)"$/.exec(s);
  return (m ? m[1]! : s).trim();
}

/** Minimal CSV parser that handles quoted fields, embedded commas, and CRLF. */
export function parseCsv(text: string): PbRow[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"' && field === '') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()?.map((h) => h.trim()) ?? [];
  return rows.filter((r) => r.some((v) => v.trim() !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function looksLikePricebook(header: string[]): boolean {
  const need = ['Upc', 'Department', 'cents', 'Name', 'setstock', 'is_oneclick', 'oc_page'];
  return need.every((h) => header.includes(h));
}

// Department in the file -> our category name and revenue authority. NEEDS VERIFICATION with the owner.
const DEPT: Record<string, { category: string; authority: string | null; ageMin: number | null }> = {
  'Snack, Drinks & Food 1%': { category: 'Food & Drink', authority: 'Food and Drink', ageMin: null },
  'Tobacco 8 %': { category: 'Tobacco', authority: 'Tobacco', ageMin: 21 },
  'Alcohol 8 %': { category: 'Alcohol', authority: 'Alcohol', ageMin: 21 },
  'Household 8 %': { category: 'Household', authority: 'Grocery All', ageMin: null },
  'Regulars 8 %': { category: 'Regulars', authority: 'Grocery All', ageMin: null },
  'TAB PAYMENT NO TAX': { category: 'Services', authority: null, ageMin: null },
  'Checking Service Fee': { category: 'Services', authority: null, ageMin: null },
  'Lottery': { category: 'Lottery', authority: null, ageMin: null },
};

// Service rows that the register already has its own buttons for.
const SKIP_NAMES = new Set(['TICKET PLAYS', 'REFUND']);

function guessShape(name: string): ButtonShape {
  const n = name.toLowerCase();
  if (/18 ?pack|15 ?pack|24 ?pack|30 ?pack/.test(n)) return 'eighteen';
  if (/12 ?pack/.test(n)) return 'twelve';
  if (/6 ?pack/.test(n)) return 'six';
  if (/\bcan\b/.test(n)) return 'can';
  if (/cup/.test(n)) return 'cup';
  if (/bag/.test(n)) return 'bag';
  return 'box';
}

const PALETTE = ['#FFE9CC', '#DCEBFF', '#FFE0D6', '#F3DDFB', '#DDF1FA', '#D9F3E6', '#FFF1B8', '#E4E7EA', '#FFD9D6', '#E0F2E9'];

function textColorFor(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return '#14222E';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#14222E' : '#FFFFFF';
}

export function planImport(rows: PbRow[]): Plan {
  const items: PlannedItem[] = [];
  const buttons: PlannedButton[] = [];
  const skipped: Plan['skipped'] = [];
  const warnings: Plan['warnings'] = [];
  const byDepartment: Record<string, number> = {};
  let zeroPrice = 0, negativeStock = 0, noCost = 0;
  const seen = new Set<string>();

  for (const r of rows) {
    const externalId = unwrap(r.Upc);
    const name = unwrap(r.Name);
    const dept = unwrap(r.Department);
    if (!externalId || !name) { skipped.push({ name: name || '(blank)', reason: 'Missing name or ID' }); continue; }
    if (seen.has(externalId)) { skipped.push({ name, reason: 'Duplicate ID in the file' }); continue; }
    seen.add(externalId);
    byDepartment[dept] = (byDepartment[dept] ?? 0) + 1;
    if (SKIP_NAMES.has(name.toUpperCase())) { skipped.push({ name, reason: 'The register has its own button for this' }); continue; }

    const map = DEPT[dept] ?? { category: dept || 'Other', authority: null, ageMin: null };
    const w: string[] = [];
    if (!DEPT[dept]) w.push(`Unknown department "${dept}": imported with no tax. Check it.`);
    const priceCents = parseInt(unwrap(r.cents) || '0', 10) || 0;
    const costRaw = parseInt(unwrap(r.cost_cents) || '0', 10) || 0;
    const costCents = costRaw > 0 ? costRaw : null;
    if (costCents === null) noCost++;
    const sizeRaw = unwrap(r.size);
    const size = sizeRaw && sizeRaw !== '1' ? sizeRaw : null; // "1" means a count, not a size
    const stock = parseInt(unwrap(r.setstock) || '0', 10) || 0;
    if (stock < 0) { negativeStock++; w.push(`Stock is ${stock}. Set the real count on the shelf.`); }
    const fee = parseInt(unwrap(r['Fee Multiplier']) || '1', 10);
    const isService = map.category === 'Services';
    const priceMode: 'fixed' | 'ask' = isService && priceCents === 0 ? 'ask' : 'fixed';
    if (priceCents === 0 && !isService) { zeroPrice++; w.push('Priced at $0. Set the price before selling.'); }
    const ebt = unwrap(r.ebt).toLowerCase() === 'y';

    items.push({ externalId, name, size, priceCents, costCents, category: map.category, authorityTitle: map.authority, ageMin: map.ageMin,
      qtyOnHand: stock, priceMode, feeMultiplier: Number.isFinite(fee) && fee > 0 ? fee : 1, ebt, warnings: w });
    for (const note of w) warnings.push({ name: size ? `${name} ${size}` : name, note });

    if (unwrap(r.is_oneclick).toLowerCase() === 'y') {
      const page = unwrap(r.oc_page) || 'No Code Items';
      const key = unwrap(r.oc_key) || name;
      const pos = parseInt(unwrap(r.oc_relpos) || unwrap(r.oc_fixedpos) || '99', 10) || 99;
      const fillRaw = unwrap(r.oc_color);
      const fill = /^#[0-9a-f]{6}$/i.test(fillRaw) ? fillRaw : PALETTE[buttons.length % PALETTE.length]!;
      const borderRaw = unwrap(r.oc_border_color);
      const border = /^#[0-9a-f]{6}$/i.test(borderRaw) ? borderRaw : fill;
      const textRaw = unwrap(r.oc_text_color);
      const textColor = /^#[0-9a-f]{6}$/i.test(textRaw) ? textRaw : textColorFor(fill);
      buttons.push({ page, pos, name: key, priceCents, priceMode, authorityTitle: map.authority, category: map.category, ageMin: map.ageMin,
        shape: guessShape(key), fill, border, textColor, externalId });
    }
  }
  buttons.sort((a, b) => a.page.localeCompare(b.page) || a.pos - b.pos);
  const pages = ['ICE COLD BEER', 'Checks & Services', 'Gas', 'No Code Items'];
  for (const b of buttons) if (!pages.includes(b.page)) pages.push(b.page);

  return { items, buttons, pages, skipped, warnings,
    counts: { rows: rows.length, items: items.length, buttons: buttons.length, zeroPrice, negativeStock, noCost, byDepartment } };
}

export type ApplyResult = { added: number; updated: number; buttons: number; removedDemo: number };

/**
 * Writes the plan into the database. Existing items are matched by external_id and updated (price, cost,
 * category, tax, stock); their barcodes and pictures are kept. Demo items (no external_id) are removed
 * when replaceDemo is true. One-click pages are rebuilt from the file; Gas and Checks & Services keep
 * their service buttons.
 */
export function applyImport(db: DB, plan: Plan, cashier: string, replaceDemo: boolean): ApplyResult {
  const authId = (title: string | null): number | null => {
    if (title === null) return null;
    const r = db.prepare(`SELECT id FROM authorities WHERE title = ?`).get(title) as { id: number } | undefined;
    return r ? r.id : null;
  };
  const res: ApplyResult = { added: 0, updated: 0, buttons: 0, removedDemo: 0 };
  const tx = db.transaction(() => {
    if (replaceDemo) {
      db.exec(`DELETE FROM holds`);
      db.exec(`DELETE FROM buttons`);
      db.exec(`DELETE FROM pages`);
      const demo = db.prepare(`SELECT id FROM items WHERE external_id IS NULL`).all() as { id: number }[];
      for (const d of demo) { db.prepare(`DELETE FROM barcodes WHERE item_id = ?`).run(d.id); db.prepare(`DELETE FROM items WHERE id = ?`).run(d.id); }
      res.removedDemo = demo.length;
    }
    const find = db.prepare(`SELECT id FROM items WHERE external_id = ?`);
    const ins = db.prepare(`INSERT INTO items (name, size, external_id, price_cents, price_mode, cost_cents, category, authority_id, age_min, fee_multiplier, qty_on_hand, color, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    const upd = db.prepare(`UPDATE items SET name = ?, size = ?, price_cents = ?, price_mode = ?, cost_cents = ?, category = ?, authority_id = ?, age_min = ?, fee_multiplier = ?, qty_on_hand = ? WHERE id = ?`);
    const colors = ['#7C3A2D', '#4C8B3F', '#3C7DB5', '#2F5C8A', '#B5651D', '#8A6A2F', '#6B4A3A', '#2E8F7A', '#7A3B3B', '#5B6B78'];
    const idByExternal = new Map<string, number>();
    plan.items.forEach((it, i) => {
      const ex = find.get(it.externalId) as { id: number } | undefined;
      if (ex) {
        upd.run(it.name, it.size, it.priceCents, it.priceMode, it.costCents, it.category, authId(it.authorityTitle), it.ageMin, it.feeMultiplier, it.qtyOnHand, ex.id);
        idByExternal.set(it.externalId, ex.id); res.updated++;
      } else {
        const r = ins.run(it.name, it.size, it.externalId, it.priceCents, it.priceMode, it.costCents, it.category, authId(it.authorityTitle), it.ageMin, it.feeMultiplier, it.qtyOnHand, colors[i % colors.length]);
        idByExternal.set(it.externalId, Number(r.lastInsertRowid)); res.added++;
      }
    });

    // Pages and one-click buttons.
    const pageIds = new Map<string, number>();
    plan.pages.forEach((name, i) => {
      const ex = db.prepare(`SELECT id FROM pages WHERE name = ?`).get(name) as { id: number } | undefined;
      if (ex) pageIds.set(name, ex.id);
      else pageIds.set(name, Number(db.prepare(`INSERT INTO pages (name, pos) VALUES (?, ?)`).run(name, i).lastInsertRowid));
    });
    const btn = db.prepare(`INSERT INTO buttons (page_id, pos, name, price_cents, price_mode, item_id, authority_id, category, age_min, shape, fill, border, text_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const posByPage = new Map<string, number>();
    for (const b of plan.buttons) {
      const dup = db.prepare(`SELECT id FROM buttons WHERE page_id = ? AND name = ?`).get(pageIds.get(b.page), b.name);
      if (dup) continue;
      const pos = posByPage.get(b.page) ?? (db.prepare(`SELECT COUNT(*) AS n FROM buttons WHERE page_id = ?`).get(pageIds.get(b.page)) as { n: number }).n;
      posByPage.set(b.page, pos + 1);
      btn.run(pageIds.get(b.page), pos, b.name, b.priceCents, b.priceMode, idByExternal.get(b.externalId) ?? null, authId(b.authorityTitle), b.category, b.ageMin, b.shape, b.fill, b.border, b.textColor);
      res.buttons++;
    }
    // Service buttons the register relies on.
    const svcPage = pageIds.get('Checks & Services');
    if (svcPage !== undefined) {
      const ensure = (name: string, shape: ButtonShape, fill: string) => {
        if (db.prepare(`SELECT 1 FROM buttons WHERE name = ?`).get(name)) return;
        const n = (db.prepare(`SELECT COUNT(*) AS n FROM buttons WHERE page_id = ?`).get(svcPage) as { n: number }).n;
        btn.run(svcPage, n, name, 0, 'ask', null, null, 'Services', null, shape, fill, fill, '#14222E');
        res.buttons++;
      };
      ensure('Non-listed Item', 'box', '#E4E7EA');
      ensure('Check Cashing Fee', 'box', '#DCEBFF');
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('pricebook_imported_at', ?)`).run(new Date().toISOString());
    audit(db, cashier, 'pricebook_import', `${res.added} added, ${res.updated} updated, ${res.buttons} buttons, ${res.removedDemo} demo items removed`);
  });
  tx();
  return res;
}

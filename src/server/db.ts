import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Thin wrapper over Node's built-in SQLite (no compiled add-on, so `npm install`
 * never needs Python or build tools on the store computer).
 */
export class DB {
  private readonly raw: DatabaseSync;
  constructor(file: string) { this.raw = new DatabaseSync(file); }
  exec(sql: string): void { this.raw.exec(sql); }
  pragma(text: string): void { this.raw.exec(`PRAGMA ${text};`); }
  prepare(sql: string) {
    const st = this.raw.prepare(sql);
    return {
      get: (...args: unknown[]) => st.get(...(args as never[])) as unknown,
      all: (...args: unknown[]) => st.all(...(args as never[])) as unknown[],
      run: (...args: unknown[]) => st.run(...(args as never[])) as { changes: number | bigint; lastInsertRowid: number | bigint },
    };
  }
  /** Runs fn inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.raw.exec('BEGIN');
      try { const out = fn(); this.raw.exec('COMMIT'); return out; }
      catch (e) { this.raw.exec('ROLLBACK'); throw e; }
    };
  }
  close(): void { this.raw.close(); }
}

export const SCHEMA_VERSION = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('cashier','manager','owner')), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS authorities (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('tax','fee')),
  rate_bp INTEGER, flat_cents INTEGER,
  CHECK ((rate_bp IS NOT NULL AND flat_cents IS NULL) OR (rate_bp IS NULL AND flat_cents IS NOT NULL)));
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, size TEXT, external_id TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0, price_mode TEXT NOT NULL DEFAULT 'fixed',
  cost_cents INTEGER, category TEXT NOT NULL, authority_id INTEGER REFERENCES authorities(id),
  age_min INTEGER, fee_multiplier INTEGER NOT NULL DEFAULT 1, qty_on_hand INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#5B6B78', frequent INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  image_version INTEGER NOT NULL DEFAULT 0, deal_qty INTEGER, deal_cents INTEGER);
CREATE TABLE IF NOT EXISTS barcodes (code TEXT PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id));
CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS buttons (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id), pos INTEGER NOT NULL,
  name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0, price_mode TEXT NOT NULL DEFAULT 'fixed',
  item_id INTEGER REFERENCES items(id), authority_id INTEGER REFERENCES authorities(id),
  category TEXT NOT NULL, age_min INTEGER, shape TEXT NOT NULL DEFAULT 'box',
  fill TEXT NOT NULL, border TEXT NOT NULL, text_color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, workday TEXT NOT NULL, cashier TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, discount_pct INTEGER NOT NULL DEFAULT 0, age_check TEXT,
  voided_at TEXT, voided_by TEXT, void_reason TEXT, workday_closed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), created_at TEXT NOT NULL, workday TEXT NOT NULL,
  cashier TEXT NOT NULL, manager TEXT NOT NULL, reason TEXT NOT NULL, tender TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS refund_lines (
  id INTEGER PRIMARY KEY, refund_id INTEGER NOT NULL REFERENCES refunds(id), sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),
  name TEXT NOT NULL, qty INTEGER NOT NULL, cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, category TEXT NOT NULL, authority_id INTEGER);
CREATE TABLE IF NOT EXISTS z_reports (
  id INTEGER PRIMARY KEY, workday TEXT NOT NULL, closed_at TEXT NOT NULL, cashier TEXT NOT NULL, report_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), name TEXT NOT NULL, kind TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL, authority_id INTEGER, category TEXT NOT NULL, age_min INTEGER);
CREATE TABLE IF NOT EXISTS sale_tax (
  sale_id INTEGER NOT NULL REFERENCES sales(id), authority_id INTEGER NOT NULL, title TEXT NOT NULL, cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), tender TEXT NOT NULL CHECK (tender IN ('cash','card','check','tab','lottery')),
  amount_cents INTEGER NOT NULL, tendered_cents INTEGER, change_cents INTEGER, reference TEXT);
CREATE TABLE IF NOT EXISTS holds (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, lines_json TEXT NOT NULL, discount_pct INTEGER NOT NULL DEFAULT 0,
  cashier TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cash_events (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, cashier TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('no_sale','lottery_payout')), amount_cents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, note TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tab_entries (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), ts TEXT NOT NULL, workday TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('charge','payment','adjust')), cents INTEGER NOT NULL, sale_id INTEGER, tender TEXT, cashier TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, cashier TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'The audit log cannot be changed.'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'The audit log cannot be changed.'); END;
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DB(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Simple forward-only migrations keyed by a version number in the meta table. */
function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
  const current = row ? parseInt(row.value, 10) : 0;
  if (current < 1) {
    db.exec(SCHEMA); // a fresh database already has every column below
  } else {
    if (current < 2) db.exec(`ALTER TABLE items ADD COLUMN image_version INTEGER NOT NULL DEFAULT 0;`);
    if (current < 3) {
      db.exec(`ALTER TABLE sales ADD COLUMN voided_at TEXT; ALTER TABLE sales ADD COLUMN voided_by TEXT; ALTER TABLE sales ADD COLUMN void_reason TEXT;
        ALTER TABLE sales ADD COLUMN workday_closed INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS refunds (
          id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), created_at TEXT NOT NULL, workday TEXT NOT NULL,
          cashier TEXT NOT NULL, manager TEXT NOT NULL, reason TEXT NOT NULL, tender TEXT NOT NULL,
          subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS refund_lines (
          id INTEGER PRIMARY KEY, refund_id INTEGER NOT NULL REFERENCES refunds(id), sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),
          name TEXT NOT NULL, qty INTEGER NOT NULL, cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, category TEXT NOT NULL, authority_id INTEGER);
        CREATE TABLE IF NOT EXISTS z_reports (
          id INTEGER PRIMARY KEY, workday TEXT NOT NULL, closed_at TEXT NOT NULL, cashier TEXT NOT NULL, report_json TEXT NOT NULL);`);
    }
    if (current < 4) {
      // Checks can now be taken as payment (check cashing). SQLite cannot change a CHECK constraint, so rebuild the table.
      db.exec(`CREATE TABLE payments_v4 (
          id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), tender TEXT NOT NULL CHECK (tender IN ('cash','card','check','tab','lottery')),
          amount_cents INTEGER NOT NULL, tendered_cents INTEGER, change_cents INTEGER, reference TEXT);
        INSERT INTO payments_v4 (id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference)
          SELECT id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_v4 RENAME TO payments;`);
    }
    if (current < 5) db.exec(`ALTER TABLE items ADD COLUMN deal_qty INTEGER; ALTER TABLE items ADD COLUMN deal_cents INTEGER;`);
    if (current < 6) {
      db.exec(`CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, note TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS tab_entries (
          id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), ts TEXT NOT NULL, workday TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('charge','payment','adjust')), cents INTEGER NOT NULL, sale_id INTEGER, tender TEXT, cashier TEXT NOT NULL, note TEXT);
        CREATE TABLE payments_v6 (
          id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), tender TEXT NOT NULL CHECK (tender IN ('cash','card','check','tab','lottery')),
          amount_cents INTEGER NOT NULL, tendered_cents INTEGER, change_cents INTEGER, reference TEXT);
        INSERT INTO payments_v6 (id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference)
          SELECT id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_v6 RENAME TO payments;`);
    }
    if (current < 7) {
      db.exec(`CREATE TABLE payments_v7 (
          id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), tender TEXT NOT NULL CHECK (tender IN ('cash','card','check','tab','lottery')),
          amount_cents INTEGER NOT NULL, tendered_cents INTEGER, change_cents INTEGER, reference TEXT);
        INSERT INTO payments_v7 (id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference)
          SELECT id, sale_id, tender, amount_cents, tendered_cents, change_cents, reference FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_v7 RENAME TO payments;`);
    }
  }
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
}

export function audit(db: DB, cashier: string, action: string, detail = ''): void {
  db.prepare(`INSERT INTO audit_log (ts, cashier, action, detail) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), cashier, action, detail);
}

export function getSetting(db: DB, key: string, fallback: string): string {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return r ? r.value : fallback;
}

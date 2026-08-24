// db.js — apertura y esquema SQLite (node:sqlite, cero dependencias).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  UNIQUE(name, size)
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,                      -- UUID idempotente (cliente)
  folio INTEGER NOT NULL UNIQUE,            -- folio central secuencial
  client_name TEXT,                         -- opcional: nombre o teléfono
  device_id TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  client_ts TEXT,                           -- timestamp del cliente (ISO)
  server_ts TEXT NOT NULL,                  -- timestamp del servidor (ISO)
  void_reason TEXT,
  voided_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,               -- snapshot inmutable
  size INTEGER NOT NULL,                    -- snapshot inmutable
  unit_price_cents INTEGER NOT NULL,        -- snapshot inmutable
  quantity INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`;

/**
 * Abre (o crea) la base SQLite y garantiza el esquema.
 * @param {string} file  Ruta del archivo o ':memory:'
 */
export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  } else if (Number(row.value) !== SCHEMA_VERSION) {
    throw new Error(
      `Esquema de base de datos no soportado: versión ${row.value} (esperada ${SCHEMA_VERSION}). Restaura un respaldo o migra manualmente.`
    );
  }
  return db;
}

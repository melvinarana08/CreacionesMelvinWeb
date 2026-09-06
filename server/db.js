// db.js — apertura y esquema SQLite (node:sqlite, cero dependencias).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 2;

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

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_last_used ON clients(last_used_at);

CREATE TABLE IF NOT EXISTS encargos (
  id TEXT PRIMARY KEY,                      -- UUID idempotente
  folio INTEGER NOT NULL UNIQUE,            -- folio secuencial de encargo
  client_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'cancelled')),
  notes TEXT,
  delivery_date TEXT,
  total_cents INTEGER NOT NULL,
  client_ts TEXT,
  server_ts TEXT NOT NULL,
  delivered_at TEXT,
  sale_id TEXT REFERENCES sales(id)
);
CREATE INDEX IF NOT EXISTS idx_encargos_status ON encargos(status);
CREATE INDEX IF NOT EXISTS idx_encargos_client ON encargos(client_name);

CREATE TABLE IF NOT EXISTS encargo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encargo_id TEXT NOT NULL REFERENCES encargos(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_encargo_items_encargo_id ON encargo_items(encargo_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_hash TEXT PRIMARY KEY,             -- SHA-256 del token enviado en cookie
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
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
  } else {
    const v = Number(row.value);
    if (v === 1) {
      // Migración automática v1 -> v2
      db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL,
          last_used_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
        CREATE INDEX IF NOT EXISTS idx_clients_last_used ON clients(last_used_at);

        CREATE TABLE IF NOT EXISTS encargos (
          id TEXT PRIMARY KEY,
          folio INTEGER NOT NULL UNIQUE,
          client_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'cancelled')),
          notes TEXT,
          delivery_date TEXT,
          total_cents INTEGER NOT NULL,
          client_ts TEXT,
          server_ts TEXT NOT NULL,
          delivered_at TEXT,
          sale_id TEXT REFERENCES sales(id)
        );
        CREATE INDEX IF NOT EXISTS idx_encargos_status ON encargos(status);
        CREATE INDEX IF NOT EXISTS idx_encargos_client ON encargos(client_name);

        CREATE TABLE IF NOT EXISTS encargo_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          encargo_id TEXT NOT NULL REFERENCES encargos(id) ON DELETE CASCADE,
          product_name TEXT NOT NULL,
          size TEXT NOT NULL,
          unit_price_cents INTEGER NOT NULL,
          quantity INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_encargo_items_encargo_id ON encargo_items(encargo_id);
      `);
      db.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run();
    } else if (v !== SCHEMA_VERSION) {
      throw new Error(
        `Esquema de base de datos no soportado: versión ${row.value} (esperada ${SCHEMA_VERSION}). Restaura un respaldo o migra manualmente.`
      );
    }
  }
  return db;
}

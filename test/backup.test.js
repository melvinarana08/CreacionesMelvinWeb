// Restore drill automatizado: crea datos reales → respaldo VACUUM INTO →
// restaura a una ruta nueva → verifica integridad (schema, ventas, catálogo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { replaceCatalog, createSale } from '../server/store.js';
import { loadSeed } from '../server/catalog.js';
import { runBackup } from '../scripts/backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cm-backup-'));
}

test('backup produce snapshot consistente y la restauración preserva ventas y catálogo', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'sales.db');
  const db = openDb(dbPath);
  replaceCatalog(db, loadSeed(SEED));
  const sale = createSale(
    db,
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      deviceId: 'dev-backup',
      clientName: 'Prueba Restore',
      lines: [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
      discountCents: 100,
      clientTs: '2026-08-24T12:00:00.000Z',
    },
    loadSeed(SEED)
  );
  db.close();

  // Respaldo
  const backupDir = path.join(dir, 'backups');
  const result = runBackup({ dbPath, destDir: backupDir });
  assert.ok(fs.existsSync(result.backupPath));
  assert.ok(fs.existsSync(result.sha256Path));
  assert.equal(result.sales, 1);
  assert.ok(result.backupPath.endsWith('.db'));

  // Corrupción simulada del original (pérdida de datos)
  fs.rmSync(dbPath);

  // Restauración: copiar el respaldo a la ruta de producción
  const restorePath = path.join(dir, 'sales-restored.db');
  fs.copyFileSync(result.backupPath, restorePath);

  // Drill: abrir la base restaurada y verificar todo
  const restored = openDb(restorePath);
  const cat = restored.prepare("SELECT COUNT(*) AS n FROM products").get();
  assert.ok(cat.n >= 5, `catálogo restaurado: ${cat.n} productos`);
  const saleRow = restored.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
  assert.ok(saleRow, 'la venta existe tras restaurar');
  assert.equal(saleRow.folio, sale.folio);
  assert.equal(saleRow.total_cents, 1200);
  assert.equal(saleRow.status, 'active');
  const items = restored.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].unit_price_cents, 650);
  const schemaVer = restored.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.equal(schemaVer.value, '1');
  restored.close();

  // El sha256 del respaldo coincide con el archivo verificado
  const hash = require_crypto('node:crypto').createHash('sha256').update(fs.readFileSync(result.backupPath)).digest('hex');
  assert.equal(fs.readFileSync(result.sha256Path, 'utf8').trim().split(' ')[0], hash);
});

import { createRequire } from 'node:module';
const require_crypto = createRequire(import.meta.url);

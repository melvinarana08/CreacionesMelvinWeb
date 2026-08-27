import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { loadSeed } from '../server/catalog.js';
import {
  validateSaleInput,
  createSale,
  voidSale,
  getSale,
  listSales,
  replaceCatalog,
  getCatalog,
} from '../server/store.js';
import { HttpError } from '../server/errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');
const catalog = () => loadSeed(SEED);

const validInput = (over = {}) => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  deviceId: 'dev-abc-123',
  clientName: 'María',
  lines: [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
  discountCents: 0,
  clientTs: '2026-08-24T12:00:00.000Z',
  ...over,
});

const expectError = (fn, code, status) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `se esperaba HttpError, got ${e}`);
    assert.equal(e.code, code, `code esperado ${code}, got ${e.code}: ${e.message}`);
    assert.equal(e.status, status);
    return;
  }
  assert.fail(`se esperaba error ${code}`);
};

// ---------- Validación y cálculo puros ----------

test('validateSaleInput calcula subtotal y total con descuento 0', () => {
  const r = validateSaleInput(validInput(), catalog());
  assert.equal(r.subtotalCents, 1300);
  assert.equal(r.discountCents, 0);
  assert.equal(r.totalCents, 1300);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], {
    productName: 'Short',
    size: 10,
    unitPriceCents: 650,
    quantity: 2,
  });
});

test('validateSaleInput aplica descuento al total', () => {
  const r = validateSaleInput(validInput({ discountCents: 300 }), catalog());
  assert.equal(r.subtotalCents, 1300);
  assert.equal(r.totalCents, 1000);
});

test('descuento igual al subtotal deja total en 0', () => {
  const r = validateSaleInput(validInput({ discountCents: 1300 }), catalog());
  assert.equal(r.totalCents, 0);
});

test('descuento mayor al subtotal es rechazado', () => {
  expectError(() => validateSaleInput(validInput({ discountCents: 1301 }), catalog()), 'discount_exceeds_subtotal', 400);
});

test('descuento negativo o no entero es rechazado', () => {
  expectError(() => validateSaleInput(validInput({ discountCents: -1 }), catalog()), 'invalid_discount', 400);
  expectError(() => validateSaleInput(validInput({ discountCents: 1.5 }), catalog()), 'invalid_discount', 400);
  expectError(() => validateSaleInput(validInput({ discountCents: '50' }), catalog()), 'invalid_discount', 400);
});

test('producto inexistente y talla inexistente son rechazados', () => {
  const bad1 = validInput({ lines: [{ product: 'NoExiste', size: 10, quantity: 1, unitPriceCents: 500 }] });
  expectError(() => validateSaleInput(bad1, catalog()), 'product_not_found', 400);
  const bad2 = validInput({ lines: [{ product: 'Short', size: 99, quantity: 1, unitPriceCents: 650 }] });
  expectError(() => validateSaleInput(bad2, catalog()), 'size_not_found', 400);
});

test('precio enviado distinto al catálogo es rechazado (409 price_changed)', () => {
  const bad = validInput({ lines: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 700 }] });
  expectError(() => validateSaleInput(bad, catalog()), 'price_changed', 409);
});

test('cantidad inválida es rechazada', () => {
  for (const q of [0, -2, 1.5, 100, '2', null]) {
    const bad = validInput({ lines: [{ product: 'Short', size: 10, quantity: q, unitPriceCents: 650 }] });
    expectError(() => validateSaleInput(bad, catalog()), 'invalid_quantity', 400);
  }
});

test('uuid, deviceId y clientName inválidos son rechazados', () => {
  expectError(() => validateSaleInput(validInput({ id: 'no-uuid' }), catalog()), 'invalid_id', 400);
  expectError(() => validateSaleInput(validInput({ id: '' }), catalog()), 'invalid_id', 400);
  expectError(() => validateSaleInput(validInput({ deviceId: '' }), catalog()), 'invalid_device_id', 400);
  expectError(() => validateSaleInput(validInput({ deviceId: 'x'.repeat(65) }), catalog()), 'invalid_device_id', 400);
  expectError(() => validateSaleInput(validInput({ clientName: 'x'.repeat(101) }), catalog()), 'invalid_client_name', 400);
});

test('clientName opcional: vacío o solo espacios se acepta como ausente', () => {
  const r1 = validateSaleInput(validInput({ clientName: '' }), catalog());
  assert.equal(r1.clientName, null);
  const r2 = validateSaleInput(validInput({ clientName: '   ' }), catalog());
  assert.equal(r2.clientName, null);
});

test('venta sin líneas es rechazada', () => {
  expectError(() => validateSaleInput(validInput({ lines: [] }), catalog()), 'no_lines', 400);
});

// ---------- Persistencia (SQLite en memoria) ----------

function freshDb() {
  const db = openDb(':memory:');
  replaceCatalog(db, catalog());
  return db;
}

test('createSale persiste venta con folio, snapshots y timestamps', () => {
  const db = freshDb();
  const sale = createSale(db, validInput(), catalog());
  assert.equal(sale.folio, 1);
  assert.equal(sale.status, 'active');
  assert.ok(sale.serverTs);
  assert.equal(sale.clientTs, '2026-08-24T12:00:00.000Z');
  assert.equal(sale.subtotalCents, 1300);
  assert.equal(sale.totalCents, 1300);
  assert.equal(sale.items.length, 1);
  // snapshot de nombre/talla/precio
  assert.equal(sale.items[0].productName, 'Short');
  assert.equal(sale.items[0].size, 10);
  assert.equal(sale.items[0].unitPriceCents, 650);
  db.close();
});

test('createSale es idempotente por UUID: misma venta, mismo folio, sin duplicados', () => {
  const db = freshDb();
  const a = createSale(db, validInput(), catalog());
  const b = createSale(db, validInput(), catalog());
  assert.equal(a.id, b.id);
  assert.equal(a.folio, b.folio);
  assert.equal(listSales(db).length, 1);
  const all = db.prepare('SELECT COUNT(*) AS n FROM sale_items').get();
  assert.equal(all.n, 1, 'no debe duplicar líneas');
  db.close();
});

test('folios son secuenciales por servidor', () => {
  const db = freshDb();
  const s1 = createSale(db, validInput({ id: '123e4567-e89b-12d3-a456-426614174001' }), catalog());
  const s2 = createSale(db, validInput({ id: '123e4567-e89b-12d3-a456-426614174002' }), catalog());
  assert.equal(s1.folio, 1);
  assert.equal(s2.folio, 2);
  db.close();
});

test('los snapshots sobreviven a cambios de catálogo posteriores', () => {
  const db = freshDb();
  const sale = createSale(db, validInput(), catalog());
  // admin sube el precio de Short talla 10 a $9.00
  replaceCatalog(db, [
    ...catalog().filter((p) => p.name !== 'Short'),
    { name: 'Short', sizes: [{ size: 10, priceCents: 900 }] },
  ]);
  const fetched = getSale(db, sale.id);
  assert.equal(fetched.items[0].unitPriceCents, 650, 'la línea conserva su precio histórico');
  assert.equal(fetched.totalCents, 1300);
  db.close();
});

test('anulación conserva la venta original y registra motivo y fecha', () => {
  const db = freshDb();
  const sale = createSale(db, validInput(), catalog());
  const voided = voidSale(db, sale.id, 'Error de registro');
  assert.equal(voided.status, 'voided');
  assert.equal(voided.voidReason, 'Error de registro');
  assert.ok(voided.voidedAt);
  // original intacto
  assert.equal(voided.subtotalCents, 1300);
  assert.equal(voided.items.length, 1);
  assert.equal(voided.items[0].unitPriceCents, 650);
  db.close();
});

test('anular dos veces o una venta inexistente falla', () => {
  const db = freshDb();
  const sale = createSale(db, validInput(), catalog());
  voidSale(db, sale.id, 'Motivo');
  expectError(() => voidSale(db, sale.id, 'Otro'), 'already_voided', 409);
  expectError(() => voidSale(db, '123e4567-e89b-12d3-a456-426614174999', 'x'), 'sale_not_found', 404);
  db.close();
});

test('anular exige motivo no vacío', () => {
  const db = freshDb();
  const sale = createSale(db, validInput(), catalog());
  expectError(() => voidSale(db, sale.id, ''), 'invalid_reason', 400);
  expectError(() => voidSale(db, sale.id, '   '), 'invalid_reason', 400);
  db.close();
});

test('getCatalog devuelve el catálogo persistido', () => {
  const db = freshDb();
  const cat = getCatalog(db);
  assert.ok(cat.some((p) => p.name === 'Short'));
  const short = cat.find((p) => p.name === 'Short');
  assert.ok(short.sizes.some((s) => s.size === 10 && s.priceCents === 650));
  db.close();
});

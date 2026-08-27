// store.js — persistencia y dominio de ventas/catálogo sobre SQLite.
// Reglas de negocio:
//  - Cada línea guarda snapshot de nombre/talla/precio (inmutable).
//  - Precio de venta = precio vigente del catálogo en el momento de la venta.
//  - Folio central secuencial, asignado por el servidor.
//  - Idempotencia por UUID: reenviar la misma venta devuelve la existente.
//  - La anulación NUNCA edita/elimina la venta: solo marca status + motivo.
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';
import { lineTotal } from './money.js';
import { findProduct, findSize, normalizeSize, validateCatalog } from './catalog.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QTY = 99;
const MAX_CLIENT_NAME = 100;
const MAX_REASON = 200;
const MAX_DEVICE_ID = 64;

// ---------- Catálogo ----------

/** Reemplaza el catálogo completo (operación de admin), transaccional. */
export function replaceCatalog(db, catalog) {
  let clean;
  try {
    clean = validateCatalog(catalog);
  } catch (e) {
    throw new HttpError(400, 'invalid_catalog', e.message);
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM products').run();
    const ins = db.prepare('INSERT INTO products (name, size, price_cents) VALUES (?, ?, ?)');
    for (const p of clean) {
      for (const s of p.sizes) ins.run(p.name, s.size, s.priceCents);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return clean;
}

/** Lee el catálogo desde la tabla products. */
export function getCatalog(db) {
  const rows = db.prepare('SELECT name, size, price_cents FROM products ORDER BY name, size').all();
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push({ size: r.size, priceCents: r.price_cents });
  }
  return [...byName.entries()].map(([name, sizes]) => ({ name, sizes }));
}

// ---------- Ventas ----------

/** Valida el payload de una venta contra el catálogo vigente y calcula totales. */
export function validateSaleInput(input, catalog) {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!UUID_RE.test(id)) throw new HttpError(400, 'invalid_id', 'El id de la venta debe ser un UUID válido');

  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  if (!deviceId || deviceId.length > MAX_DEVICE_ID) {
    throw new HttpError(400, 'invalid_device_id', 'deviceId es obligatorio (máx 64 caracteres)');
  }

  let clientName = typeof input.clientName === 'string' ? input.clientName.trim() : '';
  if (clientName.length > MAX_CLIENT_NAME) {
    throw new HttpError(400, 'invalid_client_name', `Cliente demasiado largo (máx ${MAX_CLIENT_NAME})`);
  }
  if (clientName === '') clientName = null;

  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!lines || lines.length === 0) throw new HttpError(400, 'no_lines', 'La venta debe tener al menos una línea');

  const items = [];
  let subtotalCents = 0;
  for (const raw of lines) {
    const product = typeof raw.product === 'string' ? raw.product.trim() : '';
    const productEntry = findProduct(catalog, product);
    if (!productEntry) throw new HttpError(400, 'product_not_found', `Producto no existe en el catálogo: ${product}`);

    const size = normalizeSize(raw.size);
    const catalogPrice = findSize(productEntry, size);
    if (catalogPrice === null) throw new HttpError(400, 'size_not_found', `Talla ${raw.size} no existe para ${product}`);

    const quantity = raw.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new HttpError(400, 'invalid_quantity', `Cantidad inválida para ${product} talla ${size}`);
    }

    const unitPriceCents = raw.unitPriceCents;
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new HttpError(400, 'invalid_price', `Precio inválido para ${product} talla ${size}`);
    }
    if (unitPriceCents !== catalogPrice) {
      throw new HttpError(
        409,
        'price_changed',
        `El precio de ${product} talla ${size} cambió (esperado ${catalogPrice}, recibido ${unitPriceCents}). Refresca el catálogo y confirma la venta de nuevo.`
      );
    }

    items.push({ productName: productEntry.name, size, unitPriceCents, quantity });
    subtotalCents += lineTotal(unitPriceCents, quantity);
  }

  const discountCents = input.discountCents;
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new HttpError(400, 'invalid_discount', 'El descuento debe ser un entero no negativo');
  }
  if (discountCents > subtotalCents) {
    throw new HttpError(400, 'discount_exceeds_subtotal', 'El descuento no puede ser mayor al subtotal');
  }

  return {
    id,
    deviceId,
    clientName,
    items,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    clientTs: typeof input.clientTs === 'string' && input.clientTs ? input.clientTs : null,
  };
}

/** Inserta una venta y sus líneas en una transacción. Asigna folio. */
function insertSaleTx(db, sale) {
  const folio = db.prepare('SELECT COALESCE(MAX(folio), 0) + 1 AS f FROM sales').get().f;
  const serverTs = new Date().toISOString();
  db.prepare(
    `INSERT INTO sales (id, folio, client_name, device_id, subtotal_cents, discount_cents, total_cents, status, client_ts, server_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    sale.id,
    folio,
    sale.clientName,
    sale.deviceId,
    sale.subtotalCents,
    sale.discountCents,
    sale.totalCents,
    sale.clientTs,
    serverTs
  );
  const insItem = db.prepare(
    'INSERT INTO sale_items (sale_id, product_name, size, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?)'
  );
  for (const it of sale.items) {
    insItem.run(sale.id, it.productName, it.size, it.unitPriceCents, it.quantity);
  }
  return { ...sale, folio, serverTs, status: 'active', voidReason: null, voidedAt: null };
}

/**
 * Crea una venta. Idempotente: si el UUID ya existe, devuelve la venta
 * existente sin crear nada nuevo.
 */
export function createSale(db, input, catalog) {
  const sale = validateSaleInput(input, catalog);

  const existing = getSale(db, sale.id);
  if (existing) return existing;

  db.exec('BEGIN');
  try {
    // Doble chequeo dentro de la transacción (carrera entre procesos)
    const dup = db.prepare('SELECT id FROM sales WHERE id = ?').get(sale.id);
    if (dup) {
      db.exec('COMMIT');
      return getSale(db, sale.id);
    }
    const created = insertSaleTx(db, sale);
    db.exec('COMMIT');
    return created;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Devuelve una venta con sus líneas, o null. */
export function getSale(db, id) {
  const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!row) return null;
  return hydrate(db, row);
}

function hydrate(db, row) {
  const items = db
    .prepare('SELECT product_name, size, unit_price_cents, quantity FROM sale_items WHERE sale_id = ? ORDER BY id')
    .all(row.id)
    .map((i) => ({
      productName: i.product_name,
      size: i.size,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
    }));
  return {
    id: row.id,
    folio: row.folio,
    clientName: row.client_name,
    deviceId: row.device_id,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    status: row.status,
    clientTs: row.client_ts,
    serverTs: row.server_ts,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    items,
  };
}

/** Lista ventas (más recientes primero), con líneas. */
export function listSales(db, { status = null, limit = 100 } = {}) {
  const params = [];
  let sql = 'SELECT * FROM sales';
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY folio DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return db.prepare(sql).all(...params).map((r) => hydrate(db, r));
}

/**
 * Anula una venta: conserva TODO el original y registra motivo + fecha.
 * No permite editar ni eliminar ventas.
 */
export function voidSale(db, id, reason) {
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!cleanReason || cleanReason.length > MAX_REASON) {
    throw new HttpError(400, 'invalid_reason', `El motivo es obligatorio (máx ${MAX_REASON} caracteres)`);
  }
  const sale = getSale(db, id);
  if (!sale) throw new HttpError(404, 'sale_not_found', 'Venta no encontrada');
  if (sale.status === 'voided') throw new HttpError(409, 'already_voided', 'La venta ya está anulada');

  const voidedAt = new Date().toISOString();
  db.prepare("UPDATE sales SET status = 'voided', void_reason = ?, voided_at = ? WHERE id = ?").run(
    cleanReason,
    voidedAt,
    id
  );
  return getSale(db, id);
}

/** UUID v4 para pruebas/uso puntual. */
export function newSaleId() {
  return randomUUID();
}

// ---------- Audit log ----------

/** Registra una acción administrativa (login, anulación, catálogo, logout...). */
export function logAudit(db, action, actor = null, detail = null) {
  db.prepare('INSERT INTO audit_log (ts, action, actor, detail) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    action,
    actor,
    detail ? JSON.stringify(detail) : null
  );
}

/** Lista entradas del audit log, más recientes primero. */
export function listAudit(db, limit = 200) {
  return db
    .prepare('SELECT id, ts, action, actor, detail FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 200, 1), 1000))
    .map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

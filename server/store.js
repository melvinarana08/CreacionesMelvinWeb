// store.js — persistencia y dominio de ventas/catálogo sobre SQLite.
// Reglas de negocio:
//  - Cada línea guarda snapshot de nombre/talla/precio (inmutable).
//  - Precio de venta = precio vigente del catálogo, salvo línea manual explícita.
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
    if (size === null) throw new HttpError(400, 'invalid_size', `Talla inválida para ${product}`);
    const manual = raw.customPrice === true;
    if (raw.customPrice !== undefined && !manual) {
      throw new HttpError(400, 'invalid_custom_price', 'Indicador de precio manual inválido');
    }
    const catalogPrice = findSize(productEntry, size);
    if (!manual && catalogPrice === null) throw new HttpError(400, 'size_not_found', `Talla ${raw.size} no existe para ${product}`);

    const quantity = raw.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new HttpError(400, 'invalid_quantity', `Cantidad inválida para ${product} talla ${size}`);
    }

    const unitPriceCents = raw.unitPriceCents;
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > 1_000_000) {
      throw new HttpError(400, 'invalid_price', `Precio inválido para ${product} talla ${size}`);
    }
    if (!manual && unitPriceCents !== catalogPrice) {
      throw new HttpError(
        409,
        'price_changed',
        `El precio de ${product} talla ${size} cambió (esperado ${catalogPrice}, recibido ${unitPriceCents}). Refresca el catálogo y confirma la venta de nuevo.`
      );
    }

    items.push({ productName: productEntry.name, size, unitPriceCents, quantity,
      ...(manual ? { customPrice: true } : {}) });
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
    'INSERT INTO sale_items (sale_id, product_name, size, unit_price_cents, quantity, custom_price) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const it of sale.items) {
    insItem.run(sale.id, it.productName, it.size, it.unitPriceCents, it.quantity, Number(it.customPrice === true));
  }
  if (sale.clientName) {
    upsertClient(db, sale.clientName);
  }
  return { ...sale, folio, serverTs, status: 'active', revision: 0, voidReason: null, voidedAt: null };
}

/**
 * Crea una venta. Idempotente: si el UUID ya existe, devuelve la venta
 * existente sin crear nada nuevo.
 */
export function createSale(db, input, catalog) {
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  if (UUID_RE.test(id)) {
    const existing = getSale(db, id);
    if (existing) {
      const discountCents = input.discountCents;
      if (!Number.isInteger(discountCents) || discountCents < 0) {
        throw new HttpError(400, 'invalid_discount', 'El descuento debe ser un entero no negativo');
      }
      if (discountCents > existing.subtotalCents) {
        throw new HttpError(400, 'discount_exceeds_subtotal', 'El descuento no puede ser mayor al subtotal');
      }
      return existing;
    }
  }

  const sale = validateSaleInput(input, catalog);

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
    .prepare('SELECT product_name, size, unit_price_cents, quantity, custom_price FROM sale_items WHERE sale_id = ? ORDER BY id')
    .all(row.id)
    .map((i) => ({
      productName: i.product_name,
      size: i.size,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      ...(i.custom_price ? { customPrice: true } : {}),
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
    revision: row.revision,
    clientTs: row.client_ts,
    serverTs: row.server_ts,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    items,
    corrections: db.prepare('SELECT revision, corrected_at, actor, before_snapshot, after_snapshot FROM sale_corrections WHERE sale_id = ? ORDER BY revision').all(row.id).map((c) => ({
      revision: c.revision, correctedAt: c.corrected_at, actor: c.actor,
      before: JSON.parse(c.before_snapshot), after: JSON.parse(c.after_snapshot),
    })),
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

/** Atomically correct an active sale; exact retry keys replay without appending history. */
export function correctSale(db, id, input, catalog, actor = null) {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new HttpError(400, 'invalid_revision', 'Revisión esperada inválida');
  }
  if (typeof input.retryKey !== 'string' || !UUID_RE.test(input.retryKey)) {
    throw new HttpError(400, 'invalid_retry_key', 'Clave de reintento inválida');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, 'no_lines', 'La venta debe tener al menos una línea');
  }
  const request = JSON.stringify({ expectedRevision: input.expectedRevision, retryKey: input.retryKey,
    clientName: input.clientName, discountCents: input.discountCents, lines: input.lines });
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior = getSale(db, id);
    if (!prior) throw new HttpError(404, 'sale_not_found', 'Venta no encontrada');
    const replay = db.prepare('SELECT request, revision FROM sale_corrections WHERE sale_id = ? AND retry_key = ?').get(id, input.retryKey);
    if (replay) {
      if (replay.request !== request) throw new HttpError(409, 'retry_key_conflict', 'Clave de reintento utilizada con otros datos');
      if (replay.revision !== prior.revision) throw new HttpError(409, 'stale_revision', 'La venta fue modificada después de esta corrección');
      db.exec('COMMIT');
      return prior;
    }
    if (prior.status !== 'active') throw new HttpError(409, 'already_voided', 'La venta ya está anulada');
    if (prior.revision !== input.expectedRevision) throw new HttpError(409, 'stale_revision', 'La venta fue modificada; recarga antes de corregir');
    const available = [...prior.items];
    const items = [];
    let subtotalCents = 0;
    for (const raw of input.lines) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new HttpError(400, 'invalid_line', 'Línea de venta inválida');
      }
      const matched = available.findIndex((item) => item.productName === raw?.product && item.size === raw.size
        && item.quantity === raw.quantity && item.unitPriceCents === raw.unitPriceCents
        && Boolean(item.customPrice) === (raw.customPrice === true) &&
        (raw.customPrice === undefined || raw.customPrice === true));
      let item;
      if (matched >= 0) item = available.splice(matched, 1)[0];
      else item = validateSaleInput({ id, deviceId: prior.deviceId, clientName: null,
        lines: [raw], discountCents: 0 }, catalog).items[0];
      items.push(item);
      subtotalCents += lineTotal(item.unitPriceCents, item.quantity);
    }
    const clientName = typeof input.clientName === 'string' ? input.clientName.trim() : input.clientName;
    if (clientName !== null && (typeof clientName !== 'string' || clientName.length > MAX_CLIENT_NAME)) {
      throw new HttpError(400, 'invalid_client_name', 'Cliente inválido');
    }
    if (!Number.isSafeInteger(input.discountCents) || input.discountCents < 0) {
      throw new HttpError(400, 'invalid_discount', 'Descuento inválido');
    }
    if (input.discountCents > subtotalCents) throw new HttpError(400, 'discount_exceeds_subtotal', 'El descuento no puede ser mayor al subtotal');
    const revision = prior.revision + 1;
    const updated = db.prepare('UPDATE sales SET client_name = ?, subtotal_cents = ?, discount_cents = ?, total_cents = ?, revision = ? WHERE id = ? AND status = ? AND revision = ?')
      .run(clientName || null, subtotalCents, input.discountCents, subtotalCents - input.discountCents, revision, id, 'active', prior.revision);
    if (updated.changes !== 1) throw new HttpError(409, 'stale_revision', 'La venta fue modificada');
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(id);
    const insert = db.prepare('INSERT INTO sale_items (sale_id, product_name, size, unit_price_cents, quantity, custom_price) VALUES (?, ?, ?, ?, ?, ?)');
    for (const item of items) insert.run(id, item.productName, item.size, item.unitPriceCents, item.quantity, Number(item.customPrice === true));
    if (clientName) upsertClient(db, clientName);
    const after = getSale(db, id);
    const snapshot = (sale) => ({ id: sale.id, folio: sale.folio, revision: sale.revision,
      clientName: sale.clientName, items: sale.items, subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents, totalCents: sale.totalCents });
    db.prepare('INSERT INTO sale_corrections (sale_id, revision, retry_key, request, corrected_at, actor, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, revision, input.retryKey, request, new Date().toISOString(), actor, JSON.stringify(snapshot(prior)), JSON.stringify(snapshot(after)));
    db.exec('COMMIT');
    return getSale(db, id);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
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

// ---------- Clientes recordados ----------

export function upsertClient(db, name) {
  if (typeof name !== 'string') return null;
  const clean = name.trim();
  if (!clean || clean.length > MAX_CLIENT_NAME) return null;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO clients (name, created_at, last_used_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET last_used_at = excluded.last_used_at
  `).run(clean, now, now);
  return clean;
}

export function listClients(db, limit = 50) {
  return db
    .prepare('SELECT name, last_used_at FROM clients ORDER BY last_used_at DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .map((r) => r.name);
}

function validateClientName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.trim();
  if (!clean || clean.length > MAX_CLIENT_NAME) return null;
  return clean;
}

/**
 * Renombra un cliente del directorio (edición de error de tipeo).
 * Solo cambia `name`: created_at y last_used_at se conservan; el historial de
 * ventas/encargos no se toca (client_name queda como fue registrado).
 */
export function renameClient(db, from, to) {
  const fromName = validateClientName(from);
  const toName = validateClientName(to);
  if (!fromName || !toName) {
    throw new HttpError(400, 'invalid_client_name', `Nombre de cliente inválido (máx ${MAX_CLIENT_NAME} caracteres y no vacío)`);
  }
  const source = db.prepare('SELECT name FROM clients WHERE name = ? COLLATE NOCASE LIMIT 1').get(fromName);
  if (!source) {
    throw new HttpError(404, 'client_not_found', 'Ese cliente no está en el directorio');
  }
  const caseOnly = toName.toLocaleLowerCase('es') === fromName.toLocaleLowerCase('es');
  if (!caseOnly) {
    const clash = db
      .prepare('SELECT 1 FROM clients WHERE name = ? COLLATE NOCASE AND name <> ? COLLATE NOCASE LIMIT 1')
      .get(toName, source.name);
    if (clash) {
      throw new HttpError(409, 'client_name_taken', `Ya existe un cliente guardado con el nombre "${toName}"`);
    }
  }
  db.prepare('UPDATE clients SET name = ? WHERE name = ? COLLATE NOCASE').run(toName, source.name);
  return toName;
}

/** Elimina un cliente del directorio por nombre (case-insensitive). No toca ventas ni encargos. */
export function deleteClient(db, name) {
  const clean = validateClientName(name);
  if (!clean) {
    throw new HttpError(400, 'invalid_client_name', `Nombre de cliente inválido (máx ${MAX_CLIENT_NAME} caracteres y no vacío)`);
  }
  const source = db.prepare('SELECT name FROM clients WHERE name = ? COLLATE NOCASE LIMIT 1').get(clean);
  if (!source) {
    throw new HttpError(404, 'client_not_found', 'Ese cliente no está en el directorio');
  }
  db.prepare('DELETE FROM clients WHERE name = ? COLLATE NOCASE').run(source.name);
  return source.name;
}

// ---------- Encargos (Pedidos a futuro) ----------

export function validateEncargoInput(input, catalog = []) {
  if (!input || typeof input !== 'object') {
    throw new HttpError(400, 'invalid_payload', 'Payload de encargo inválido');
  }
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID();
  if (!UUID_RE.test(id)) {
    throw new HttpError(400, 'invalid_id', 'El id del encargo debe ser un UUID válido');
  }

  const clientName = typeof input.clientName === 'string' ? input.clientName.trim() : '';
  if (!clientName) {
    throw new HttpError(400, 'missing_client_name', 'El nombre del cliente es obligatorio para un encargo');
  }
  if (clientName.length > MAX_CLIENT_NAME) {
    throw new HttpError(400, 'client_name_too_long', `El nombre del cliente supera ${MAX_CLIENT_NAME} caracteres`);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, 'empty_items', 'El encargo debe tener al menos una prenda');
  }

  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 300) : null;
  const deliveryDate = typeof input.deliveryDate === 'string' && input.deliveryDate.trim() ? input.deliveryDate.trim().slice(0, 50) : null;
  const clientTs = typeof input.clientTs === 'string' && !Number.isNaN(Date.parse(input.clientTs)) ? input.clientTs : null;

  const items = [];
  let totalCents = 0;

  for (const it of input.items) {
    if (!it || typeof it !== 'object') {
      throw new HttpError(400, 'invalid_item', 'Línea de encargo inválida');
    }
    const productName = typeof it.productName === 'string' ? it.productName.trim() : '';
    if (!productName) {
      throw new HttpError(400, 'invalid_product_name', 'Producto no válido en encargo');
    }
    const size = normalizeSize(it.size);
    if (size === null) {
      throw new HttpError(400, 'invalid_size', `Talla inválida en ${productName}`);
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new HttpError(400, 'invalid_quantity', `Cantidad inválida para ${productName} (1-${MAX_QTY})`);
    }

    let unitPriceCents = Number(it.unitPriceCents);
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      const prod = findProduct(catalog, productName);
      const sizeObj = prod ? findSize(prod, size) : null;
      unitPriceCents = sizeObj ? sizeObj.priceCents : 0;
    }

    const itemTotal = lineTotal(unitPriceCents, qty);
    totalCents += itemTotal;

    items.push({
      productName,
      size,
      quantity: qty,
      unitPriceCents,
    });
  }

  return {
    id,
    clientName,
    notes,
    deliveryDate,
    clientTs,
    items,
    totalCents,
  };
}

export function createEncargo(db, input, catalog = []) {
  const encargo = validateEncargoInput(input, catalog);

  const existing = getEncargo(db, encargo.id);
  if (existing) return existing;

  db.exec('BEGIN');
  try {
    const dup = db.prepare('SELECT id FROM encargos WHERE id = ?').get(encargo.id);
    if (dup) {
      db.exec('COMMIT');
      return getEncargo(db, encargo.id);
    }

    const folio = db.prepare('SELECT COALESCE(MAX(folio), 0) + 1 AS f FROM encargos').get().f;
    const serverTs = new Date().toISOString();

    db.prepare(`
      INSERT INTO encargos (id, folio, client_name, status, notes, delivery_date, total_cents, client_ts, server_ts)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      encargo.id,
      folio,
      encargo.clientName,
      encargo.notes,
      encargo.deliveryDate,
      encargo.totalCents,
      encargo.clientTs,
      serverTs
    );

    const insItem = db.prepare(`
      INSERT INTO encargo_items (encargo_id, product_name, size, unit_price_cents, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const it of encargo.items) {
      insItem.run(encargo.id, it.productName, String(it.size), it.unitPriceCents, it.quantity);
    }

    upsertClient(db, encargo.clientName);

    db.exec('COMMIT');
    return getEncargo(db, encargo.id);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getEncargo(db, id) {
  const row = db.prepare('SELECT * FROM encargos WHERE id = ?').get(id);
  if (!row) return null;
  const items = db
    .prepare('SELECT product_name, size, unit_price_cents, quantity FROM encargo_items WHERE encargo_id = ? ORDER BY id')
    .all(row.id)
    .map((i) => ({
      productName: i.product_name,
      size: /^\d+$/.test(i.size) ? Number(i.size) : i.size,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
    }));
  return {
    id: row.id,
    folio: row.folio,
    clientName: row.client_name,
    status: row.status,
    notes: row.notes,
    deliveryDate: row.delivery_date,
    totalCents: row.total_cents,
    clientTs: row.client_ts,
    serverTs: row.server_ts,
    deliveredAt: row.delivered_at,
    saleId: row.sale_id,
    items,
  };
}

export function listEncargos(db, options = {}) {
  const { status = 'pending', limit = 100 } = typeof options === 'string' ? { status: options } : (options || {});
  const params = [];
  let sql = 'SELECT * FROM encargos';
  if (status && status !== 'all') {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY folio DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));

  const rows = db.prepare(sql).all(...params);
  if (rows.length === 0) return [];

  const encargoIds = rows.map((r) => r.id);
  const placeholders = encargoIds.map(() => '?').join(',');
  const allItems = db
    .prepare(`SELECT encargo_id, product_name, size, unit_price_cents, quantity FROM encargo_items WHERE encargo_id IN (${placeholders}) ORDER BY id`)
    .all(...encargoIds);

  const itemsByEncargo = new Map();
  for (const it of allItems) {
    if (!itemsByEncargo.has(it.encargo_id)) itemsByEncargo.set(it.encargo_id, []);
    itemsByEncargo.get(it.encargo_id).push({
      productName: it.product_name,
      size: /^\d+$/.test(it.size) ? Number(it.size) : it.size,
      unitPriceCents: it.unit_price_cents,
      quantity: it.quantity,
    });
  }

  return rows.map((row) => ({
    id: row.id,
    folio: row.folio,
    clientName: row.client_name,
    status: row.status,
    notes: row.notes,
    deliveryDate: row.delivery_date,
    totalCents: row.total_cents,
    clientTs: row.client_ts,
    serverTs: row.server_ts,
    deliveredAt: row.delivered_at,
    saleId: row.sale_id,
    items: itemsByEncargo.get(row.id) || [],
  }));
}

export function deliverEncargo(db, id, saleId = null) {
  const encargo = getEncargo(db, id);
  if (!encargo) throw new HttpError(404, 'encargo_not_found', 'Encargo no encontrado');
  if (encargo.status === 'delivered') return encargo;

  const deliveredAt = new Date().toISOString();
  db.prepare(`
    UPDATE encargos
    SET status = 'delivered', delivered_at = ?, sale_id = ?
    WHERE id = ?
  `).run(deliveredAt, saleId, id);

  return getEncargo(db, id);
}

export function cancelEncargo(db, id) {
  const encargo = getEncargo(db, id);
  if (!encargo) throw new HttpError(404, 'encargo_not_found', 'Encargo no encontrado');
  if (encargo.status === 'cancelled') return encargo;
  if (encargo.status === 'delivered') throw new HttpError(409, 'already_delivered', 'No se puede cancelar un encargo ya entregado');

  db.prepare("UPDATE encargos SET status = 'cancelled' WHERE id = ?").run(id);
  return getEncargo(db, id);
}

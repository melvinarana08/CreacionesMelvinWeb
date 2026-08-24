// domain.js — dominio puro del frontend (cálculos y validaciones del carrito).
// ESM puro: se importa desde app.js (navegador, <script type="module">) y
// desde los tests (node:test). Sin dependencias del DOM para poder testearlo.
'use strict';

const MAX_QTY = 99;

export function computeLineTotal(unitPriceCents, quantity) {
  return unitPriceCents * quantity;
}

export function computeSubtotal(lines) {
  return lines.reduce((acc, l) => acc + computeLineTotal(l.unitPriceCents, l.quantity), 0);
}

export function computeTotal(subtotalCents, discountCents) {
  return subtotalCents - discountCents;
}

/** Valida un descuento manual: entero no negativo y <= subtotal. */
export function validateDiscount(discountCents, subtotalCents) {
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    return { ok: false, reason: 'El descuento debe ser un número no negativo' };
  }
  if (discountCents > subtotalCents) {
    return { ok: false, reason: 'El descuento no puede ser mayor al subtotal' };
  }
  return { ok: true };
}

/** Valida una línea del carrito (producto + talla + cantidad + precio snapshot). */
export function validateLine(line) {
  if (!line || typeof line.product !== 'string' || line.product.trim() === '') {
    return { ok: false, reason: 'Falta el producto' };
  }
  if (typeof line.size !== 'number') return { ok: false, reason: 'Falta la talla' };
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) {
    return { ok: false, reason: `La cantidad debe ser entre 1 y ${MAX_QTY}` };
  }
  if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    return { ok: false, reason: 'Precio de la línea inválido' };
  }
  return { ok: true };
}

/**
 * Construye el payload de venta para la API, validando todo.
 * @returns {{ok:true, payload:object}|{ok:false, reason:string}}
 */
export function buildSalePayload({ cart, clientName, discountCents, deviceId, id, clientTs }) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, reason: 'Agrega al menos un producto' };
  }
  for (const line of cart) {
    const v = validateLine(line);
    if (!v.ok) return v;
  }
  const subtotal = computeSubtotal(cart);
  const d = validateDiscount(discountCents, subtotal);
  if (!d.ok) return d;
  const cleanClient = typeof clientName === 'string' ? clientName.trim() : '';
  if (cleanClient.length > 100) {
    return { ok: false, reason: 'El cliente es demasiado largo' };
  }
  if (typeof id !== 'string' || id.length === 0 || typeof deviceId !== 'string' || deviceId.length === 0) {
    return { ok: false, reason: 'Faltan datos de dispositivo o identificación' };
  }
  return {
    ok: true,
    payload: {
      id,
      deviceId,
      clientName: cleanClient === '' ? null : cleanClient,
      lines: cart.map((l) => ({
        product: l.product,
        size: l.size,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
      })),
      discountCents,
      clientTs: typeof clientTs === 'string' ? clientTs : new Date().toISOString(),
    },
  };
}

/** Parsea entrada de descuento en dólares a centavos; null si inválida. */
export function parseDiscountInput(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatUSD(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Convierte el catálogo interno a formato productos.json {name: [{talla, precio}]}. */
export function catalogToEditor(catalog) {
  const out = {};
  for (const p of catalog) {
    out[p.name] = p.sizes.map((s) => ({ talla: s.size, precio: s.priceCents / 100 }));
  }
  return out;
}

/** Convierte el formato productos.json al catálogo interno [{name, sizes:[{size, priceCents}]}]. */
export function editorToCatalog(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('El catálogo debe ser un objeto con categorías');
  }
  const out = [];
  for (const [name, entries] of Object.entries(obj)) {
    if (!Array.isArray(entries)) throw new Error(`Categoría "${name}" debe ser una lista`);
    const sizes = entries.map((e) => ({ size: e.talla, priceCents: Math.round(Number(e.precio) * 100) }));
    out.push({ name, sizes });
  }
  return out;
}

// ---- Editor de precios estructurado (UI de administración, v0.1) ----

/**
 * Prepara el modelo editable del editor de precios: por producto, una entrada
 * por talla con el precio como texto (2 decimales) listo para un <input>.
 * @param {Array<{name:string, sizes:Array<{size:number, priceCents:number}>}>} catalog
 */
export function priceEditorFromCatalog(catalog) {
  return catalog.map((p) => ({
    name: p.name,
    sizes: p.sizes.map((s) => ({
      size: s.size,
      priceCents: s.priceCents,
      priceInput: (s.priceCents / 100).toFixed(2),
    })),
  }));
}

/**
 * Convierte el modelo del editor (con priceInput en texto) de vuelta a
 * catálogo interno, validando cada precio. v0.1: solo edita precios de
 * productos/tallas EXISTENTES (no crea ni elimina).
 * @returns {{ok:true, catalog:Array}|{ok:false, reason:string}}
 */
export function priceEditorToCatalog(editor) {
  if (!Array.isArray(editor)) return { ok: false, reason: 'Editor inválido' };
  const catalog = [];
  for (const p of editor) {
    const sizes = [];
    for (const s of p.sizes) {
      const n = Number(s.priceInput);
      if (typeof s.priceInput !== 'string' || s.priceInput.trim() === '' || !Number.isFinite(n) || n < 0) {
        return { ok: false, reason: `Precio inválido en ${p.name} (talla ${s.size})` };
      }
      sizes.push({ size: s.size, priceCents: Math.round(n * 100) });
    }
    catalog.push({ name: p.name, sizes });
  }
  return { ok: true, catalog };
}

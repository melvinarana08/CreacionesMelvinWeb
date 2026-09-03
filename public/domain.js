// domain.js — dominio puro del frontend (cálculos y validaciones del carrito).
// ESM puro: se importa desde app.js (navegador, <script type="module">) y
// desde los tests (node:test). Sin dependencias del DOM para poder testearlo.
'use strict';

const MAX_QTY = 99;
const MAX_SIZE_LEN = 20;
const STANDARD_SIZE_LABELS = new Map([
  ['xs', 'XS'], ['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL'],
  ['2xl', '2XL'], ['3xl', '3XL'], ['otro', 'Otro'],
]);

export function normalizeSizeInput(size) {
  if (typeof size === 'number') return Number.isInteger(size) && size >= 1 ? size : null;
  if (typeof size !== 'string') return null;
  const clean = size.trim();
  if (!clean || clean.length > MAX_SIZE_LEN) return null;
  if (/^\d+$/.test(clean)) {
    const numeric = Number(clean);
    return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : null;
  }
  return STANDARD_SIZE_LABELS.get(clean.toLowerCase()) ?? clean;
}

function sizeKey(size) {
  return typeof size === 'number' ? `n:${size}` : `s:${size.toLocaleLowerCase('es')}`;
}

export function computeLineTotal(unitPriceCents, quantity) {
  return unitPriceCents * quantity;
}

export function computeSubtotal(lines) {
  return lines.reduce((acc, l) => acc + computeLineTotal(l.unitPriceCents, l.quantity), 0);
}

/**
 * Agrupa líneas por categoría/producto conservando el orden en que apareció
 * cada categoría. Dentro de cada grupo coloca primero las tallas numéricas de
 * menor a mayor y después las tallas de letras en su orden original.
 * Devuelve un arreglo nuevo sin mutar las líneas recibidas.
 */
export function groupLinesByProduct(lines) {
  if (!Array.isArray(lines)) return [];
  const groups = new Map();
  for (const line of lines) {
    const key = typeof line?.product === 'string' ? line.product : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  return [...groups.values()].flatMap((group) => [...group].sort((a, b) => {
    const aNumeric = typeof a?.size === 'number';
    const bNumeric = typeof b?.size === 'number';
    if (aNumeric && bNumeric) return a.size - b.size;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return 0;
  }));
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
  if (normalizeSizeInput(line.size) === null) return { ok: false, reason: 'Falta la talla' };
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
      lines: groupLinesByProduct(cart).map((l) => ({
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

/** Texto visible para explicar cantidad y precio unitario sin confundirlo con el total de línea. */
export function formatUnitPriceSummary(line) {
  return `Talla ${line.size} · Cantidad ${line.quantity} · Unitario ${formatUSD(line.unitPriceCents)}`;
}

/**
 * Filas de precios para la consulta pública: el producto indicado por nombre,
 * o todos si filterName está vacío. Conserva el orden del catálogo y no lo muta.
 * @param {Array<{name:string, sizes:Array<{size:number, priceCents:number}>}>} catalog
 * @param {string} [filterName]
 * @returns {Array<{name:string, sizes:Array<{size:number, priceCents:number}>}>}
 */
export function priceRowsFromCatalog(catalog, filterName = '') {
  if (!Array.isArray(catalog)) return [];
  const rows = typeof filterName === 'string' && filterName !== ''
    ? catalog.filter((p) => p.name === filterName)
    : catalog;
  return rows.map((p) => ({ name: p.name, sizes: p.sizes.map((s) => ({ size: s.size, priceCents: s.priceCents })) }));
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

/** Crea el modelo editable de un producto nuevo antes de asignar precios. */
export function createProductEditor(nameInput, selectedSizes, existingEditor = []) {
  const name = typeof nameInput === 'string' ? nameInput.trim() : '';
  if (!name) return { ok: false, reason: 'Escribe el nombre del producto' };
  if (name.length > 80) return { ok: false, reason: 'El nombre del producto es demasiado largo' };
  if (existingEditor.some((p) => p.name.trim().toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
    return { ok: false, reason: `Ya existe un producto llamado ${name}` };
  }
  if (!Array.isArray(selectedSizes) || selectedSizes.length === 0) {
    return { ok: false, reason: 'Selecciona al menos una talla' };
  }
  const seen = new Set();
  const sizes = [];
  for (const raw of selectedSizes) {
    const size = normalizeSizeInput(raw);
    if (size === null) return { ok: false, reason: `Talla inválida: ${raw}` };
    const key = sizeKey(size);
    if (seen.has(key)) continue;
    seen.add(key);
    sizes.push({ size, priceCents: 0, priceInput: '' });
  }
  if (sizes.length === 0) return { ok: false, reason: 'Selecciona al menos una talla' };
  return { ok: true, product: { name, sizes } };
}

const STANDARD_SIZE_ORDER = new Map([...STANDARD_SIZE_LABELS.values()].map((size, index) => [size, index]));

export function compareSizes(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  const ai = STANDARD_SIZE_ORDER.get(a);
  const bi = STANDARD_SIZE_ORDER.get(b);
  if (ai !== undefined || bi !== undefined) {
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  }
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true });
}

/** Elimina un producto del modelo editable, validando que el catálogo conserve al menos 1 producto. */
export function deleteProductFromEditor(editor, productName) {
  if (!Array.isArray(editor)) return { ok: false, reason: 'Editor inválido' };
  const target = typeof productName === 'string' ? productName.trim().toLocaleLowerCase('es') : '';
  const idx = editor.findIndex((p) => p.name.trim().toLocaleLowerCase('es') === target);
  if (idx < 0) return { ok: false, reason: 'Producto no encontrado' };
  if (editor.length <= 1) {
    return { ok: false, reason: 'El catálogo debe tener al menos un producto' };
  }
  const next = editor.filter((_, i) => i !== idx);
  return { ok: true, editor: next };
}

/** Renombra un producto en el modelo editable validando unicidad y formato. */
export function renameProductInEditor(editor, oldName, newNameInput) {
  if (!Array.isArray(editor)) return { ok: false, reason: 'Editor inválido' };
  const oldTarget = typeof oldName === 'string' ? oldName.trim().toLocaleLowerCase('es') : '';
  const newName = typeof newNameInput === 'string' ? newNameInput.trim() : '';
  if (!newName) return { ok: false, reason: 'Escribe el nuevo nombre del producto' };
  if (newName.length > 80) return { ok: false, reason: 'El nombre del producto es demasiado largo' };
  const idx = editor.findIndex((p) => p.name.trim().toLocaleLowerCase('es') === oldTarget);
  if (idx < 0) return { ok: false, reason: 'Producto no encontrado' };
  const newTarget = newName.toLocaleLowerCase('es');
  if (newTarget !== oldTarget && editor.some((p) => p.name.trim().toLocaleLowerCase('es') === newTarget)) {
    return { ok: false, reason: `Ya existe un producto llamado ${newName}` };
  }
  const next = editor.map((p, i) => (i === idx ? { ...p, name: newName } : p));
  return { ok: true, editor: next };
}

/** Elimina una talla de un producto asegurando que conserve al menos una talla. */
export function deleteSizeFromProduct(editor, productName, sizeToDelete) {
  if (!Array.isArray(editor)) return { ok: false, reason: 'Editor inválido' };
  const target = typeof productName === 'string' ? productName.trim().toLocaleLowerCase('es') : '';
  const prod = editor.find((p) => p.name.trim().toLocaleLowerCase('es') === target);
  if (!prod) return { ok: false, reason: 'Producto no encontrado' };
  if (prod.sizes.length <= 1) {
    return { ok: false, reason: 'El producto debe tener al menos una talla. Si deseas quitar el producto completo, usa "Borrar producto".' };
  }
  const normalized = normalizeSizeInput(sizeToDelete);
  if (normalized === null) return { ok: false, reason: 'Talla inválida' };
  const key = sizeKey(normalized);
  const sizeExists = prod.sizes.some((s) => sizeKey(s.size) === key);
  if (!sizeExists) return { ok: false, reason: 'Talla no encontrada en este producto' };
  const next = editor.map((p) => {
    if (p.name.trim().toLocaleLowerCase('es') !== target) return p;
    return { ...p, sizes: p.sizes.filter((s) => sizeKey(s.size) !== key) };
  });
  return { ok: true, editor: next };
}

/** Agrega una nueva talla a un producto existente en el modelo editable. */
export function addSizeToProduct(editor, productName, rawSize, defaultPriceInput = '') {
  if (!Array.isArray(editor)) return { ok: false, reason: 'Editor inválido' };
  const target = typeof productName === 'string' ? productName.trim().toLocaleLowerCase('es') : '';
  const prod = editor.find((p) => p.name.trim().toLocaleLowerCase('es') === target);
  if (!prod) return { ok: false, reason: 'Producto no encontrado' };
  const size = normalizeSizeInput(rawSize);
  if (size === null) return { ok: false, reason: 'Escribe una talla válida (por ejemplo: 16, M, 22 o 4XL)' };
  const key = sizeKey(size);
  if (prod.sizes.some((s) => sizeKey(s.size) === key)) {
    return { ok: false, reason: `La talla ${size} ya existe en ${prod.name}` };
  }
  const priceNum = Number(defaultPriceInput);
  const priceCents = Number.isFinite(priceNum) && priceNum >= 0 ? Math.round(priceNum * 100) : 0;
  const newSize = {
    size,
    priceCents,
    priceInput: defaultPriceInput ? String(defaultPriceInput) : '',
  };
  const updatedSizes = [...prod.sizes, newSize].sort((a, b) => compareSizes(a.size, b.size));
  const next = editor.map((p) => (p.name.trim().toLocaleLowerCase('es') === target ? { ...p, sizes: updatedSizes } : p));
  return { ok: true, editor: next };
}

// catalog.js — dominio del catálogo: seed desde productos.json, validación
// estricta (también usada para el reemplazo completo por parte de admin).
import { readFileSync } from 'node:fs';
import { toCents } from './money.js';

const MAX_NAME_LEN = 80;
const MAX_SIZE_LEN = 20;
const MAX_PRICE_CENTS = 1_000_000; // $10,000.00
const STANDARD_SIZE_LABELS = new Map([
  ['xs', 'XS'],
  ['s', 'S'],
  ['m', 'M'],
  ['l', 'L'],
  ['xl', 'XL'],
  ['2xl', '2XL'],
  ['3xl', '3XL'],
  ['otro', 'Otro'],
]);
const STANDARD_SIZE_ORDER = new Map([...STANDARD_SIZE_LABELS.values()].map((size, index) => [size, index]));

/** Normaliza tallas numéricas o de letras a un valor estable. */
export function normalizeSize(size) {
  if (typeof size === 'number') {
    return Number.isInteger(size) && size >= 1 ? size : null;
  }
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

function compareSizes(a, b) {
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
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
}

/**
 * Convierte el formato de productos.json { "Categoría": [{talla, precio}] }
 * a catálogo interno: [{ name, sizes: [{size, priceCents}] }].
 * NO valida; usa validateCatalog para eso.
 */
export function normalizeCatalog(raw) {
  const catalog = [];
  for (const [name, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;
    const sizes = entries.map((e) => ({ size: e.talla, priceCents: toCents(e.precio) }));
    catalog.push({ name, sizes });
  }
  return catalog;
}

/** Carga el seed desde un archivo JSON (formato productos.json). */
export function loadSeed(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  return validateCatalog(normalizeCatalog(raw));
}

/**
 * Valida un catálogo completo y devuelve una copia normalizada
 * (nombres recortados, tallas ordenadas). Lanza Error con el primer problema.
 */
export function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('El catálogo debe tener al menos un producto');
  }
  const seenNames = new Set();
  const out = [];
  for (const entry of catalog) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) throw new Error('Producto sin nombre');
    if (name.length > MAX_NAME_LEN) throw new Error(`Nombre demasiado largo: ${name}`);
    const key = name.toLowerCase();
    if (seenNames.has(key)) throw new Error(`Producto duplicado: ${name}`);
    seenNames.add(key);

    if (!Array.isArray(entry.sizes) || entry.sizes.length === 0) {
      throw new Error(`Producto ${name} sin tallas`);
    }
    const seenSizes = new Set();
    const sizes = [];
    for (const s of entry.sizes) {
      const size = normalizeSize(s.size);
      if (size === null) {
        throw new Error(`Talla inválida en ${name}: ${s.size}`);
      }
      const key = sizeKey(size);
      if (seenSizes.has(key)) throw new Error(`Talla duplicada en ${name}: ${size}`);
      seenSizes.add(key);
      if (!Number.isInteger(s.priceCents) || s.priceCents < 0 || s.priceCents > MAX_PRICE_CENTS) {
        throw new Error(`Precio inválido en ${name} talla ${size}: ${s.priceCents}`);
      }
      sizes.push({ size, priceCents: s.priceCents });
    }
    sizes.sort((a, b) => compareSizes(a.size, b.size));
    out.push({ name, sizes });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return out;
}

/** Busca un producto por nombre exacto. */
export function findProduct(catalog, name) {
  return catalog.find((p) => p.name === name) ?? null;
}

/** Precio en centavos de una talla, o null si no existe. */
export function findSize(product, size) {
  const clean = normalizeSize(size);
  if (clean === null) return null;
  const key = sizeKey(clean);
  const s = product.sizes.find((x) => sizeKey(x.size) === key);
  return s ? s.priceCents : null;
}

/** Vista pública: solo nombre y tallas/precios (sin campos internos). */
export function toPublicCatalog(catalog) {
  return catalog.map((p) => ({ name: p.name, sizes: p.sizes.map((s) => ({ ...s })) }));
}

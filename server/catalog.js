// catalog.js — dominio del catálogo: seed desde productos.json, validación
// estricta (también usada para el reemplazo completo por parte de admin).
import { readFileSync } from 'node:fs';
import { toCents } from './money.js';

const MAX_NAME_LEN = 80;
const MAX_PRICE_CENTS = 1_000_000; // $10,000.00

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
      if (typeof s.size !== 'number' || !Number.isInteger(s.size) || s.size < 1) {
        throw new Error(`Talla inválida en ${name}: ${s.size}`);
      }
      if (seenSizes.has(s.size)) throw new Error(`Talla duplicada en ${name}: ${s.size}`);
      seenSizes.add(s.size);
      if (!Number.isInteger(s.priceCents) || s.priceCents < 0 || s.priceCents > MAX_PRICE_CENTS) {
        throw new Error(`Precio inválido en ${name} talla ${s.size}: ${s.priceCents}`);
      }
      sizes.push({ size: s.size, priceCents: s.priceCents });
    }
    sizes.sort((a, b) => a.size - b.size);
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
  const s = product.sizes.find((x) => x.size === size);
  return s ? s.priceCents : null;
}

/** Vista pública: solo nombre y tallas/precios (sin campos internos). */
export function toPublicCatalog(catalog) {
  return catalog.map((p) => ({ name: p.name, sizes: p.sizes.map((s) => ({ ...s })) }));
}

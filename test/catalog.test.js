import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  loadSeed,
  normalizeCatalog,
  validateCatalog,
  findProduct,
  findSize,
  toPublicCatalog,
} from '../server/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');

test('loadSeed carga productos.json real incluyendo Short', () => {
  const catalog = loadSeed(SEED);
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 5, 'debe tener al menos 5 productos');
  const names = catalog.map((p) => p.name);
  for (const expected of ['Camisas', 'Falda Beige', 'Faldas', 'Pantalones', 'Short']) {
    assert.ok(names.includes(expected), `falta ${expected}`);
  }
  const short = findProduct(catalog, 'Short');
  assert.equal(short.sizes.length, 5);
  assert.equal(findSize(short, 10), 650);
  assert.equal(findSize(short, 4), 600);
});

test('loadSeed convierte precios a centavos enteros', () => {
  const catalog = loadSeed(SEED);
  const camisas = findProduct(catalog, 'Camisas');
  assert.equal(findSize(camisas, 3), 500);
  assert.equal(findSize(camisas, 15), 650);
  const beige = findProduct(catalog, 'Falda Beige');
  assert.equal(findSize(beige, 10), 775);
  assert.equal(findSize(beige, 14), 875);
});

test('findSize devuelve null si la talla no existe', () => {
  const catalog = loadSeed(SEED);
  const short = findProduct(catalog, 'Short');
  assert.equal(findSize(short, 99), null);
  assert.equal(findProduct(catalog, 'Inexistente'), null);
});

test('validateCatalog rechaza producto sin nombre', () => {
  assert.throws(() =>
    validateCatalog([{ name: '   ', sizes: [{ size: 4, priceCents: 500 }] }])
  );
  assert.throws(() => validateCatalog([{ name: '', sizes: [] }]));
});

test('validateCatalog rechaza nombres duplicados (case-insensitive)', () => {
  assert.throws(() =>
    validateCatalog([
      { name: 'Camisa', sizes: [{ size: 4, priceCents: 500 }] },
      { name: 'camisa', sizes: [{ size: 6, priceCents: 500 }] },
    ])
  );
});

test('validateCatalog rechaza producto sin tallas o tallas duplicadas', () => {
  assert.throws(() => validateCatalog([{ name: 'X', sizes: [] }]));
  assert.throws(() =>
    validateCatalog([
      { name: 'X', sizes: [{ size: 4, priceCents: 500 }, { size: 4, priceCents: 600 }] },
    ])
  );
});

test('validateCatalog rechaza tallas o precios inválidos', () => {
  assert.throws(() =>
    validateCatalog([{ name: 'X', sizes: [{ size: 0, priceCents: 500 }] }])
  );
  assert.throws(() =>
    validateCatalog([{ name: 'X', sizes: [{ size: 4, priceCents: -5 }] }])
  );
  assert.throws(() =>
    validateCatalog([{ name: 'X', sizes: [{ size: 4, priceCents: 5.5 }] }])
  );
  assert.throws(() =>
    validateCatalog([{ name: 'X', sizes: [{ size: '', priceCents: 500 }] }])
  );
  assert.throws(() =>
    validateCatalog([{ name: 'X', sizes: [{ size: 4, priceCents: 1_000_001 }] }])
  );
});

test('validateCatalog acepta y normaliza tallas en letras', () => {
  const out = validateCatalog([
    {
      name: ' Chalecos ',
      sizes: [
        { size: ' 2xl ', priceCents: 1200 },
        { size: 'xs', priceCents: 900 },
        { size: ' Otro ', priceCents: 1500 },
        { size: 10, priceCents: 1000 },
      ],
    },
  ]);
  assert.deepEqual(out[0], {
    name: 'Chalecos',
    sizes: [
      { size: 10, priceCents: 1000 },
      { size: 'XS', priceCents: 900 },
      { size: '2XL', priceCents: 1200 },
      { size: 'Otro', priceCents: 1500 },
    ],
  });
});

test('validateCatalog rechaza tallas en letras duplicadas sin distinguir mayúsculas', () => {
  assert.throws(
    () => validateCatalog([
      { name: 'Corbatas', sizes: [{ size: 'XL', priceCents: 500 }, { size: ' xl ', priceCents: 600 }] },
    ]),
    /duplicada/i
  );
});

test('validateCatalog normaliza y ordena entradas válidas', () => {
  const out = validateCatalog([
    { name: ' Zapatos ', sizes: [{ size: 4, priceCents: 700 }, { size: 6, priceCents: 800 }] },
    { name: 'Abrigo', sizes: [{ size: 10, priceCents: 1200 }] },
  ]);
  assert.deepEqual(out.map((p) => p.name), ['Abrigo', 'Zapatos']);
  assert.deepEqual(out[1].sizes.map((s) => s.size), [4, 6]);
});

test('normalizeCatalog convierte el formato {categoria: [{talla, precio}]}', () => {
  const raw = { 'Polos': [{ talla: 4, precio: 5.5 }], 'Shorts': [{ talla: 6, precio: 6.25 }] };
  const catalog = normalizeCatalog(raw);
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].name, 'Polos');
  assert.deepEqual(catalog[0].sizes, [{ size: 4, priceCents: 550 }]);
  assert.deepEqual(catalog[1].sizes, [{ size: 6, priceCents: 625 }]);
});

test('toPublicCatalog expone solo datos seguros', () => {
  const catalog = loadSeed(SEED);
  const pub = toPublicCatalog(catalog);
  assert.equal(pub.length, catalog.length);
  for (const p of pub) {
    assert.ok(typeof p.name === 'string');
    assert.ok(Array.isArray(p.sizes));
    for (const s of p.sizes) {
      assert.ok(Number.isInteger(s.size));
      assert.ok(Number.isInteger(s.priceCents));
    }
  }
});

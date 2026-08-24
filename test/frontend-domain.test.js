// Pruebas del dominio puro del frontend (public/domain.js, cargable desde Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../public/domain.js';

test('cálculos de línea y totales', () => {
  assert.equal(D.computeLineTotal(650, 2), 1300);
  assert.equal(D.computeSubtotal([
    { unitPriceCents: 650, quantity: 2 },
    { unitPriceCents: 500, quantity: 1 },
  ]), 1800);
  assert.equal(D.computeTotal(1800, 300), 1500);
});

test('validateDiscount: descuento válido entre 0 y subtotal', () => {
  assert.deepEqual(D.validateDiscount(0, 1000), { ok: true });
  assert.deepEqual(D.validateDiscount(1000, 1000), { ok: true });
  const bad = D.validateDiscount(1001, 1000);
  assert.equal(bad.ok, false);
  assert.equal(D.validateDiscount(-1, 1000).ok, false);
  assert.equal(D.validateDiscount(1.5, 1000).ok, false);
  assert.equal(D.validateDiscount('50', 1000).ok, false);
});

test('validateLine: reglas de cantidad, precio y producto', () => {
  assert.deepEqual(
    D.validateLine({ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }),
    { ok: true }
  );
  assert.equal(D.validateLine({ product: '', size: 10, quantity: 1, unitPriceCents: 650 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: 0, unitPriceCents: 650 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: -1, unitPriceCents: 650 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: 1.5, unitPriceCents: 650 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: 100, unitPriceCents: 650 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: 1, unitPriceCents: -1 }).ok, false);
  assert.equal(D.validateLine({ product: 'Short', size: 10, quantity: 1, unitPriceCents: '650' }).ok, false);
  assert.deepEqual(
    D.validateLine({ product: 'Chaleco', size: 'XL', quantity: 1, unitPriceCents: 1200 }),
    { ok: true }
  );
  assert.equal(D.validateLine({ product: 'Chaleco', size: '', quantity: 1, unitPriceCents: 1200 }).ok, false);
});

test('buildSalePayload construye el payload con snapshot de precios', () => {
  const r = D.buildSalePayload({
    cart: [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
    clientName: '  María  ',
    discountCents: 100,
    deviceId: 'dev-1',
    id: '123e4567-e89b-12d3-a456-426614174000',
    clientTs: '2026-08-24T12:00:00.000Z',
  });
  assert.equal(r.ok, true);
  assert.equal(r.payload.id, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(r.payload.deviceId, 'dev-1');
  assert.equal(r.payload.clientName, 'María', 'recorta espacios');
  assert.equal(r.payload.discountCents, 100);
  assert.equal(r.payload.clientTs, '2026-08-24T12:00:00.000Z');
  assert.deepEqual(r.payload.lines, [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }]);
});

test('groupLinesByProduct agrupa categorías sin depender del orden de selección', () => {
  const lines = [
    { product: 'Pantalones', size: 10, quantity: 1, unitPriceCents: 800 },
    { product: 'Camisas', size: 'M', quantity: 1, unitPriceCents: 600 },
    { product: 'Pantalones', size: 12, quantity: 2, unitPriceCents: 850 },
    { product: 'Camisas', size: 'L', quantity: 1, unitPriceCents: 650 },
  ];

  assert.deepEqual(D.groupLinesByProduct(lines), [lines[0], lines[2], lines[1], lines[3]]);
  assert.deepEqual(lines.map((line) => line.size), [10, 'M', 12, 'L'], 'no muta el carrito original');
});

test('buildSalePayload guarda las líneas agrupadas por categoría', () => {
  const r = D.buildSalePayload({
    cart: [
      { product: 'Pantalones', size: 10, quantity: 1, unitPriceCents: 800 },
      { product: 'Camisas', size: 'M', quantity: 1, unitPriceCents: 600 },
      { product: 'Pantalones', size: 12, quantity: 1, unitPriceCents: 850 },
    ],
    clientName: '',
    discountCents: 0,
    deviceId: 'dev-1',
    id: '123e4567-e89b-12d3-a456-426614174009',
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.payload.lines.map((line) => `${line.product}:${line.size}`), [
    'Pantalones:10',
    'Pantalones:12',
    'Camisas:M',
  ]);
});

test('buildSalePayload: cliente vacío se envía como null y errores son explícitos', () => {
  const r = D.buildSalePayload({
    cart: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 650 }],
    clientName: '   ',
    discountCents: 0,
    deviceId: 'dev-1',
    id: '123e4567-e89b-12d3-a456-426614174000',
  });
  assert.equal(r.ok, true);
  assert.equal(r.payload.clientName, null);

  const noCart = D.buildSalePayload({ cart: [], clientName: '', discountCents: 0, deviceId: 'dev-1', id: 'x' });
  assert.equal(noCart.ok, false);
  assert.ok(noCart.reason);

  const badDiscount = D.buildSalePayload({
    cart: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 650 }],
    clientName: '',
    discountCents: 99999,
    deviceId: 'dev-1',
    id: '123e4567-e89b-12d3-a456-426614174000',
  });
  assert.equal(badDiscount.ok, false);
  assert.match(badDiscount.reason, /descuento/i);
});

test('parseDiscountInput: entrada de dólares a centavos o null', () => {
  assert.equal(D.parseDiscountInput('5.5'), 550);
  assert.equal(D.parseDiscountInput('0'), 0);
  assert.equal(D.parseDiscountInput(''), null);
  assert.equal(D.parseDiscountInput('abc'), null);
  assert.equal(D.parseDiscountInput('-3'), null);
  assert.equal(D.parseDiscountInput('5.555'), 556);
  assert.equal(D.parseDiscountInput('1,50'), null, 'solo punto decimal');
});

test('formatUSD del frontend coincide con el del servidor', () => {
  assert.equal(D.formatUSD(775), '$7.75');
  assert.equal(D.formatUSD(0), '$0.00');
});

test('catalogToEditor: formato interno → formato productos.json (talla/precio)', () => {
  const out = D.catalogToEditor([
    { name: 'Short', sizes: [{ size: 10, priceCents: 650 }, { size: 12, priceCents: 700 }] },
  ]);
  assert.deepEqual(out, { Short: [{ talla: 10, precio: 6.5 }, { talla: 12, precio: 7 }] });
});

test('editorToCatalog: formato productos.json → formato interno con centavos', () => {
  const out = D.editorToCatalog({ Short: [{ talla: 10, precio: 6.5 }] });
  assert.deepEqual(out, [{ name: 'Short', sizes: [{ size: 10, priceCents: 650 }] }]);
});

test('editorToCatalog rechaza formato inválido', () => {
  assert.throws(() => D.editorToCatalog('no-es-objeto'));
  assert.throws(() => D.editorToCatalog({ Short: 'nada' }));
});

// ---- Editor de precios estructurado (UI admin) ----

test('priceEditorFromCatalog prepara modelo editable con precios en texto', () => {
  const out = D.priceEditorFromCatalog([
    { name: 'Short', sizes: [{ size: 10, priceCents: 650 }, { size: 12, priceCents: 700 }] },
  ]);
  assert.deepEqual(out, [
    { name: 'Short', sizes: [{ size: 10, priceCents: 650, priceInput: '6.50' }, { size: 12, priceCents: 700, priceInput: '7.00' }] },
  ]);
});

test('priceEditorToCatalog convierte ediciones válidas a centavos', () => {
  const editor = [
    { name: 'Short', sizes: [{ size: 10, priceCents: 650, priceInput: '6.50' }, { size: 12, priceCents: 700, priceInput: '7.25' }] },
    { name: 'Camisas', sizes: [{ size: 3, priceCents: 500, priceInput: '5' }] },
  ];
  const r = D.priceEditorToCatalog(editor);
  assert.equal(r.ok, true);
  assert.deepEqual(r.catalog, [
    { name: 'Short', sizes: [{ size: 10, priceCents: 650 }, { size: 12, priceCents: 725 }] },
    { name: 'Camisas', sizes: [{ size: 3, priceCents: 500 }] },
  ]);
});

test('priceEditorToCatalog rechaza precios inválidos con contexto producto/talla', () => {
  const bad = D.priceEditorToCatalog([
    { name: 'Short', sizes: [{ size: 10, priceCents: 650, priceInput: 'abc' }] },
  ]);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Short/);
  assert.match(bad.reason, /talla 10/);

  const neg = D.priceEditorToCatalog([
    { name: 'Short', sizes: [{ size: 10, priceCents: 650, priceInput: '-2' }] },
  ]);
  assert.equal(neg.ok, false);

  const vacio = D.priceEditorToCatalog([
    { name: 'Short', sizes: [{ size: 10, priceCents: 650, priceInput: '' }] },
  ]);
  assert.equal(vacio.ok, false);
});

test('priceEditorToCatalog redondea a centavos y acepta decimales', () => {
  const r = D.priceEditorToCatalog([
    { name: 'X', sizes: [{ size: 4, priceCents: 0, priceInput: '7.755' }] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.catalog[0].sizes[0].priceCents, 776);
});

test('createProductEditor crea productos con tallas numéricas y de letras', () => {
  const existing = [{ name: 'Camisas', sizes: [{ size: 10, priceInput: '5.00' }] }];
  const r = D.createProductEditor('  Chalecos  ', [1, 20, 'XS', '2XL', 'Otro'], existing);
  assert.equal(r.ok, true);
  assert.deepEqual(r.product, {
    name: 'Chalecos',
    sizes: [
      { size: 1, priceCents: 0, priceInput: '' },
      { size: 20, priceCents: 0, priceInput: '' },
      { size: 'XS', priceCents: 0, priceInput: '' },
      { size: '2XL', priceCents: 0, priceInput: '' },
      { size: 'Otro', priceCents: 0, priceInput: '' },
    ],
  });
});

test('createProductEditor exige nombre único y al menos una talla', () => {
  const existing = [{ name: 'Camisas', sizes: [] }];
  assert.equal(D.createProductEditor('', [1], existing).ok, false);
  assert.equal(D.createProductEditor('camisas', [1], existing).ok, false);
  assert.equal(D.createProductEditor('Corbatines', [], existing).ok, false);
});

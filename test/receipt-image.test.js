import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundedReceiptDpr,
  buildReceiptLayout,
  createReceiptPngFile,
  drawReceiptCanvas,
  receiptImageFilename,
  wrapReceiptText,
} from '../public/receipt-image.js';

const receipt = (over = {}) => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  folio: 42,
  savedAt: '29/8/2026, 10:00:00',
  clientName: 'María José Hernández de la Cruz',
  lines: [
    { product: 'Camisa escolar manga larga edición especial', size: 'A medida', quantity: 99, unitPriceCents: 625 },
    { product: 'Chaleco Ñandutí', size: '2XL', quantity: 1, unitPriceCents: 1225 },
  ],
  subtotalCents: 63100,
  discountCents: 100,
  totalCents: 63000,
  ...over,
});

const commandText = (layout) => layout.commands.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

test('layout conserva contenido, Unicode, cantidad 99, importes y cierre', () => {
  const layout = buildReceiptLayout(receipt(), { width: 480, measureText: (text, size) => Array.from(text).length * size * .6 });
  const text = commandText(layout);
  assert.match(text, /Creaciones Melvin/);
  assert.match(text, /Folio: 42/);
  assert.match(text, /Cliente: María José/);
  assert.match(text, /Producto · Cantidad # Talla/);
  assert.match(text, /99 # A medida/);
  assert.match(text, /Ñandutí/);
  assert.match(text, /Unitario\s+\$6\.25/);
  assert.match(text, /Importe \$618\.75/);
  assert.match(text, /Descuento/);
  assert.match(text, /TOTAL/);
  assert.match(text, /Gracias por su\s+compra/);
  assert.ok(layout.height > 480, 'el alto crece con contenido envuelto');
  const flattened = layout.commands.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  assert.ok(
    flattened.includes('Camisa escolar manga larga edición especial · 99 # A medida'),
    'el nombre largo se conserva completo y aparece antes de cantidad/talla'
  );
});

test('layout pendiente omite cliente/descuento y respeta tamaños acotados', () => {
  const layout = buildReceiptLayout(receipt({ folio: null, clientName: null, discountCents: 0 }), {
    width: 5000,
    maxWidth: 900,
    maxHeight: 900,
  });
  const text = commandText(layout);
  assert.equal(layout.width, 900);
  assert.ok(layout.height <= 900);
  assert.match(text, /Pendiente de sincronizar/);
  assert.doesNotMatch(text, /Cliente:/);
  assert.doesNotMatch(text, /Descuento/);
});

test('wrapReceiptText parte palabras largas sin perder caracteres', () => {
  const original = 'ProductoSuperLargoSinEspacios áéíóú';
  const lines = wrapReceiptText(original, 60, (text) => Array.from(text).length * 10, 20);
  assert.ok(lines.length > 2);
  assert.equal(lines.join('').replaceAll(' ', ''), original.replaceAll(' ', ''), 'solo descarta espacios usados como cortes');
});

test('recorta comandos de texto y líneas por su coordenada vertical real', () => {
  const layout = buildReceiptLayout(receipt({
    lines: Array.from({ length: 20 }, (_, index) => ({
      product: `Producto largo ${index}`,
      size: 'Especial',
      quantity: 2,
      unitPriceCents: 500,
    })),
  }), { width: 360, minHeight: 300, maxHeight: 420, margin: 30 });
  assert.equal(layout.clipped, true);
  for (const command of layout.commands) {
    const bottom = command.type === 'line' ? Math.max(command.y1, command.y2) : command.y + command.size;
    assert.ok(bottom <= layout.height - 30, `comando fuera del límite: ${JSON.stringify(command)}`);
  }
});

test('DPR se limita por escala y presupuesto total de píxeles', () => {
  assert.equal(boundedReceiptDpr(400, 800, 4), 2);
  const dpr = boundedReceiptDpr(1200, 10000, 2);
  assert.ok(dpr >= 1 && dpr < 2);
  assert.ok(1200 * 10000 * dpr * dpr <= 16_000_001);
});

test('drawReceiptCanvas usa primitivas inyectadas y blanco/negro', () => {
  const calls = [];
  const context = {
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: () => calls.push(['stroke']),
  };
  const created = [];
  const result = drawReceiptCanvas(receipt(), {
    width: 720,
    devicePixelRatio: 3,
    createCanvas: (width, height) => {
      created.push({ width, height });
      return { getContext: () => context };
    },
  });
  assert.equal(result.dpr, 2);
  assert.equal(created[0].width, result.layout.width * 2);
  assert.equal(context.fillStyle, '#000000');
  assert.equal(context.strokeStyle, '#000000');
  assert.ok(calls.some(([name]) => name === 'fillRect'));
  assert.ok(calls.some(([name, text]) => name === 'fillText' && text.includes('Creaciones Melvin')));
});

test('genera File PNG y nombre estable con operaciones inyectadas', async () => {
  class FakeFile {
    constructor(parts, name, options) { Object.assign(this, { parts, name, type: options.type }); }
  }
  const result = await createReceiptPngFile(receipt(), {
    createCanvas: () => ({
      getContext: () => ({
        setTransform() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      }),
    }),
    canvasToBlob: async () => ({ png: true }),
    FileImpl: FakeFile,
  });
  assert.equal(result.file.name, 'ticket-creaciones-melvin-folio-42.png');
  assert.equal(result.file.type, 'image/png');
  assert.equal(receiptImageFilename(receipt({ folio: null })), 'ticket-creaciones-melvin-pendiente-123e4567-e89.png');
});

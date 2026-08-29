// Pruebas del módulo de impresión ESC/POS (public/printer.js, partes puras).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Importar solo las funciones puras (no las que tocan navigator.bluetooth)
import {
  encodeText,
  centerLine,
  centsToText,
  formatItemLine,
  buildTicketBytes,
  isWebBluetoothAvailable,
} from '../public/printer.js';

test('encodeText: string a bytes UTF-8', () => {
  assert.deepEqual(encodeText('ABC'), [0x41, 0x42, 0x43]);
  assert.deepEqual(encodeText(''), []);
  assert.deepEqual(encodeText(null), []);
  // ñ → UTF-8 0xc3 0xb1
  assert.deepEqual(encodeText('ñ'), [0xc3, 0xb1]);
});

test('centsToText: centavos a dólares sin símbolo', () => {
  assert.equal(centsToText(500), '5.00');
  assert.equal(centsToText(775), '7.75');
  assert.equal(centsToText(0), '0.00');
  assert.equal(centsToText(1205), '12.05');
});

test('centerLine: centra texto a 32 columnas', () => {
  const r = centerLine('Hola');
  assert.equal(r.length, 32, 'siempre 32 columnas');
  assert.ok(r.startsWith(' '.repeat(14)));
  assert.ok(r.endsWith(' '.repeat(14)));
  // Texto que excede 32 se trunca
  const long = centerLine('A'.repeat(40));
  assert.equal(long.length, 32);
  // Vacío → 32 espacios
  assert.equal(centerLine('').length, 32);
});

test('formatItemLine: formato "Producto (Talla) xCant    $Total"', () => {
  const line = {
    product: 'Camisas',
    size: 10,
    quantity: 2,
    unitPriceCents: 600,
    lineTotalCents: 1200,
  };
  const out = formatItemLine(line);
  assert.match(out, /Camisas/);
  assert.match(out, /T10/);
  assert.match(out, /x2/);
  assert.match(out, /\$12\.00/);
});

test('formatItemLine: línea larga separa descripción y precio', () => {
  const line = {
    product: 'Pantalones Largos',
    size: 40,
    quantity: 3,
    unitPriceCents: 1225,
    lineTotalCents: 3675,
  };
  const out = formatItemLine(line);
  // Como excede 32 columnas, el precio va en una segunda línea
  assert.ok(out.includes('\n'), 'debe separar en dos líneas');
  assert.match(out.split('\n')[1], /\$36\.75/);
});

test('formatItemLine: input inválido retorna vacío', () => {
  assert.equal(formatItemLine(null), '');
  assert.equal(formatItemLine({}), '');
  assert.equal(formatItemLine({ product: '' }), '');
});

test('buildTicketBytes: genera Uint8Array con estructura ESC/POS válida', () => {
  const receipt = {
    lines: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 650, lineTotalCents: 650 }],
    subtotalCents: 650,
    discountCents: 0,
    totalCents: 650,
    folio: 42,
    date: '2026-08-29 10:00',
  };
  const bytes = buildTicketBytes(receipt);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 20, 'ticket no vacío');

  // Debe contener ESC @ (inicialización) al inicio
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);

  // Debe contener 'Creaciones Melvin' como UTF-8
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /Creaciones Melvin/);
  assert.match(text, /Folio: 42/);
  assert.match(text, /Short/);
  assert.match(text, /\$6\.50/);
  assert.match(text, /TOTAL/);
  assert.match(text, /Gracias por su compra/);
});

test('buildTicketBytes: incluye descuento cuando es mayor a cero', () => {
  const receipt = {
    lines: [{ product: 'Camisas', size: 10, quantity: 1, unitPriceCents: 600, lineTotalCents: 600 }],
    subtotalCents: 600,
    discountCents: 100,
    totalCents: 500,
  };
  const text = new TextDecoder().decode(buildTicketBytes(receipt));
  assert.match(text, /Descuento/);
  assert.match(text, /\$5\.00.*TOTAL|\$1\.00/); // descuento 1.00 o total 5.00
});

test('buildTicketBytes: termina con comando de corte (GS V 0)', () => {
  const receipt = {
    lines: [{ product: 'X', size: 1, quantity: 1, unitPriceCents: 100, lineTotalCents: 100 }],
    subtotalCents: 100,
    discountCents: 0,
    totalCents: 100,
  };
  const bytes = buildTicketBytes(receipt);
  // GS V 0 = 0x1d 0x56 0x00
  const len = bytes.length;
  assert.equal(bytes[len - 3], 0x1d);
  assert.equal(bytes[len - 2], 0x56);
  assert.equal(bytes[len - 1], 0x00);
});

test('isWebBluetoothAvailable: devuelve false en Node (sin window/navigator.bluetooth)', () => {
  assert.equal(isWebBluetoothAvailable(), false);
});

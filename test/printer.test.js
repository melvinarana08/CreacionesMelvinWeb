// Pruebas del módulo de impresión ESC/POS (public/printer.js, partes puras).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Importar solo las funciones puras (no las que tocan navigator.bluetooth)
import {
  encodeText,
  centerLine,
  centsToText,
  formatTwoCols,
  formatItemLine,
  buildTicketBytes,
  buildEncargosTicketBytes,
  buildSingleEncargoTicketBytes,
  isWebBluetoothAvailable,
} from '../public/printer.js';

function printableTicketLines(bytes) {
  const printable = [];
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] === 0x1b) {
      i += bytes[i + 1] === 0x40 ? 2 : 3;
    } else if (bytes[i] === 0x1d) {
      i += 3;
    } else {
      printable.push(bytes[i]);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(printable)).split('\n');
}

function assertLongProductIsLosslessAndBounded(bytes, product) {
  const lines = printableTicketLines(bytes);
  assert.ok(lines.every((line) => line.length <= 32), 'cada línea térmica emitida debe caber en 32 columnas');
  const compactTicket = lines.join('').replace(/\s/g, '');
  assert.ok(compactTicket.includes(product.replace(/\s/g, '')), 'el nombre completo debe conservarse al envolverlo');
}

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

test('formatItemLine: muestra cantidad, precio unitario y total', () => {
  const line = {
    product: 'Camisas',
    size: 10,
    quantity: 2,
    unitPriceCents: 600,
    lineTotalCents: 1200,
  };
  const out = formatItemLine(line);
  assert.match(out, /Camisas/);
  assert.match(out, /2 # 10/);
  assert.doesNotMatch(out, /10.*# 2/);
  assert.match(out, /\$6\.00 c\/u/);
  assert.match(out, /\$12\.00/);
});

test('formatItemLine: muestra cantidad antes de una talla en letras', () => {
  const out = formatItemLine({
    product: 'Camisas',
    size: 'M',
    quantity: 1,
    unitPriceCents: 600,
    lineTotalCents: 600,
  });
  assert.match(out, /1 # M/);
  assert.doesNotMatch(out, /M.*# 1/);
});

test('formatItemLine: envuelve nombres mayores a 32 columnas sin perder contenido', () => {
  const product = 'Camisa escolar de presentación SuperextraordinariamenteLarga';
  assert.ok(product.length > 32, 'la regresión debe usar un nombre realmente largo');
  const out = formatItemLine({
    product,
    size: 40,
    quantity: 3,
    unitPriceCents: 1225,
    lineTotalCents: 3675,
  });
  const rows = out.split('\n');
  const metadataAt = rows.indexOf('3 # 40');
  assert.ok(metadataAt > 1, 'el nombre debe ocupar más de una línea');
  const productRows = rows.slice(0, metadataAt);
  assert.ok(productRows.every((row) => row.length <= 32), 'cada línea del nombre debe caber en 32 columnas');
  assert.equal(
    productRows.join('').replaceAll(' ', ''),
    product.replaceAll(' ', ''),
    'no debe truncar palabras ni tokens largos'
  );
  assert.match(rows[metadataAt + 1], /\$36\.75/);
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

test('buildTicketBytes: envuelve nombres de venta largos en 32 columnas sin perder contenido', () => {
  const product = `Camisa escolar ${'VentaExtraordinaria'.repeat(3)}`;
  const bytes = buildTicketBytes({
    lines: [{ product, size: 4, quantity: 5, unitPriceCents: 600, lineTotalCents: 3000 }],
    subtotalCents: 3000,
    discountCents: 0,
    totalCents: 3000,
  });
  assertLongProductIsLosslessAndBounded(bytes, product);
  assert.match(new TextDecoder().decode(bytes), /5 # 4/);
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

test('formatTwoCols: alinea textos a los extremos de una línea de 32 columnas', () => {
  const line = formatTwoCols('Subtotal', '$12.50');
  assert.equal(line.length, 32);
  assert.ok(line.startsWith('Subtotal'));
  assert.ok(line.endsWith('$12.50'));

  // Maneja nulos y números
  const num = formatTwoCols('Prendas:', 5);
  assert.equal(num.length, 32);
  assert.ok(num.endsWith('5'));
});

test('buildTicketBytes: incluye encabezado mejorado, columnas y prendas vendidas', () => {
  const receipt = {
    lines: [
      { product: 'Short', size: 10, quantity: 2, unitPriceCents: 650, lineTotalCents: 1300 },
      { product: 'Camisa', size: 'M', quantity: 1, unitPriceCents: 500, lineTotalCents: 500 },
    ],
    subtotalCents: 1800,
    discountCents: 200,
    totalCents: 1600,
    folio: 99,
    date: '2026-09-03 15:00',
  };
  const text = new TextDecoder().decode(buildTicketBytes(receipt));
  assert.match(text, /Creaciones Melvin/);
  assert.match(text, /COMPROBANTE DE VENTA/);
  assert.match(text, /DESCRIPCION.*TOTAL/);
  assert.match(text, /CANT\. # TALLA/);
  assert.match(text, /2 # 10/);
  assert.match(text, /1 # M/);
  assert.match(text, /Prendas vendidas:.*3/);
  assert.match(text, /Subtotal.*\$18\.00/);
  assert.match(text, /Descuento.*-\$2\.00/);
  assert.match(text, /TOTAL:.*\$16\.00/);
  assert.match(text, /¡Gracias por su compra!/);
});

test('buildEncargosTicketBytes: envuelve producto largo del resumen de taller', () => {
  const product = `Uniforme ${'ResumenExtraordinario'.repeat(3)}`;
  const bytes = buildEncargosTicketBytes({
    encargos: [],
    summary: { grandTotalQty: 2, products: [{ name: product, subtotalQty: 2, sizes: [{ size: 'XL', quantity: 2 }] }] },
  });
  assertLongProductIsLosslessAndBounded(bytes, product);
  assert.match(new TextDecoder().decode(bytes), /T XL.*x 2/);
});

test('buildEncargosTicketBytes: envuelve producto largo del detalle por cliente', () => {
  const product = `Pantalón ${'DetalleExtraordinario'.repeat(3)}`;
  const bytes = buildEncargosTicketBytes({
    encargos: [{ folio: 7, clientName: 'Ana', totalCents: 1600, items: [{ productName: product, size: 32, quantity: 2 }] }],
    summary: { grandTotalQty: 0, products: [] },
  });
  assertLongProductIsLosslessAndBounded(bytes, product);
  assert.match(new TextDecoder().decode(bytes), /T 32.*x2/);
});

test('buildEncargosTicketBytes: genera ticket de taller con casillas [ ] y desglose consolidado', () => {
  const summary = {
    grandTotalQty: 5,
    products: [
      {
        name: 'Pantalón',
        subtotalQty: 3,
        sizes: [
          { size: 32, quantity: 2 },
          { size: 34, quantity: 1 },
        ],
      },
      {
        name: 'Camisa',
        subtotalQty: 2,
        sizes: [
          { size: 10, quantity: 2 },
        ],
      },
    ],
  };

  const encargos = [
    {
      folio: 101,
      clientName: 'Doña Elena',
      notes: 'Para el viernes',
      totalCents: 2400,
      items: [
        { productName: 'Pantalón', size: 32, quantity: 2 },
        { productName: 'Camisa', size: 10, quantity: 1 },
      ],
    },
  ];

  const bytes = buildEncargosTicketBytes({ encargos, summary, date: '05/09/2026' });
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /Creaciones Melvin/);
  assert.match(text, /PEDIDOS DE TALLER \/ ALISTADO/);
  assert.match(text, /RESUMEN DE CONFECCION/);
  assert.match(text, /\[ \] Pantalón/);
  assert.match(text, /T 32.*x 2/);
  assert.doesNotMatch(text, /Talla 32/);
  assert.match(text, /TOTAL PRENDAS A ALISTAR:.*5/);
  assert.match(text, /DETALLE POR CLIENTE/);
  assert.match(text, /\[ \] Doña Elena \(E-101\)/);
  assert.match(text, /Nota: Para el viernes/);

  // Termina con corte GS V 0
  const len = bytes.length;
  assert.equal(bytes[len - 3], 0x1d);
  assert.equal(bytes[len - 2], 0x56);
  assert.equal(bytes[len - 1], 0x00);
});

test('buildSingleEncargoTicketBytes: envuelve producto largo individual sin perder contenido', () => {
  const product = `Chaqueta ${'IndividualExtraordinaria'.repeat(3)}`;
  const bytes = buildSingleEncargoTicketBytes({
    folio: 9,
    clientName: 'Luis',
    totalCents: 2000,
    items: [{ productName: product, size: 'A medida', quantity: 2, unitPriceCents: 1000 }],
  });
  assertLongProductIsLosslessAndBounded(bytes, product);
  assert.match(new TextDecoder().decode(bytes), /T A medida x2/);
});

test('buildSingleEncargoTicketBytes: genera ticket individual con casilla [ ] para empaque o cliente', () => {
  const encargo = {
    folio: 88,
    clientName: 'Don Mario',
    notes: 'Azul marino',
    totalCents: 1500,
    items: [
      { productName: 'Pantalón', size: 30, quantity: 1, unitPriceCents: 800 },
      { productName: 'Camisa', size: 'M', quantity: 1, unitPriceCents: 700 },
    ],
  };

  const bytes = buildSingleEncargoTicketBytes(encargo);
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /COMPROBANTE DE ENCARGO/);
  assert.match(text, /Folio encargo: E-88/);
  assert.match(text, /Cliente: Don Mario/);
  assert.match(text, /Nota: Azul marino/);
  assert.match(text, /Pantalón\nT 30 x1/);
  assert.doesNotMatch(text, /Pantalón \(T30\) x1/);
  assert.match(text, /TOTAL ESTIMADO:.*\$15\.00/);
  assert.match(text, /¡Gracias por su encargo!/);
});


import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatUSD, addCents, lineTotal } from '../server/money.js';

test('toCents convierte dólares a centavos enteros', () => {
  assert.equal(toCents(5), 500);
  assert.equal(toCents(5.5), 550);
  assert.equal(toCents(7.75), 775);
  assert.equal(toCents(0.1), 10);
  assert.equal(toCents(0), 0);
});

test('toCents redondea valores con más de 2 decimales', () => {
  assert.equal(toCents(6.5), 650);
  assert.equal(toCents(10.999), 1100);
  assert.equal(toCents(10.001), 1000);
});

test('toCents rechaza valores inválidos o negativos', () => {
  assert.throws(() => toCents(-1));
  assert.throws(() => toCents(NaN));
  assert.throws(() => toCents('5'));
  assert.throws(() => toCents(null));
  assert.throws(() => toCents(undefined));
  assert.throws(() => toCents(Infinity));
});

test('addCents suma centavos sin errores de punto flotante', () => {
  assert.equal(addCents(550, 775), 1325);
  assert.equal(addCents(0, 0), 0);
});

test('lineTotal multiplica precio unitario por cantidad', () => {
  assert.equal(lineTotal(775, 2), 1550);
  assert.equal(lineTotal(500, 1), 500);
  assert.equal(lineTotal(650, 0), 0);
});

test('formatUSD formatea centavos como dólares', () => {
  assert.equal(formatUSD(500), '$5.00');
  assert.equal(formatUSD(775), '$7.75');
  assert.equal(formatUSD(0), '$0.00');
  assert.equal(formatUSD(1325), '$13.25');
});

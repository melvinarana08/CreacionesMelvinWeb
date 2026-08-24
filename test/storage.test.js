import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
const S = await import('../public/storage.js');

beforeEach(() => localStorage.clear());

test('createUuid usa randomUUID cuando el contexto seguro lo ofrece', () => {
  const expected = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(S.createUuid({ randomUUID: () => expected }), expected);
});

test('createUuid genera un UUID v4 válido cuando randomUUID no existe', () => {
  const id = S.createUuid({}, () => 0.5);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('saveCatalog y loadCatalog conservan el último catálogo válido', () => {
  const catalog = [{ name: 'Short', sizes: [{ size: 10, priceCents: 650 }] }];
  S.saveCatalog(catalog);
  assert.deepEqual(S.loadCatalog(), catalog);
});

test('loadCatalog devuelve null si no hay caché o está dañada', () => {
  assert.equal(S.loadCatalog(), null);
  localStorage.setItem('cm_catalog', '{mal json');
  assert.equal(S.loadCatalog(), null);
  localStorage.setItem('cm_catalog', JSON.stringify({ no: 'array' }));
  assert.equal(S.loadCatalog(), null);
});

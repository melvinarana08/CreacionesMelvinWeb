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

test('tema persiste valores válidos y refleja la compatibilidad e-ink', () => {
  for (const theme of ['light', 'dark', 'eink']) {
    assert.equal(S.saveTheme(theme), true);
    assert.equal(S.loadTheme(), theme);
    assert.equal(localStorage.getItem('cm_theme'), theme);
    assert.equal(localStorage.getItem('cm_eink_mode'), theme === 'eink' ? 'true' : 'false');
  }
  assert.equal(S.saveTheme('sepia'), false);
  assert.equal(S.loadTheme(), 'eink', 'un valor rechazado no modifica el tema anterior');
});

test('tema prioriza la clave nueva válida sobre el legado', () => {
  localStorage.setItem('cm_theme', 'dark');
  localStorage.setItem('cm_eink_mode', 'true');
  assert.equal(S.loadTheme(), 'dark');
  assert.equal(localStorage.getItem('cm_theme'), 'dark');
});

test('tema malformado devuelve claro sin migrar el legado verdadero', () => {
  localStorage.setItem('cm_theme', 'malformed');
  localStorage.setItem('cm_eink_mode', 'true');
  assert.equal(S.loadTheme(), 'light');
  assert.equal(localStorage.getItem('cm_theme'), 'malformed');
  assert.equal(localStorage.getItem('cm_eink_mode'), 'true');
});

test('tema ausente migra el legado verdadero a e-ink', () => {
  localStorage.setItem('cm_eink_mode', 'true');
  assert.equal(S.loadTheme(), 'eink');
  assert.equal(localStorage.getItem('cm_theme'), 'eink');
  assert.equal(localStorage.getItem('cm_eink_mode'), 'true');
});

test('tema vuelve a claro y no lanza cuando cualquier acceso está bloqueado', () => {
  const blocked = {
    getItem() { throw new Error('get bloqueado'); },
    setItem() { throw new Error('set bloqueado'); },
    removeItem() { throw new Error('remove bloqueado'); },
  };
  assert.equal(S.loadTheme(blocked), 'light');
  assert.equal(S.saveTheme('dark', blocked), false);

  const blockedSet = new MemoryStorage();
  blockedSet.setItem = () => { throw new Error('set bloqueado'); };
  assert.equal(S.saveTheme('dark', blockedSet), false);

  let writes = 0;
  const blockedRemove = {
    getItem() { return null; },
    setItem() {
      writes += 1;
      if (writes === 2) throw new Error('segundo set bloqueado');
    },
    removeItem() { throw new Error('remove bloqueado'); },
  };
  assert.equal(S.saveTheme('dark', blockedRemove), false);
  assert.equal(S.loadTheme(null), 'light');
  assert.equal(S.saveTheme('dark', null), false);
});

test('tema revierte ambas claves si falla una vez la segunda escritura', () => {
  class FailSecondWriteStorage extends MemoryStorage {
    constructor() {
      super();
      this.values.set('cm_eink_mode', 'true');
      this.writeCount = 0;
    }
    setItem(key, value) {
      this.writeCount += 1;
      if (this.writeCount === 2) throw new Error('fallo único en espejo legado');
      super.setItem(key, value);
    }
  }

  const storage = new FailSecondWriteStorage();
  assert.equal(S.saveTheme('dark', storage), false);
  assert.equal(storage.getItem('cm_theme'), null, 'restaura la ausencia de la clave nueva');
  assert.equal(storage.getItem('cm_eink_mode'), 'true', 'restaura el valor legado exacto');
});

test('seguimiento de impresión exitosa se guarda por clave estable', () => {
  assert.equal(S.hasPrintSuccess('sale:abc'), false);
  assert.equal(S.getPrintSuccessAt('sale:abc'), null);
  assert.equal(S.markPrintSuccess('sale:abc', '2026-08-24T12:00:00.000Z'), true);
  assert.equal(S.hasPrintSuccess('sale:abc'), true);
  assert.equal(S.getPrintSuccessAt('sale:abc'), '2026-08-24T12:00:00.000Z');
});

test('seguimiento de impresión ignora claves inválidas y localStorage dañado', () => {
  localStorage.setItem('cm_print_successes', '{mal json');
  assert.equal(S.hasPrintSuccess('sale:abc'), false);
  assert.equal(S.markPrintSuccess('', '2026-08-24T12:00:00.000Z'), false);
  assert.equal(S.getPrintSuccessAt(''), null);
});

test('forgetClient elimina el cliente sin distinguir mayúsculas y conserva el orden', () => {
  S.saveClients(['Ana López', 'Beto', 'Carla']);
  assert.equal(S.forgetClient('  beto '), true);
  assert.deepEqual(S.loadClients(), ['Ana López', 'Carla']);
  assert.equal(S.forgetClient('nadie'), false);
  assert.deepEqual(S.loadClients(), ['Ana López', 'Carla']);
});

test('forgetClient ignora nombres inválidos', () => {
  S.saveClients(['Ana', 'Beto']);
  assert.equal(S.forgetClient(''), false);
  assert.equal(S.forgetClient('   '), false);
  assert.equal(S.forgetClient('x'.repeat(101)), false);
  assert.equal(S.forgetClient(null), false);
  assert.deepEqual(S.loadClients(), ['Ana', 'Beto']);
});

test('renameClient reemplaza en la misma posición, sin distinguir mayúsculas y sin duplicar', () => {
  S.saveClients(['Ana', 'Beto', 'Carla']);
  assert.equal(S.renameClient('beto', 'Roberto'), true);
  assert.deepEqual(S.loadClients(), ['Ana', 'Roberto', 'Carla']);
  // Renombrar a un nombre que ya existe: se fusiona y queda solo el existente, en su propia posición
  assert.equal(S.renameClient('Carla', 'ana'), true);
  assert.deepEqual(S.loadClients(), ['Ana', 'Roberto']);
});

test('renameClient es case-insensitive en el matching del origen', () => {
  S.saveClients(['Ana López']);
  assert.equal(S.renameClient('ana lópez', 'Ana López Gómez'), true);
  assert.deepEqual(S.loadClients(), ['Ana López Gómez']);
});

test('renameClient ignora entrada inválida o nombres ausentes', () => {
  S.saveClients(['Ana', 'Beto']);
  assert.equal(S.renameClient('', 'Nadie'), false);
  assert.equal(S.renameClient('Ana', '   '), false);
  assert.equal(S.renameClient('Ana', 'x'.repeat(101)), false);
  assert.equal(S.renameClient(null, 'Nadie'), false);
  assert.equal(S.renameClient('No Existe', 'Nadie'), false);
  assert.deepEqual(S.loadClients(), ['Ana', 'Beto']);
});

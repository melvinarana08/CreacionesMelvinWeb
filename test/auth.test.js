import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  hashPassword,
  verifyPassword,
  createSessionStore,
} from '../server/auth.js';
import { openDb } from '../server/db.js';

test('hashPassword produce hash con salt aleatorio y verifica correctamente', async () => {
  const h1 = await hashPassword('secreto123');
  const h2 = await hashPassword('secreto123');
  assert.notEqual(h1, h2, 'sal aleatoria por hash');
  assert.ok(h1.startsWith('scrypt$'));
  assert.equal(await verifyPassword('secreto123', h1), true);
  assert.equal(await verifyPassword('otra', h1), false);
  assert.equal(await verifyPassword('', h1), false);
});

test('hashPassword rechaza contraseñas demasiado cortas', async () => {
  await assert.rejects(() => hashPassword('corta'), /al menos/i);
});

test('session store: crear, validar, cerrar y expirar', () => {
  const store = createSessionStore({ ttlMs: 50 });
  const s1 = store.create();
  assert.ok(s1.sessionId.length >= 32);
  assert.ok(s1.csrfToken.length >= 16);
  assert.notEqual(s1.sessionId, s1.csrfToken);

  assert.equal(store.get(s1.sessionId).csrfToken, s1.csrfToken);
  assert.equal(store.get('token-inexistente'), null);

  store.destroy(s1.sessionId);
  assert.equal(store.get(s1.sessionId), null);
});

test('sesiones expiran por TTL', () => {
  const store = createSessionStore({ ttlMs: 30 });
  const s = store.create();
  assert.ok(store.get(s.sessionId));
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(store.get(s.sessionId), null);
      resolve();
    }, 60);
  });
});

test('csrfToken válido solo si coincide con la sesión', () => {
  const store = createSessionStore();
  const a = store.create();
  const b = store.create();
  assert.equal(store.hasValidCsrf(a.sessionId, a.csrfToken), true);
  assert.equal(store.hasValidCsrf(a.sessionId, b.csrfToken), false);
  assert.equal(store.hasValidCsrf(a.sessionId, ''), false);
  assert.equal(store.hasValidCsrf('nope', 'x'), false);
});

test('sesión SQLite sobrevive al reinicio y no almacena el token de cookie en claro', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-auth-'));
  const file = path.join(dir, 'sessions.db');
  let firstDb;
  let secondDb;
  try {
    firstDb = openDb(file);
    const firstInstance = createSessionStore({ db: firstDb, ttlMs: 60_000 });
    const created = firstInstance.create();

    const stored = firstDb.prepare('SELECT session_hash, csrf_token FROM admin_sessions').get();
    assert.notEqual(stored.session_hash, created.sessionId);
    assert.equal(stored.session_hash.length, 64);
    assert.equal(stored.csrf_token, created.csrfToken);
    firstDb.close();
    firstDb = null;

    secondDb = openDb(file);
    const restartedInstance = createSessionStore({ db: secondDb, ttlMs: 60_000 });
    assert.equal(restartedInstance.get(created.sessionId).csrfToken, created.csrfToken);
    assert.equal(restartedInstance.hasValidCsrf(created.sessionId, created.csrfToken), true);

    restartedInstance.destroy(created.sessionId);
    assert.equal(restartedInstance.get(created.sessionId), null);
  } finally {
    firstDb?.close();
    secondDb?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

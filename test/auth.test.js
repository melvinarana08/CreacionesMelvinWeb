import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createSessionStore,
} from '../server/auth.js';

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

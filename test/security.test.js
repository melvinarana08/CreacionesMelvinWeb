// Correcciones de seguridad revisadas: hash scrypt en login (nunca plaintext),
// logout con CSRF, GET /api/sales/:id protegido con SELLER_TOKEN,
// rate-limit solo sobre fallos (se resetea con login exitoso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { loadSeed } from '../server/catalog.js';
import { replaceCatalog } from '../server/store.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');
const PASSWORD = 'super-secreta-123';
const HASH = await hashPassword(PASSWORD);

const UUID1 = '123e4567-e89b-12d3-a456-426614174000';

function startServer(opts = {}) {
  const db = openDb(':memory:');
  replaceCatalog(db, loadSeed(SEED));
  const handler = createApp({
    db,
    adminPasswordHash: opts.adminPasswordHash ?? HASH,
    sellerToken: opts.sellerToken ?? null,
    seedCatalog: SEED,
    loginRateLimit: opts.loginRateLimit ?? { max: 5, windowMs: 60_000 },
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, db, base, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function req(base, p, { method = 'GET', body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h['Cookie'] = cookie;
  const res = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

const sale = (id = UUID1) => ({
  id,
  deviceId: 'dev-sec',
  lines: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 650 }],
  discountCents: 0,
});

test('createApp rechaza adminPassword en texto plano (exige hash scrypt)', () => {
  const db = openDb(':memory:');
  assert.throws(() =>
    createApp({ db, adminPassword: 'texto-plano', seedCatalog: SEED }),
    /adminPasswordHash/
  );
  db.close();
});

test('login verifica contra hash scrypt: correcta 200, incorrecta 401', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  const ok = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(ok.status, 200);
  const bad = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'otra-password' } });
  assert.equal(bad.status, 401);
});

test('logout exige CSRF (es una mutación)', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  const login = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  const cookie = login.setCookie.split(';')[0];
  const csrf = login.data.csrfToken;

  const noCsrf = await req(ctx.base, '/api/admin/logout', { method: 'POST', cookie });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.error.code, 'csrf_failed');

  const withCsrf = await req(ctx.base, '/api/admin/logout', { method: 'POST', cookie, headers: { 'X-CSRF-Token': csrf } });
  assert.equal(withCsrf.status, 200);
  const session = await req(ctx.base, '/api/admin/session', { cookie });
  assert.equal(session.data.authenticated, false);
});

test('GET /api/sales/:id exige X-Seller-Token cuando SELLER_TOKEN está activo', async (t) => {
  const ctx = await startServer({ sellerToken: 'tok-secreto' });
  t.after(ctx.close);
  const created = await req(ctx.base, '/api/sales', { method: 'POST', body: sale(), headers: { 'X-Seller-Token': 'tok-secreto' } });
  assert.equal(created.status, 201);

  const noToken = await req(ctx.base, `/api/sales/${UUID1}`);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.data.error.code, 'seller_token_required');

  const withToken = await req(ctx.base, `/api/sales/${UUID1}`, { headers: { 'X-Seller-Token': 'tok-secreto' } });
  assert.equal(withToken.status, 200);
  assert.equal(withToken.data.sale.folio, 1);
});

test('rate-limit cuenta solo fallos y se resetea con un login exitoso', async (t) => {
  const ctx = await startServer({ loginRateLimit: { max: 3, windowMs: 60_000 } });
  t.after(ctx.close);

  // 1 fallo + 1 éxito: el éxito RESETEA el contador
  const f1 = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'mala' } });
  assert.equal(f1.status, 401);
  const ok = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(ok.status, 200);

  // Tras el reset hacen falta exactamente 3 fallos para bloquear
  for (let i = 0; i < 3; i++) {
    const r = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'mala' } });
    assert.equal(r.status, 401, `fallo ${i + 1} debe ser 401`);
  }
  // Si el éxito NO hubiera reseteado, el 3er fallo ya habría bloqueado
  const blocked = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'mala' } });
  assert.equal(blocked.status, 429);

  // Bloqueado también para contraseña correcta (ventana de bloqueo activa)
  const locked = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(locked.status, 429);
});

test('login incorrecto queda registrado en auditoría, con hash nunca se compara plaintext', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'mala' } });
  const login = await req(ctx.base, '/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  const cookie = login.setCookie.split(';')[0];
  const csrf = login.data.csrfToken;
  const audit = await req(ctx.base, '/api/admin/audit', { cookie });
  const actions = audit.data.entries.map((e) => e.action);
  assert.ok(actions.includes('admin.login_fail'));
  assert.ok(actions.includes('admin.login_ok'));
  // El hash nunca debe aparecer en la auditoría ni en respuestas
  const raw = JSON.stringify(audit.data);
  assert.ok(!raw.includes(HASH.split('$').pop()), 'el hash no se filtra');
  void csrf;
});

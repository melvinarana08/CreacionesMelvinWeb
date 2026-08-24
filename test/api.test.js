import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { loadSeed } from '../server/catalog.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');
const ADMIN_PASSWORD = 'test-password-123';
const ADMIN_HASH = await hashPassword(ADMIN_PASSWORD);

const UUID1 = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '123e4567-e89b-12d3-a456-426614174001';
const UUID3 = '123e4567-e89b-12d3-a456-426614174002';

function salePayload(over = {}) {
  return {
    id: UUID1,
    deviceId: 'dev-test-1',
    clientName: 'Cliente de prueba',
    lines: [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
    discountCents: 0,
    clientTs: '2026-08-24T12:00:00.000Z',
    ...over,
  };
}

function startServer(opts = {}) {
  const db = openDb(':memory:');
  replaceCatalogFromSeed(db);
  const handler = createApp({
    db,
    adminPasswordHash: ADMIN_HASH,
    seedCatalog: SEED,
    sellerToken: opts.sellerToken ?? null,
    sessions: opts.sessions,
    loginRateLimit: opts.loginRateLimit,
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, db, base, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function listenHandler(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

import { replaceCatalog } from '../server/store.js';
function replaceCatalogFromSeed(db) {
  replaceCatalog(db, loadSeed(SEED));
}

async function jsonFetch(base, p, { method = 'GET', body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h['Cookie'] = cookie;
  const res = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers, setCookie: res.headers.get('set-cookie') };
}

const cookieFrom = (setCookie) => setCookie.split(';')[0];

async function login(base, password = ADMIN_PASSWORD) {
  const r = await jsonFetch(base, '/api/admin/login', { method: 'POST', body: { password } });
  assert.equal(r.status, 200);
  return cookieFrom(r.setCookie);
}

async function adminGet(base, cookie, p) {
  return jsonFetch(base, p, { cookie });
}

test('integración HTTP: flujo completo venta + admin', async (t) => {
  const ctx = await startServer();
  const { base, close } = ctx;
  t.after(close);

  // health
  const health = await jsonFetch(base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');

  // catálogo público
  const cat = await jsonFetch(base, '/api/catalog');
  assert.equal(cat.status, 200);
  const names = cat.data.catalog.map((p) => p.name);
  assert.ok(names.includes('Short') && names.includes('Pantalones'));
  const short = cat.data.catalog.find((p) => p.name === 'Short');
  assert.ok(short.sizes.some((s) => s.size === 10 && s.priceCents === 650));

  // venta válida
  const created = await jsonFetch(base, '/api/sales', { method: 'POST', body: salePayload() });
  assert.equal(created.status, 201);
  assert.equal(created.data.sale.folio, 1);
  assert.equal(created.data.sale.status, 'active');
  assert.equal(created.data.sale.totalCents, 1300);
  assert.equal(created.data.sale.items[0].productName, 'Short');

  // replay idempotente: mismo folio, 200
  const replay = await jsonFetch(base, '/api/sales', { method: 'POST', body: salePayload() });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.sale.folio, 1);

  // validaciones
  const badDiscount = await jsonFetch(base, '/api/sales', {
    method: 'POST',
    body: salePayload({ discountCents: 99999 }),
  });
  assert.equal(badDiscount.status, 400);
  assert.equal(badDiscount.data.error.code, 'discount_exceeds_subtotal');

  const badPrice = await jsonFetch(base, '/api/sales', {
    method: 'POST',
    body: salePayload({ id: UUID2, lines: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 999 }] }),
  });
  assert.equal(badPrice.status, 409);
  assert.equal(badPrice.data.error.code, 'price_changed');

  const badId = await jsonFetch(base, '/api/sales', {
    method: 'POST',
    body: salePayload({ id: 'no-es-uuid' }),
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.data.error.code, 'invalid_id');

  // admin: sin sesión → 401
  const unauth = await adminGet(base, '', '/api/admin/sales');
  assert.equal(unauth.status, 401);

  // login con contraseña incorrecta → 401
  const badLogin = await jsonFetch(base, '/api/admin/login', { method: 'POST', body: { password: 'wrong-password' } });
  assert.equal(badLogin.status, 401);

  // login correcto
  const cookie = await login(base);

  // sesión expone csrfToken
  const session = await adminGet(base, cookie, '/api/admin/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);
  assert.ok(session.data.csrfToken);
  const csrf = session.data.csrfToken;

  // listar ventas
  const salesList = await adminGet(base, cookie, '/api/admin/sales');
  assert.equal(salesList.status, 200);
  assert.equal(salesList.data.sales.length, 1);
  assert.equal(salesList.data.sales[0].folio, 1);

  // mutación sin CSRF → 403
  const noCsrf = await jsonFetch(base, '/api/admin/sales', { method: 'POST', cookie });
  assert.equal(noCsrf.status, 403);

  // mutación con Origin extraño → 403
  const evilOrigin = await jsonFetch(base, '/api/admin/sales', {
    method: 'POST',
    cookie,
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://evil.example' },
  });
  assert.equal(evilOrigin.status, 403);

  // anulación
  const voided = await jsonFetch(base, `/api/admin/sales/${UUID1}/void`, {
    method: 'POST',
    cookie,
    headers: { 'X-CSRF-Token': csrf },
    body: { reason: 'Cliente devolvió la mercancía' },
  });
  assert.equal(voided.status, 200);
  assert.equal(voided.data.sale.status, 'voided');
  assert.equal(voided.data.sale.voidReason, 'Cliente devolvió la mercancía');
  assert.equal(voided.data.sale.totalCents, 1300, 'el original se conserva');

  const voidAgain = await jsonFetch(base, `/api/admin/sales/${UUID1}/void`, {
    method: 'POST',
    cookie,
    headers: { 'X-CSRF-Token': csrf },
    body: { reason: 'otra vez' },
  });
  assert.equal(voidAgain.status, 409);
  assert.equal(voidAgain.data.error.code, 'already_voided');

  // editar/eliminar venta no existe como endpoint
  const del = await jsonFetch(base, `/api/admin/sales/${UUID1}`, { method: 'DELETE', cookie, headers: { 'X-CSRF-Token': csrf } });
  assert.ok([404, 405].includes(del.status), `DELETE debe estar prohibido, got ${del.status}`);

  // actualizar catálogo (admin)
  const newCatalog = [
    { name: 'Short', sizes: [{ size: 10, priceCents: 900 }, { size: 12, priceCents: 950 }] },
    { name: 'Nuevo Producto', sizes: [{ size: 4, priceCents: 300 }] },
    { name: 'Chalecos', sizes: [{ size: 'XS', priceCents: 1200 }, { size: 'Otro', priceCents: 1500 }] },
  ];
  const put = await jsonFetch(base, '/api/admin/catalog', {
    method: 'PUT',
    cookie,
    headers: { 'X-CSRF-Token': csrf },
    body: { catalog: newCatalog },
  });
  assert.equal(put.status, 200);
  const catAfter = await jsonFetch(base, '/api/catalog');
  assert.equal(catAfter.data.catalog.length, 3);
  assert.ok(catAfter.data.catalog.some((p) => p.name === 'Nuevo Producto'));

  // tallas en letras se guardan y pueden venderse
  const alphaSizeSale = await jsonFetch(base, '/api/sales', {
    method: 'POST',
    body: salePayload({
      id: UUID3,
      lines: [{ product: 'Chalecos', size: 'XS', quantity: 1, unitPriceCents: 1200 }],
    }),
  });
  assert.equal(alphaSizeSale.status, 201);
  assert.equal(alphaSizeSale.data.sale.items[0].size, 'XS');

  // con el precio nuevo, la venta vieja con precio viejo → 409 (precio inmutable en curso)
  const stale = await jsonFetch(base, '/api/sales', {
    method: 'POST',
    body: salePayload({ id: UUID2, lines: [{ product: 'Short', size: 10, quantity: 1, unitPriceCents: 650 }] }),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'price_changed');

  // la venta ya creada conserva su snapshot histórico
  const fetchOld = await jsonFetch(base, `/api/sales/${UUID1}`);
  assert.equal(fetchOld.status, 200);
  assert.equal(fetchOld.data.sale.items[0].unitPriceCents, 650);

  // PUT catálogo inválido → 400
  const badCat = await jsonFetch(base, '/api/admin/catalog', {
    method: 'PUT',
    cookie,
    headers: { 'X-CSRF-Token': csrf },
    body: { catalog: [{ name: 'X', sizes: [{ size: 4, priceCents: -1 }] }] },
  });
  assert.equal(badCat.status, 400);

  // audit log registra acciones de admin
  const audit = await adminGet(base, cookie, '/api/admin/audit');
  assert.equal(audit.status, 200);
  const actions = audit.data.entries.map((e) => e.action);
  assert.ok(actions.includes('admin.login_ok'));
  assert.ok(actions.includes('admin.login_fail'));
  assert.ok(actions.includes('sale.void'));
  assert.ok(actions.includes('catalog.replace'));

  // logout invalida la sesión
  const out = await jsonFetch(base, '/api/admin/logout', { method: 'POST', cookie, headers: { 'X-CSRF-Token': csrf } });
  assert.equal(out.status, 200);
  const sessionAfter = await adminGet(base, cookie, '/api/admin/session');
  assert.equal(sessionAfter.data.authenticated, false);
});

test('sesión admin persiste entre dos instancias que comparten SQLite', async (t) => {
  const db = openDb(':memory:');
  replaceCatalogFromSeed(db);
  const opts = { db, adminPasswordHash: ADMIN_HASH, seedCatalog: SEED };
  const instanceA = await listenHandler(createApp(opts));
  const instanceB = await listenHandler(createApp(opts));
  t.after(async () => {
    await Promise.all([instanceA.close(), instanceB.close()]);
    db.close();
  });

  const loginA = await jsonFetch(instanceA.base, '/api/admin/login', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });
  assert.equal(loginA.status, 200);
  const cookie = cookieFrom(loginA.setCookie);
  const csrf = loginA.data.csrfToken;

  const sessionB = await adminGet(instanceB.base, cookie, '/api/admin/session');
  assert.equal(sessionB.status, 200);
  assert.equal(sessionB.data.authenticated, true);

  const catalog = (await jsonFetch(instanceA.base, '/api/catalog')).data.catalog;
  const putB = await jsonFetch(instanceB.base, '/api/admin/catalog', {
    method: 'PUT',
    cookie,
    headers: { 'X-CSRF-Token': csrf },
    body: { catalog },
  });
  assert.equal(putB.status, 200);
});

test('rate-limit: 5 intentos fallidos de login bloquean temporalmente', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await jsonFetch(ctx.base, '/api/admin/login', { method: 'POST', body: { password: 'mala' } });
    last = r.status;
  }
  assert.equal(last, 429);
});

test('SELLER_TOKEN: endpoint de ventas exige X-Seller-Token cuando está habilitado', async (t) => {
  const ctx = await startServer({ sellerToken: 's3ller-secret' });
  t.after(ctx.close);

  const noToken = await jsonFetch(ctx.base, '/api/sales', { method: 'POST', body: salePayload() });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.data.error.code, 'seller_token_required');

  const wrong = await jsonFetch(ctx.base, '/api/sales', {
    method: 'POST',
    body: salePayload(),
    headers: { 'X-Seller-Token': 'incorrecto' },
  });
  assert.equal(wrong.status, 401);

  const ok = await jsonFetch(ctx.base, '/api/sales', {
    method: 'POST',
    body: salePayload(),
    headers: { 'X-Seller-Token': 's3ller-secret' },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.sale.folio, 1);
});

test('cabeceras de seguridad básicas en respuestas', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  const r = await jsonFetch(ctx.base, '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  const html = await jsonFetch(ctx.base, '/');
  assert.ok(html.data.includes('Creaciones Melvin'));
  const csp = html.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("script-src 'self'"), 'CSP sin inline scripts');
  assert.ok(csp && !csp.includes("'unsafe-inline'"), 'CSP no debe permitir inline');
});

test('body JSON malformado y content-type incorrecto → 400', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  const res = await fetch(ctx.base + '/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(res.status, 400);
  const res2 = await fetch(ctx.base + '/api/sales', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hola' });
  assert.equal(res2.status, 415);
});

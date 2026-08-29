// app.js — fábrica del manejador HTTP (sin listen, para poder testear).
// Controles de seguridad:
//  - Cookies de sesión HttpOnly + SameSite=Strict (+ Secure configurable).
//  - Token CSRF por sesión (cabecera X-CSRF-Token) en todas las mutaciones admin.
//  - Origin same-origin obligatorio en mutaciones admin cuando el header viene.
//  - Rate-limit del login por IP.
//  - SELLER_TOKEN opcional: si se define, POST /api/sales exige X-Seller-Token.
//  - CSP estricta (sin inline), nosniff, no-referrer, body con límite de tamaño.
//  - Audit log de acciones administrativas.
import { readFileSync, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from './errors.js';
import { createSessionStore, verifyPassword } from './auth.js';
import { getCatalog, replaceCatalog, createSale, voidSale, getSale, listSales, logAudit, listAudit } from './store.js';
import { loadSeed, toPublicCatalog } from './catalog.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PKG = JSON.parse(readFileSync(path.resolve(PUBLIC_DIR, '..', 'package.json'), 'utf8'));

const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = 'cm_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8', noCache: true }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', noCache: true }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/domain.js', { file: 'domain.js', type: 'text/javascript; charset=utf-8' }],
  ['/storage.js', { file: 'storage.js', type: 'text/javascript; charset=utf-8' }],
  ['/api.js', { file: 'api.js', type: 'text/javascript; charset=utf-8' }],
  ['/printer.js', { file: 'printer.js', type: 'text/javascript; charset=utf-8' }],
  ['/sw.js', { file: 'sw.js', type: 'text/javascript; charset=utf-8', noCache: true }],
  ['/manifest.webmanifest', { file: 'manifest.webmanifest', type: 'application/manifest+json', noCache: true }],
  ['/icons/icon-192.png', { file: 'icons/icon-192.png', type: 'image/png' }],
  ['/icons/icon-512.png', { file: 'icons/icon-512.png', type: 'image/png' }],
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function createRateLimiter({ max = 5, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return {
    /** true si la clave está bloqueada (>= max fallos en la ventana). */
    isBlocked(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now > h.resetAt) return false;
      return h.count >= max;
    },
    /** Registra un FALLO (no se llama en éxitos). */
    registerFailure(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now > h.resetAt) hits.set(key, { count: 1, resetAt: now + windowMs });
      else h.count += 1;
    },
    /** Borra el contador (login exitoso). */
    reset(key) {
      hits.delete(key);
    },
  };
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function secureHeaders(res, isHtml = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHtml) res.setHeader('Content-Security-Policy', CSP);
}

/** Lee el body JSON con límite de tamaño. Devuelve null si no hay body. */
async function readJsonBody(req) {
  const ct = req.headers['content-type'];
  if (ct && !String(ct).toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type debe ser application/json');
  }
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', 'Cuerpo demasiado grande');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', 'Cuerpo demasiado grande');
    chunks.push(chunk);
  }
  if (total === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON inválido');
  }
}

function secureEquals(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function sameOrigin(req, origin) {
  try {
    const u = new URL(origin);
    const host = req.headers.host || '';
    return u.host === host && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {import('node:sqlite').DatabaseSync} opts.db
 * @param {string} opts.adminPasswordHash   Hash scrypt (auth.hashPassword). NUNCA la contraseña en texto plano.
 * @param {string|null} opts.sellerToken    Si se define, protege las rutas de ventas (POST /api/sales y GET /api/sales/:id)
 * @param {string|null} opts.seedCatalog    Ruta a productos.json para el seed inicial
 * @param {object} [opts.sessions]          Almacén de sesiones (auth.createSessionStore)
 * @param {boolean} [opts.secureCookies]    Añade Secure a la cookie (HTTPS)
 * @param {boolean} [opts.trustProxy]       Respeta X-Forwarded-For
 * @param {object} [opts.loginRateLimit]    {max, windowMs} para el rate-limit del login
 */
export function createApp(opts) {
  const {
    db,
    adminPasswordHash,
    sellerToken = null,
    seedCatalog = null,
    sessions = createSessionStore({ ttlMs: SESSION_TTL_MS, db }),
    secureCookies = false,
    trustProxy = false,
    loginRateLimit = { max: 5, windowMs: 60_000 },
  } = opts;

  if (typeof adminPasswordHash !== 'string' || !adminPasswordHash.startsWith('scrypt$')) {
    throw new Error('createApp exige adminPasswordHash (hash scrypt). La contraseña en texto plano no es aceptable.');
  }

  // Seed inicial: si no hay productos, cargar desde productos.json
  if (seedCatalog && getCatalog(db).length === 0) {
    replaceCatalog(db, loadSeed(seedCatalog));
  }

  const loginLimiter = createRateLimiter(loginRateLimit);

  const cookieAttrs = `HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureCookies ? '; Secure' : ''}`;

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { status: 'ok', time: new Date().toISOString(), version: PKG.version });
    }

    if (method === 'GET' && pathname === '/api/catalog') {
      return sendJson(res, 200, { catalog: toPublicCatalog(getCatalog(db)), generatedAt: new Date().toISOString() });
    }

    // ---- Ventas (público en la red autorizada; X-Seller-Token si está activo) ----
    const sellerOk = !sellerToken || (typeof req.headers['x-seller-token'] === 'string' && secureEquals(req.headers['x-seller-token'], sellerToken));

    if (method === 'POST' && pathname === '/api/sales') {
      if (!sellerOk) {
        throw new HttpError(401, 'seller_token_required', 'Se requiere X-Seller-Token');
      }
      const body = await readJsonBody(req);
      const existing = body && typeof body.id === 'string' ? getSale(db, body.id) : null;
      const sale = createSale(db, body ?? {}, getCatalog(db));
      if (!existing) {
        logAudit(db, 'sale.create', sale.deviceId, { folio: sale.folio, totalCents: sale.totalCents });
      }
      return sendJson(res, existing ? 200 : 201, { sale });
    }

    if (method === 'GET' && /^\/api\/sales\/[^/]+$/.test(pathname)) {
      if (!sellerOk) {
        throw new HttpError(401, 'seller_token_required', 'Se requiere X-Seller-Token');
      }
      const id = decodeURIComponent(pathname.split('/').pop());
      const sale = getSale(db, id);
      if (!sale) throw new HttpError(404, 'sale_not_found', 'Venta no encontrada');
      return sendJson(res, 200, { sale });
    }

    // ---- Admin ----
    if (pathname.startsWith('/api/admin/')) {
      const cookies = parseCookies(req);
      const sessionId = cookies[SESSION_COOKIE] || null;
      const session = sessionId ? sessions.get(sessionId) : null;
      const ip = clientIp(req, trustProxy);

      // login NO requiere sesión previa
      if (method === 'POST' && pathname === '/api/admin/login') {
        if (loginLimiter.isBlocked(ip)) {
          logAudit(db, 'admin.login_blocked', ip);
          throw new HttpError(429, 'too_many_attempts', 'Demasiados intentos; espera un minuto e inténtalo de nuevo');
        }
        const body = await readJsonBody(req);
        const ok = typeof body?.password === 'string' && (await verifyPassword(body.password, adminPasswordHash));
        if (!ok) {
          loginLimiter.registerFailure(ip);
          logAudit(db, 'admin.login_fail', ip);
          throw new HttpError(401, 'invalid_credentials', 'Contraseña incorrecta');
        }
        loginLimiter.reset(ip);
        const { sessionId: sid, csrfToken } = sessions.create();
        logAudit(db, 'admin.login_ok', ip);
        return sendJson(res, 200, { ok: true, csrfToken }, { 'Set-Cookie': `${SESSION_COOKIE}=${sid}; ${cookieAttrs}` });
      }

      // El resto exige sesión; session siempre responde 200 con el estado
      if (!session) {
        if (method === 'GET' && pathname === '/api/admin/session') {
          return sendJson(res, 200, { authenticated: false });
        }
        throw new HttpError(401, 'unauthorized', 'Sesión requerida');
      }

      // Mutaciones admin (incluido logout): CSRF + Origin same-origin
      const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE';
      if (isMutation) {
        const origin = req.headers.origin;
        if (origin && !sameOrigin(req, origin)) {
          throw new HttpError(403, 'origin_mismatch', 'Origen no permitido');
        }
        const csrfHeader = req.headers['x-csrf-token'];
        if (typeof csrfHeader !== 'string' || !sessions.hasValidCsrf(sessionId, csrfHeader)) {
          throw new HttpError(403, 'csrf_failed', 'Token CSRF inválido');
        }
      }

      if (method === 'POST' && pathname === '/api/admin/logout') {
        sessions.destroy(sessionId);
        logAudit(db, 'admin.logout', ip);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      }

      if (method === 'GET' && pathname === '/api/admin/session') {
        return sendJson(res, 200, { authenticated: true, csrfToken: session.csrfToken });
      }

      if (method === 'GET' && pathname === '/api/admin/sales') {
        const status = typeof url.searchParams.get('status') === 'string' && url.searchParams.get('status') !== ''
          ? url.searchParams.get('status')
          : null;
        const limit = Number(url.searchParams.get('limit')) || 100;
        return sendJson(res, 200, { sales: listSales(db, { status, limit }) });
      }

      if (method === 'POST' && /^\/api\/admin\/sales\/[^/]+\/void$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split('/')[4]);
        const body = await readJsonBody(req);
        const sale = voidSale(db, id, body?.reason);
        logAudit(db, 'sale.void', ip, { folio: sale.folio, reason: sale.voidReason });
        return sendJson(res, 200, { sale });
      }

      if (method === 'PUT' && pathname === '/api/admin/catalog') {
        const body = await readJsonBody(req);
        const clean = replaceCatalog(db, body?.catalog);
        logAudit(db, 'catalog.replace', ip, { products: clean.length });
        return sendJson(res, 200, { catalog: toPublicCatalog(clean) });
      }

      if (method === 'GET' && pathname === '/api/admin/audit') {
        const limit = Number(url.searchParams.get('limit')) || 200;
        return sendJson(res, 200, { entries: listAudit(db, limit) });
      }

      throw new HttpError(404, 'not_found', 'Endpoint admin no encontrado');
    }

    throw new HttpError(404, 'not_found', 'Endpoint no encontrado');
  }

  return async function handler(req, res) {
    secureHeaders(res);
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }

      const staticEntry = STATIC_FILES.get(url.pathname);
      if (!staticEntry) {
        secureHeaders(res);
        sendJson(res, 404, { error: { code: 'not_found', message: 'No encontrado' } });
        return;
      }
      const filePath = path.join(PUBLIC_DIR, staticEntry.file);
      if (!existsSync(filePath)) {
        secureHeaders(res);
        sendJson(res, 404, { error: { code: 'not_found', message: 'No encontrado' } });
        return;
      }
      const isHtml = staticEntry.type.startsWith('text/html');
      secureHeaders(res, isHtml);
      const cache = staticEntry.noCache ? 'no-cache' : 'public, max-age=300';
      res.writeHead(200, {
        'Content-Type': staticEntry.type,
        'Cache-Control': cache,
        'Content-Length': readFileSync(filePath).length,
      });
      res.end(readFileSync(filePath));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const code = err instanceof HttpError ? err.code : 'internal';
      const message = err instanceof HttpError ? err.message : 'Error interno del servidor';
      if (!(err instanceof HttpError)) console.error('ERROR no controlado:', err);
      try {
        secureHeaders(res);
        sendJson(res, status, { error: { code, message } });
      } catch {
        res.destroy();
      }
    }
  };
}

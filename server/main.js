// main.js — punto de entrada del servidor (arranque, env, apagado ordenado).
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Carga .env si existe (sin dependencias). No pisa variables ya definidas. */
function loadEnvFile() {
  try {
    const content = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* sin .env: usar variables de entorno */
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT) || 3000;
// Dirección de escucha. En contenedor debe ser 0.0.0.0; en producción
// local se puede fijar la IP de la interfaz (p. ej. 192.168.1.134).
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || 'data/sales.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const SELLER_TOKEN = process.env.SELLER_TOKEN || null;
const COOKIE_SECURE = /^(true|1|yes)$/i.test(process.env.COOKIE_SECURE || '');
const TRUST_PROXY = /^(true|1|yes)$/i.test(process.env.TRUST_PROXY || '');

let adminPassword = ADMIN_PASSWORD;
if (!adminPassword) {
  // Solo desarrollo: contraseña efímera impresa una vez. Nunca en repo.
  adminPassword = randomBytes(9).toString('base64url');
  console.warn('⚠️  ADMIN_PASSWORD no definido. Se generó una contraseña temporal (solo desarrollo):');
  console.warn(`   ADMIN_PASSWORD=${adminPassword}`);
}
if (adminPassword.length < 8) {
  console.error('ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  process.exit(1);
}

// La contraseña se deriva a hash scrypt UNA vez al arranque; el login
// verifica contra el hash. Nunca se compara texto plano.
const adminPasswordHash = await hashPassword(adminPassword);
adminPassword = null;

mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

const handler = createApp({
  db,
  adminPasswordHash,
  sellerToken: SELLER_TOKEN,
  seedCatalog: path.join(ROOT, 'productos.json'),
  secureCookies: COOKIE_SECURE,
  trustProxy: TRUST_PROXY,
});

const server = http.createServer(handler);
server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Creaciones Melvin — servidor de ventas v${process.env.npm_package_version || '0.1.0'}`);
  console.log(`  URL:      http://${BIND_ADDRESS}:${PORT}`);
  console.log(`  Base:     ${DB_PATH}`);
  console.log(`  Token vendedor: ${SELLER_TOKEN ? 'habilitado (SELLER_TOKEN)' : 'deshabilitado'}`);
  console.log(`  Cookies Secure: ${COOKIE_SECURE ? 'sí (HTTPS)' : 'no (HTTP)'}`);
});

function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ya cerrada */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

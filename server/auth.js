// auth.js — hash de contraseñas (scrypt), sesiones SQLite y CSRF.
// Seguridad: hash con salt aleatorio + scrypt; sesión con token aleatorio de
// 256 bits en cookie HttpOnly SameSite=Strict; token CSRF separado por sesión.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const MIN_PASSWORD_LEN = 8;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Deriva un hash portable: scrypt$N$r$p$saltHex$hashHex */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), key.toString('hex')].join('$');
}

/** Verifica una contraseña contra un hash generado por hashPassword. */
export async function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSessionId(sessionId) {
  return createHash('sha256').update(String(sessionId)).digest('hex');
}

/**
 * Almacén de sesiones. Con `db` persiste en SQLite y sobrevive reinicios o
 * múltiples instancias; sin `db` conserva el Map en memoria para pruebas aisladas.
 * En SQLite solo se guarda SHA-256 del token de cookie, nunca el token reutilizable.
 */
export function createSessionStore({ ttlMs = 8 * 60 * 60 * 1000, db = null } = {}) {
  const sessions = db ? null : new Map();

  const insertSession = db?.prepare(`
    INSERT INTO admin_sessions (session_hash, csrf_token, expires_at)
    VALUES (?, ?, ?)
  `);
  const selectSession = db?.prepare(`
    SELECT csrf_token AS csrfToken, expires_at AS expiresAt
    FROM admin_sessions WHERE session_hash = ?
  `);
  const deleteSession = db?.prepare('DELETE FROM admin_sessions WHERE session_hash = ?');
  const deleteExpired = db?.prepare('DELETE FROM admin_sessions WHERE expires_at < ?');
  const countSessions = db?.prepare('SELECT COUNT(*) AS count FROM admin_sessions WHERE expires_at >= ?');

  return {
    create() {
      const sessionId = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(16).toString('hex');
      const expiresAt = Date.now() + ttlMs;
      if (db) {
        deleteExpired.run(Date.now());
        insertSession.run(hashSessionId(sessionId), csrfToken, expiresAt);
      } else {
        sessions.set(sessionId, { csrfToken, expiresAt });
      }
      return { sessionId, csrfToken };
    },

    /** Devuelve la sesión si es válida (no expirada), o null. */
    get(sessionId) {
      const key = db ? hashSessionId(sessionId) : sessionId;
      const s = db ? selectSession.get(key) : sessions.get(key);
      if (!s) return null;
      if (Date.now() > s.expiresAt) {
        if (db) deleteSession.run(key);
        else sessions.delete(key);
        return null;
      }
      return s;
    },

    destroy(sessionId) {
      if (db) deleteSession.run(hashSessionId(sessionId));
      else sessions.delete(sessionId);
    },

    hasValidCsrf(sessionId, csrfToken) {
      const s = this.get(sessionId);
      if (!s || typeof csrfToken !== 'string' || csrfToken.length !== s.csrfToken.length) return false;
      return timingSafeEqual(Buffer.from(csrfToken), Buffer.from(s.csrfToken));
    },

    get size() {
      if (db) {
        deleteExpired.run(Date.now());
        return Number(countSessions.get(Date.now()).count);
      }
      return sessions.size;
    },
  };
}

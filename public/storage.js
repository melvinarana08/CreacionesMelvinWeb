// storage.js — persistencia local del frontend:
//  - IndexedDB: cola de ventas pendientes (offline-first, idempotente por UUID)
//  - localStorage: deviceId, token de vendedor (si SELLER_TOKEN está activo), carrito
'use strict';

const DB_NAME = 'creaciones-melvin';
const DB_VERSION = 1;
const STORE = 'pending_sales';

const LS_DEVICE_ID = 'cm_device_id';
const LS_SELLER_TOKEN = 'cm_seller_token';
const LS_CART = 'cm_cart';
const LS_CATALOG = 'cm_catalog';

export function createUuid(cryptoImpl = globalThis.crypto, random = Math.random) {
  // crypto.randomUUID disponible en contextos seguros (https/localhost)
  if (cryptoImpl && typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

/** Guarda una venta pendiente en la cola local. Clave = UUID (idempotente). */
export function savePendingSale(payload) {
  return tx('readwrite', (store) => {
    store.put({ id: payload.id, payload, status: 'pending', savedAt: new Date().toISOString(), serverResponse: null });
  });
}

/** Marca una venta pendiente como sincronizada y guarda la respuesta del servidor. */
export function markSynced(id, serverSale) {
  return tx('readwrite', (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result;
      if (rec) {
        rec.status = 'synced';
        rec.serverResponse = serverSale;
        rec.syncedAt = new Date().toISOString();
        store.put(rec);
      }
    };
  });
}

/** Marca una venta como conflicto (p. ej. precio cambió) conservando el payload. */
export function markConflict(id, reason) {
  return tx('readwrite', (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result;
      if (rec) {
        rec.status = 'conflict';
        rec.conflictReason = reason;
        store.put(rec);
      }
    };
  });
}

async function readAllSales() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    let rows = [];
    request.onsuccess = () => { rows = request.result ?? []; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(rows); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export function listPendingSales() {
  return readAllSales();
}

export async function countPending() {
  const rows = await readAllSales();
  return rows.filter((record) => record.status === 'pending').length;
}

export function removePending(id) {
  return tx('readwrite', (store) => store.delete(id));
}

// ---------- localStorage ----------

export function getDeviceId() {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = createUuid();
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

export function saveCatalog(catalog) {
  if (!Array.isArray(catalog)) return;
  localStorage.setItem(LS_CATALOG, JSON.stringify(catalog));
}

export function loadCatalog() {
  try {
    const raw = localStorage.getItem(LS_CATALOG);
    if (!raw) return null;
    const catalog = JSON.parse(raw);
    return Array.isArray(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

export function getSellerToken() {
  return localStorage.getItem(LS_SELLER_TOKEN) || null;
}

export function setSellerToken(token) {
  localStorage.setItem(LS_SELLER_TOKEN, token);
}

export function hasSellerToken() {
  return !!getSellerToken();
}

export function saveCart(cart) {
  localStorage.setItem(LS_CART, JSON.stringify(cart));
}

export function loadCart() {
  try {
    const raw = localStorage.getItem(LS_CART);
    const cart = raw ? JSON.parse(raw) : [];
    return Array.isArray(cart) ? cart : [];
  } catch {
    return [];
  }
}

export function clearCart() {
  localStorage.removeItem(LS_CART);
}

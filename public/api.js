// api.js — cliente fetch del frontend. Devuelve {ok, status, data, error}
// donde error es {code, message} cuando el servidor responde 4xx/5xx.
'use strict';

export async function apiFetch(path, { method = 'GET', body, csrf, sellerToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (sellerToken) headers['X-Seller-Token'] = sellerToken;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, networkError: true, status: 0, data: null, error: { code: 'network', message: 'Sin conexión con el servidor' } };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok) return { ok: true, status: res.status, data };
  return {
    ok: false,
    status: res.status,
    data,
    error: (data && data.error) || { code: 'http_' + res.status, message: `Error HTTP ${res.status}` },
  };
}

export const fetchHealth = () => apiFetch('/api/health');
export const fetchCatalog = () => apiFetch('/api/catalog');

export function postSale(payload, sellerToken) {
  return apiFetch('/api/sales', { method: 'POST', body: payload, sellerToken });
}

export const adminLogin = (password) => apiFetch('/api/admin/login', { method: 'POST', body: { password } });
export const adminSession = () => apiFetch('/api/admin/session');
export const adminLogout = (csrf) => apiFetch('/api/admin/logout', { method: 'POST', csrf });
export const adminListSales = (csrf, status = '', limit = 100) =>
  apiFetch(`/api/admin/sales?status=${encodeURIComponent(status)}&limit=${limit}`, { csrf });
export const adminVoidSale = (csrf, id, reason) =>
  apiFetch(`/api/admin/sales/${encodeURIComponent(id)}/void`, { method: 'POST', body: { reason }, csrf });
export const adminPutCatalog = (csrf, catalog) =>
  apiFetch('/api/admin/catalog', { method: 'PUT', body: { catalog }, csrf });
export const adminAudit = (csrf, limit = 100) =>
  apiFetch(`/api/admin/audit?limit=${limit}`, { csrf });

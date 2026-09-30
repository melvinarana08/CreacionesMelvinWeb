// ui-interactions.js — interacciones pequeñas y testeables sin depender del DOM global.
'use strict';

/** Sends only pending records; failures stay in IndexedDB for a later retry. */
export async function runPendingSync({ records, postSale, markSynced, markConflict, getSellerToken, askSellerToken, onSynced, onConflict, onProgress }) {
  const pending = records.filter((record) => record.status === 'pending');
  const outcome = { total: pending.length, sent: 0, conflicted: 0, failed: 0, tokenRequired: 0, networkFailed: false };
  for (const [index, record] of pending.entries()) {
    onProgress?.(index + 1, pending.length);
    try {
      let result = await postSale(record.payload, getSellerToken());
      if (!result.ok && result.error?.code === 'seller_token_required') {
        const token = askSellerToken();
        if (!token) { outcome.tokenRequired++; continue; }
        result = await postSale(record.payload, token);
      }
      if (result.ok) {
        const sale = result.data?.sale;
        // The server returns { sale: { id, folio, ... } }; only that sale can confirm this UUID.
        if (typeof record.id !== 'string' || !record.id || record.payload?.id !== record.id
          || !sale || typeof sale !== 'object' || Array.isArray(sale)
          || sale.id !== record.id || !Number.isSafeInteger(sale.folio) || sale.folio < 1) {
          outcome.failed++;
          continue;
        }
        await markSynced(record.id, sale);
        outcome.sent++;
        try { onSynced?.(record, sale); } catch (error) { console.error('No se pudo actualizar el comprobante:', error); }
      } else if (result.error?.code === 'price_changed') {
        await markConflict(record.id, result.error.message);
        outcome.conflicted++;
        try { onConflict?.(record); } catch (error) { console.error('No se pudo mostrar el conflicto:', error); }
      } else {
        outcome.failed++;
        if (result.networkError) outcome.networkFailed = true;
      }
    } catch (error) {
      console.error('No se pudo sincronizar la venta:', error);
      outcome.failed++;
    }
  }
  return outcome;
}

/** Completion text reflects persisted queue state, not just a successful request. */
export function syncResultMessage(outcome, remaining, conflicts, offline) {
  const { total, sent, failed, tokenRequired } = outcome;
  if (!total && !conflicts) return { text: 'No hay ventas pendientes.', type: 'success' };
  const parts = [];
  if (sent) parts.push(`${sent} enviada${sent === 1 ? '' : 's'}`);
  if (remaining) parts.push(`${remaining} pendiente${remaining === 1 ? '' : 's'}`);
  if (conflicts) parts.push(`${conflicts} en conflicto de precio (revisar en administración)`);
  if (tokenRequired) parts.push('Se necesita el token de vendedor para reintentar');
  if (failed) parts.push(`${failed} sin enviar por error; reintentá`);
  if (offline && remaining) parts.push('Sin conexión; reintentá cuando vuelva');
  return { text: `${parts.join('. ')}.`, type: remaining || conflicts ? 'failure' : 'success' };
}

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 99;

/** Actualiza los chips existentes sin crear, eliminar ni reemplazar controles. */
export function updateSizeChipSelection(chips, selectedChip) {
  for (const chip of chips) {
    const selected = chip === selectedChip;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  }
}

export function clampQuantity(value) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, numeric));
}

/** Centraliza texto, límites y estado seleccionado de los controles de cantidad. */
export function updateQuantityControls({ value, valueNode, minusButton, plusButton, presets = [] }) {
  const quantity = clampQuantity(value);
  if (valueNode) valueNode.textContent = String(quantity);
  if (minusButton) minusButton.disabled = quantity === MIN_QUANTITY;
  if (plusButton) plusButton.disabled = quantity === MAX_QUANTITY;
  for (const button of presets) {
    const selected = Number(button.dataset?.quantity) === quantity;
    button.classList?.toggle('selected', selected);
    button.setAttribute?.('aria-pressed', String(selected));
  }
  return quantity;
}

export const INLINE_CUSTOMER_LIMIT = 8;

function normalizeCustomerName(value) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

// Only short queries get fuzzy matches; stop the matrix when the edit bound is exceeded.
function boundedDistance(a, b, bound) {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...current) > bound) return bound + 1;
    previous = current;
  }
  return previous[b.length];
}

/** Rank exact, prefix, substring, then bounded typos; preserve recent-first ties. */
export function filterCustomerSuggestions(customers, query = '', limit = INLINE_CUSTOMER_LIMIT) {
  if (!Array.isArray(customers)) return [];
  const needle = normalizeCustomerName(String(query).trim());
  const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, INLINE_CUSTOMER_LIMIT) : INLINE_CUSTOMER_LIMIT;
  const seen = new Set();
  const matches = [];
  for (const value of customers) {
    if (typeof value !== 'string') continue;
    const clean = value.trim();
    const key = normalizeCustomerName(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let rank = 0;
    if (needle) {
      if (key === needle) rank = 0;
      else if (key.startsWith(needle)) rank = 1;
      else if (key.includes(needle)) rank = 2;
      else {
        if (needle.length < 3) continue;
        const bound = needle.length >= 6 ? 2 : 1;
        const distance = boundedDistance(needle, key, bound);
        if (distance > bound) continue;
        rank = 2 + distance;
      }
    }
    matches.push({ clean, rank, index: matches.length });
  }
  matches.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return matches.slice(0, max).map(({ clean }) => clean);
}

export function shouldShowCustomerSuggestions({ engaged, matches }) {
  return Boolean(engaged && Array.isArray(matches) && matches.length > 0);
}

/** Decide los cierres sin depender de temporización del navegador. */
export function shouldDismissCustomerSuggestions({ type, key, target, relatedTarget, input, suggestions }) {
  if (type === 'keydown') return key === 'Escape';
  const node = type === 'focusout' ? relatedTarget : target;
  if (node === input) return false;
  if (suggestions?.contains?.(node)) return false;
  return type === 'pointerdown' || type === 'focusout';
}

/** Aplica una selección, oculta selectores y anuncia el resultado sin abrir el teclado. */
export function applySelectedCustomer({ name, input, dialog, suggestions, status }) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return false;
  input.value = clean;
  dialog?.close?.();
  if (suggestions) suggestions.hidden = true;
  if (status) {
    status.hidden = false;
    status.textContent = `Cliente elegido: ${clean}`;
  }
  return true;
}

/** Descarga un archivo y revoca su URL en una tarea posterior al inicio de la descarga. */
export function downloadFileWithObjectUrl({
  file,
  filename,
  createObjectURL,
  revokeObjectURL,
  createAnchor,
  schedule = (callback) => setTimeout(callback, 0),
}) {
  const url = createObjectURL(file);
  try {
    const link = createAnchor();
    link.href = url;
    link.download = filename;
    link.click();
    link.remove?.();
  } finally {
    schedule(() => revokeObjectURL(url), 0);
  }
  return url;
}

/**
 * Comparte archivo + texto cuando el navegador acepta archivos. Si no, descarga el PNG
 * y copia el texto. Las operaciones se inyectan para conservar determinismo en pruebas.
 */
export async function performShare({ payload, file = null, filename = file?.name, canShare, share, download, copy }) {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  if (file && typeof share === 'function') {
    let supportsFiles = false;
    try {
      supportsFiles = typeof canShare === 'function' && canShare({ files: [file] }) === true;
    } catch {
      supportsFiles = false;
    }
    if (supportsFiles) {
      try {
        await share({ ...payload, files: [file] });
        return { status: 'shared' };
      } catch (error) {
        if (error?.name === 'AbortError') return { status: 'cancelled' };
      }
    }
  } else if (!file && typeof share === 'function') {
    try {
      await share(payload);
      return { status: 'shared-text' };
    } catch (error) {
      if (error?.name === 'AbortError') return { status: 'cancelled' };
    }
  }

  let downloaded = false;
  let downloadError;
  if (file && typeof download === 'function') {
    try {
      await download(file, filename);
      downloaded = true;
    } catch (error) {
      downloadError = error;
    }
  }

  if (text && typeof copy === 'function') {
    try {
      await copy(text);
      return { status: downloaded ? 'downloaded-copied' : 'copied', downloaded };
    } catch (error) {
      return { status: downloaded ? 'downloaded-manual' : 'manual', error, downloaded };
    }
  }

  if (downloaded) return { status: 'downloaded-manual', downloaded: true };
  if (file && downloadError) return { status: 'manual', error: downloadError, downloaded: false };
  return { status: 'manual', downloaded: false };
}

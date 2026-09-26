// ui-interactions.js — interacciones pequeñas y testeables sin depender del DOM global.
'use strict';

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

/** Aplica una selección del directorio, cierra, devuelve foco y anuncia el resultado. */
export function applySelectedCustomer({ name, input, dialog, status }) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return false;
  input.value = clean;
  dialog?.close?.();
  input.focus?.();
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

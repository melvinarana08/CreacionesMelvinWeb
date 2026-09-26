// ui-interactions.js — interacciones pequeñas y testeables sin depender del DOM global.
'use strict';

/** Actualiza los chips existentes sin crear, eliminar ni reemplazar controles. */
export function updateSizeChipSelection(chips, selectedChip) {
  for (const chip of chips) {
    const selected = chip === selectedChip;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  }
}

/**
 * Intenta compartir y usa copia como respaldo.
 * @returns {Promise<{status:'shared'|'cancelled'|'copied'|'unavailable'|'failed', error?:unknown}>}
 */
export async function performShare({ payload, share, copy }) {
  if (typeof share === 'function') {
    try {
      await share(payload);
      return { status: 'shared' };
    } catch (error) {
      if (error?.name === 'AbortError') return { status: 'cancelled' };
    }
  }

  if (typeof copy !== 'function') return { status: 'unavailable' };
  try {
    await copy(payload.text);
    return { status: 'copied' };
  } catch (error) {
    return { status: 'failed', error };
  }
}

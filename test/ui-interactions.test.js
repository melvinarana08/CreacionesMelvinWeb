import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySelectedCustomer,
  clampQuantity,
  downloadFileWithObjectUrl,
  filterCustomerSuggestions,
  performShare,
  shouldDismissCustomerSuggestions,
  shouldShowCustomerSuggestions,
  updateQuantityControls,
  updateSizeChipSelection,
} from '../public/ui-interactions.js';

function fakeChip(name, quantity) {
  const classes = new Set(['btn']);
  const attributes = new Map([['aria-pressed', 'false']]);
  return {
    name,
    dataset: quantity == null ? {} : { quantity: String(quantity) },
    focused: false,
    disabled: false,
    classList: {
      toggle(className, enabled) { if (enabled) classes.add(className); else classes.delete(className); },
      contains(className) { return classes.has(className); },
    },
    setAttribute(attribute, value) { attributes.set(attribute, value); },
    getAttribute(attribute) { return attributes.get(attribute); },
  };
}

test('entrada manual y vista previa contigua tienen etiquetas y anuncio accesible', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="manualLineToggle"[^>]*type="checkbox"/);
  assert.match(html, /for="manualSizeInput"/);
  assert.match(html, /for="manualPriceInput"/);
  assert.match(html, /class="picker-add-row">\s*<span id="addLinePreview"[^>]*aria-live="polite"[^>]*>[^<]*<\/span>\s*<button[^>]*id="addLineBtn"/);
});

test('updateSizeChipSelection conserva objetos y foco mientras actualiza estado accesible', () => {
  const first = fakeChip('4');
  const selected = fakeChip('6');
  const last = fakeChip('8');
  selected.focused = true;
  const chips = [first, selected, last];
  const identities = [...chips];
  updateSizeChipSelection(chips, selected);
  chips.forEach((chip, index) => assert.equal(chip, identities[index]));
  assert.equal(selected.focused, true);
  assert.equal(selected.classList.contains('selected'), true);
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  assert.equal(first.getAttribute('aria-pressed'), 'false');
});

test('cantidad se limita a 1–99 y actualiza límites y presets exactos', () => {
  assert.equal(clampQuantity(-3), 1);
  assert.equal(clampQuantity(100), 99);
  assert.equal(clampQuantity(4.6), 5);
  const valueNode = {};
  const minusButton = fakeChip('minus');
  const plusButton = fakeChip('plus');
  const presets = [3, 6, 9, 12].map((value) => fakeChip(String(value), value));
  assert.equal(updateQuantityControls({ value: 9, valueNode, minusButton, plusButton, presets }), 9);
  assert.equal(valueNode.textContent, '9');
  assert.equal(presets[2].getAttribute('aria-pressed'), 'true');
  assert.equal(presets[1].getAttribute('aria-pressed'), 'false');
  updateQuantityControls({ value: 1, valueNode, minusButton, plusButton, presets });
  assert.equal(minusButton.disabled, true);
  assert.equal(plusButton.disabled, false);
  updateQuantityControls({ value: 99, valueNode, minusButton, plusButton, presets });
  assert.equal(minusButton.disabled, false);
  assert.equal(plusButton.disabled, true);
});

test('selección de cliente cierra, oculta sugerencias, no enfoca el teclado y anuncia el nombre', () => {
  const calls = [];
  const input = { value: '', focus: () => calls.push('focus') };
  const dialog = { close: () => calls.push('close') };
  const suggestions = { hidden: false };
  const status = { hidden: true, textContent: '' };
  assert.equal(applySelectedCustomer({ name: '  María Pérez ', input, dialog, suggestions, status }), true);
  assert.equal(input.value, 'María Pérez');
  assert.equal(suggestions.hidden, true);
  assert.deepEqual(calls, ['close']);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'Cliente elegido: María Pérez');
});

test('sugerencias filtran por subcadena sin distinguir mayúsculas, conservan recencia y limitan a 8', () => {
  const names = ['María reciente', 'Carlos', 'MARÍA segunda', 'Ana', 'Beto', 'Cora', 'Dora', 'Elena', 'Fabi', 'Gabi'];
  assert.deepEqual(filterCustomerSuggestions(names, 'maría'), ['María reciente', 'MARÍA segunda']);
  assert.deepEqual(filterCustomerSuggestions(names, '').slice(0, 2), ['María reciente', 'Carlos']);
  assert.equal(filterCustomerSuggestions(names, '').length, 8);
  assert.deepEqual(filterCustomerSuggestions([' Ana ', 'ana', '', null], ''), ['Ana']);
});

test('saved customer suggestions rank exact, prefix, substring, then bounded typos with recency ties', () => {
  assert.deepEqual(filterCustomerSuggestions(
    ['Prdoro', 'Pedro viejo', 'Don Pedro', 'Pedra', 'Prdro', 'Pedro'], 'Prdro'),
  ['Prdro', 'Prdoro', 'Pedro']);
  assert.deepEqual(filterCustomerSuggestions(
    ['Pedro reciente', 'PEDRO', 'Pedrito', 'Don Pedro', 'Prdro', 'Petro'], 'pedro'),
  ['PEDRO', 'Pedro reciente', 'Don Pedro', 'Prdro', 'Petro']);
  assert.deepEqual(filterCustomerSuggestions(['María', 'Maria', 'Mario'], 'MARIA'), ['María', 'Mario']);
  assert.deepEqual(filterCustomerSuggestions(['Pedro', 'Alba'], 'P'), ['Pedro']);
  assert.deepEqual(filterCustomerSuggestions(['Pedro', 'Pilar'], 'zzzzzz'), []);
  assert.equal(filterCustomerSuggestions(Array(20).fill('Pedro').concat(['Ana']), '', 100).length, 2);
});

test('sugerencias solo se muestran durante interacción y con coincidencias', () => {
  assert.equal(shouldShowCustomerSuggestions({ engaged: true, matches: ['Ana'] }), true);
  assert.equal(shouldShowCustomerSuggestions({ engaged: false, matches: ['Ana'] }), false);
  assert.equal(shouldShowCustomerSuggestions({ engaged: true, matches: [] }), false);
});

test('Escape, puntero exterior y salida de foco cierran sin tragarse selección táctil', () => {
  const input = {};
  const suggestionButton = {};
  const suggestions = { contains: (node) => node === suggestionButton };
  assert.equal(shouldDismissCustomerSuggestions({ type: 'keydown', key: 'Escape' }), true);
  assert.equal(shouldDismissCustomerSuggestions({ type: 'keydown', key: 'Enter' }), false);
  assert.equal(shouldDismissCustomerSuggestions({ type: 'pointerdown', target: suggestionButton, input, suggestions }), false);
  assert.equal(shouldDismissCustomerSuggestions({ type: 'pointerdown', target: {}, input, suggestions }), true);
  assert.equal(shouldDismissCustomerSuggestions({ type: 'focusout', relatedTarget: suggestionButton, input, suggestions }), false);
  assert.equal(shouldDismissCustomerSuggestions({ type: 'focusout', relatedTarget: {}, input, suggestions }), true);
});

test('descarga con URL temporal y difiere su revocación a una macrotarea', () => {
  const calls = [];
  let scheduled;
  const anchor = {
    click() { calls.push(['click', this.href, this.download]); },
    remove() { calls.push(['remove']); },
  };
  const url = downloadFileWithObjectUrl({
    file: { png: true },
    filename: 'ticket.png',
    createObjectURL: () => { calls.push(['create']); return 'blob:ticket'; },
    revokeObjectURL: (value) => calls.push(['revoke', value]),
    createAnchor: () => anchor,
    schedule: (callback, delay) => { calls.push(['schedule', delay]); scheduled = callback; },
  });
  assert.equal(url, 'blob:ticket');
  assert.deepEqual(calls, [
    ['create'],
    ['click', 'blob:ticket', 'ticket.png'],
    ['remove'],
    ['schedule', 0],
  ]);
  scheduled();
  assert.deepEqual(calls.at(-1), ['revoke', 'blob:ticket']);
});

test('comparte PNG + texto solo cuando canShare acepta el archivo', async () => {
  const calls = [];
  const file = { name: 'ticket.png' };
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Contenido' }, file,
    canShare: ({ files }) => files[0] === file,
    share: async (value) => calls.push(['share', value]),
    download: async () => calls.push(['download']),
    copy: async () => calls.push(['copy']),
  });
  assert.deepEqual(result, { status: 'shared' });
  assert.deepEqual(calls, [['share', { title: 'Ticket', text: 'Contenido', files: [file] }]]);
});

test('si archivos no están soportados descarga PNG y copia texto', async () => {
  const calls = [];
  const file = { name: 'ticket.png' };
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Texto compañero' }, file,
    canShare: () => false,
    share: async () => calls.push(['share']),
    download: async (value, name) => calls.push(['download', value, name]),
    copy: async (text) => calls.push(['copy', text]),
  });
  assert.deepEqual(result, { status: 'downloaded-copied', downloaded: true });
  assert.deepEqual(calls, [['download', file, 'ticket.png'], ['copy', 'Texto compañero']]);
});

test('fallo nativo no cancelado activa descarga y copia', async () => {
  const calls = [];
  const file = { name: 'ticket.png' };
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Texto' }, file,
    canShare: () => true,
    share: async () => { throw new Error('falló'); },
    download: async () => calls.push('download'),
    copy: async () => calls.push('copy'),
  });
  assert.equal(result.status, 'downloaded-copied');
  assert.deepEqual(calls, ['download', 'copy']);
});

test('AbortError no descarga, copia ni solicita respaldo', async () => {
  const calls = [];
  const abort = new Error('cancelado');
  abort.name = 'AbortError';
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Contenido' }, file: { name: 'ticket.png' },
    canShare: () => true,
    share: async () => { throw abort; },
    download: async () => calls.push('download'),
    copy: async () => calls.push('copy'),
  });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(calls, []);
});

test('descarga queda útil aunque no exista portapapeles y el prompt lo maneja la UI', async () => {
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Texto' }, file: { name: 'ticket.png' },
    canShare: null, share: null, download: async () => {}, copy: null,
  });
  assert.deepEqual(result, { status: 'downloaded-manual', downloaded: true });
});

test('si descarga y portapapeles fallan conserva el respaldo manual', async () => {
  const copyError = new Error('portapapeles bloqueado');
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Texto manual' },
    file: { name: 'ticket.png' },
    canShare: () => false,
    share: async () => {},
    download: async () => { throw new Error('descarga bloqueada'); },
    copy: async () => { throw copyError; },
  });
  assert.equal(result.status, 'manual');
  assert.equal(result.downloaded, false);
  assert.equal(result.error, copyError);
});

test('sin PNG conserva compartir texto y respaldo manual', async () => {
  const shared = await performShare({
    payload: { title: 'Ticket', text: 'Texto' }, file: null,
    share: async () => {}, copy: null,
  });
  assert.deepEqual(shared, { status: 'shared-text' });

  const copied = [];
  const fallback = await performShare({
    payload: { title: 'Ticket', text: 'Texto' }, file: null,
    share: null, copy: async (value) => copied.push(value),
  });
  assert.deepEqual(fallback, { status: 'copied', downloaded: false });
  assert.deepEqual(copied, ['Texto']);

  const manual = await performShare({ payload: { title: 'Ticket', text: 'Texto' }, file: null, share: null, copy: null });
  assert.deepEqual(manual, { status: 'manual', downloaded: false });
});

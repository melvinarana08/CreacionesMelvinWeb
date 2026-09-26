import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performShare, updateSizeChipSelection } from '../public/ui-interactions.js';

function fakeChip(name) {
  const classes = new Set(['btn']);
  const attributes = new Map([['aria-pressed', 'false']]);
  return {
    name,
    focused: false,
    classList: {
      toggle(className, enabled) {
        if (enabled) classes.add(className);
        else classes.delete(className);
      },
      contains(className) { return classes.has(className); },
    },
    setAttribute(attribute, value) { attributes.set(attribute, value); },
    getAttribute(attribute) { return attributes.get(attribute); },
  };
}

test('updateSizeChipSelection conserva objetos y foco mientras actualiza estado accesible', () => {
  const first = fakeChip('4');
  const selected = fakeChip('6');
  const last = fakeChip('8');
  selected.focused = true;
  const chips = [first, selected, last];
  const identities = [...chips];

  updateSizeChipSelection(chips, selected);

  assert.equal(chips.length, identities.length);
  chips.forEach((chip, index) => assert.equal(chip, identities[index]));
  assert.equal(selected.focused, true);
  assert.equal(selected.classList.contains('selected'), true);
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  for (const chip of [first, last]) {
    assert.equal(chip.classList.contains('selected'), false);
    assert.equal(chip.getAttribute('aria-pressed'), 'false');
  }
});

test('performShare completa mediante Web Share sin copiar', async () => {
  const calls = [];
  const payload = { title: 'Ticket', text: 'Contenido' };
  const result = await performShare({
    payload,
    share: async (value) => { calls.push(['share', value]); },
    copy: async (value) => { calls.push(['copy', value]); },
  });
  assert.deepEqual(result, { status: 'shared' });
  assert.deepEqual(calls, [['share', payload]]);
});

test('performShare trata AbortError como cancelación sin copiar', async () => {
  let copies = 0;
  const abort = new Error('cancelado');
  abort.name = 'AbortError';
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Contenido' },
    share: async () => { throw abort; },
    copy: async () => { copies += 1; },
  });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(copies, 0);
});

test('performShare copia el mismo texto cuando Web Share falla', async () => {
  const copied = [];
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Contenido exacto' },
    share: async () => { throw new Error('share no disponible'); },
    copy: async (text) => { copied.push(text); },
  });
  assert.deepEqual(result, { status: 'copied' });
  assert.deepEqual(copied, ['Contenido exacto']);
});

test('performShare usa copia directamente cuando Web Share no existe', async () => {
  const copied = [];
  const result = await performShare({
    payload: { title: 'Ticket', text: 'Solo copia' },
    share: null,
    copy: async (text) => { copied.push(text); },
  });
  assert.deepEqual(result, { status: 'copied' });
  assert.deepEqual(copied, ['Solo copia']);
});

test('performShare informa indisponibilidad o fallo final de copia', async () => {
  const unavailable = await performShare({
    payload: { title: 'Ticket', text: 'Sin APIs' },
    share: null,
    copy: null,
  });
  assert.deepEqual(unavailable, { status: 'unavailable' });

  const copyError = new Error('permiso denegado');
  const failed = await performShare({
    payload: { title: 'Ticket', text: 'No copiado' },
    share: null,
    copy: async () => { throw copyError; },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, copyError);
});

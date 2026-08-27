import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../public/api.js';

test('apiFetch envía explícitamente las credenciales same-origin para la sesión admin', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let captured;
  globalThis.fetch = async (path, options) => {
    captured = { path, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await apiFetch('/api/admin/session');
  assert.equal(result.ok, true);
  assert.equal(captured.path, '/api/admin/session');
  assert.equal(captured.options.credentials, 'same-origin');
});
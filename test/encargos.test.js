import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { loadSeed } from '../server/catalog.js';
import {
  replaceCatalog,
  upsertClient,
  listClients,
  createEncargo,
  getEncargo,
  listEncargos,
  deliverEncargo,
  cancelEncargo,
  createSale,
} from '../server/store.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'productos.json');

function freshDb() {
  const db = openDb(':memory:');
  replaceCatalog(db, loadSeed(SEED));
  return db;
}

test('upsertClient y listClients gestionan el directorio sin duplicados', async () => {
  const db = freshDb();
  upsertClient(db, '  Doña Juana  ');
  await new Promise((r) => setTimeout(r, 15));
  upsertClient(db, 'Don Pedro');
  await new Promise((r) => setTimeout(r, 15));
  // Reingreso con diferente capitalización o espacios
  upsertClient(db, 'doña juana');

  const clients = listClients(db);
  assert.equal(clients.length, 2);
  // El último usado (Doña Juana) queda primero
  assert.equal(clients[0], 'Doña Juana');
  assert.equal(clients[1], 'Don Pedro');
  db.close();
});

test('createEncargo valida campos requeridos y asigna folios secuenciales', () => {
  const db = freshDb();
  const e1 = createEncargo(db, {
    clientName: 'Doña Rosa',
    notes: 'Para el jueves',
    items: [
      { productName: 'Short', size: 10, quantity: 2, unitPriceCents: 650 },
      { productName: 'Camisas', size: 'M', quantity: 1, unitPriceCents: 500 },
    ],
    totalCents: 1800,
  });

  assert.equal(e1.folio, 1);
  assert.equal(e1.status, 'pending');
  assert.equal(e1.clientName, 'Doña Rosa');
  assert.equal(e1.notes, 'Para el jueves');
  assert.equal(e1.items.length, 2);
  assert.equal(e1.totalCents, 1800);

  const e2 = createEncargo(db, {
    clientName: 'Don Carlos',
    items: [
      { productName: 'Pantalón', size: 32, quantity: 1, unitPriceCents: 800 },
    ],
    totalCents: 800,
  });
  assert.equal(e2.folio, 2);

  // Cliente queda registrado en el directorio automáticamente
  const clients = listClients(db);
  assert.ok(clients.includes('Doña Rosa'));
  assert.ok(clients.includes('Don Carlos'));

  db.close();
});

test('listEncargos filtra correctamente por estado pending, delivered y cancelled', () => {
  const db = freshDb();
  const e1 = createEncargo(db, {
    clientName: 'Cliente A',
    items: [{ productName: 'Short', size: 10, quantity: 1, unitPriceCents: 650 }],
  });
  const e2 = createEncargo(db, {
    clientName: 'Cliente B',
    items: [{ productName: 'Short', size: 12, quantity: 1, unitPriceCents: 650 }],
  });
  const e3 = createEncargo(db, {
    clientName: 'Cliente C',
    items: [{ productName: 'Short', size: 14, quantity: 1, unitPriceCents: 650 }],
  });

  deliverEncargo(db, e2.id);
  cancelEncargo(db, e3.id);

  const pending = listEncargos(db, 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, e1.id);

  const delivered = listEncargos(db, 'delivered');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, e2.id);
  assert.ok(delivered[0].deliveredAt);

  const cancelled = listEncargos(db, 'cancelled');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].id, e3.id);

  const all = listEncargos(db, 'all');
  assert.equal(all.length, 3);

  db.close();
});

test('deliverEncargo puede vincular el folio de venta al completarse de manera idempotente', () => {
  const db = freshDb();
  const enc = createEncargo(db, {
    clientName: 'Doña Teresa',
    items: [{ productName: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
    totalCents: 1300,
  });

  // Simulamos la venta completada
  const sale = createSale(
    db,
    {
      id: '00000000-0000-4000-8000-000000000001',
      deviceId: 'dev-1',
      clientName: 'Doña Teresa',
      lines: [{ product: 'Short', size: 10, quantity: 2, unitPriceCents: 650 }],
      discountCents: 0,
      clientTs: new Date().toISOString(),
    },
    loadSeed(SEED)
  );

  const updated = deliverEncargo(db, enc.id, sale.id);
  assert.equal(updated.status, 'delivered');
  assert.equal(updated.saleId, sale.id);
  assert.ok(updated.deliveredAt);

  const fetched = getEncargo(db, enc.id);
  assert.equal(fetched.status, 'delivered');
  assert.equal(fetched.saleId, sale.id);

  // Re-entrega idempotente devuelve el mismo encargo sin error
  const redeliver = deliverEncargo(db, enc.id, sale.id);
  assert.equal(redeliver.status, 'delivered');
  assert.equal(redeliver.id, enc.id);

  db.close();
});

test('HTTP API: endpoints de clientes y encargos', async () => {
  const db = freshDb();
  const pwdHash = await hashPassword('Admin1234!');
  const handler = createApp({ db, adminPasswordHash: pwdHash, sessionTtlMs: 3600000 });
  const server = http.createServer(handler);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1) Crear cliente
    const postC = await fetch(`${baseUrl}/api/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Don Manuel' }),
    });
    assert.equal(postC.status, 201);
    const postCData = await postC.json();
    assert.equal(postCData.name, 'Don Manuel');

    // 2) Listar clientes
    const getC = await fetch(`${baseUrl}/api/clients`);
    assert.equal(getC.status, 200);
    const getCData = await getC.json();
    assert.ok(getCData.clients.includes('Don Manuel'));

    // 3) Crear encargo
    const postE = await fetch(`${baseUrl}/api/encargos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'Don Manuel',
        notes: 'Entregar en el puesto',
        items: [{ productName: 'Short', size: 10, quantity: 3, unitPriceCents: 650 }],
        totalCents: 1950,
      }),
    });
    assert.equal(postE.status, 201);
    const postEData = await postE.json();
    assert.equal(postEData.encargo.folio, 1);
    assert.equal(postEData.encargo.clientName, 'Don Manuel');

    const encargoId = postEData.encargo.id;

    // 4) Listar encargos pendientes
    const getE = await fetch(`${baseUrl}/api/encargos?status=pending`);
    assert.equal(getE.status, 200);
    const getEData = await getE.json();
    assert.equal(getEData.encargos.length, 1);
    assert.equal(getEData.encargos[0].id, encargoId);

    // 5) Marcar como entregado
    const deliverRes = await fetch(`${baseUrl}/api/encargos/${encargoId}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId: null }),
    });
    assert.equal(deliverRes.status, 200);
    const deliverData = await deliverRes.json();
    assert.equal(deliverData.encargo.status, 'delivered');

    // Ahora pending debe estar vacío
    const getEAfter = await fetch(`${baseUrl}/api/encargos?status=pending`);
    const getEAfterData = await getEAfter.json();
    assert.equal(getEAfterData.encargos.length, 0);

  } finally {
    server.close();
    db.close();
  }
});

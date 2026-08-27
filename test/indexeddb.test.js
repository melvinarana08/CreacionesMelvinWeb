import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const records = [
  { id: '1', status: 'pending' },
  { id: '2', status: 'synced' },
  { id: '3', status: 'pending' },
];

function asyncIndexedDbFake(rows) {
  return {
    open() {
      const openRequest = {};
      const db = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
          const transaction = {};
          const store = {
            getAll() {
              let ready = false;
              const request = {};
              Object.defineProperty(request, 'result', {
                get() {
                  if (!ready) throw new DOMException('The request has not finished.', 'InvalidStateError');
                  return structuredClone(rows);
                },
              });
              queueMicrotask(() => {
                ready = true;
                request.onsuccess?.();
                queueMicrotask(() => transaction.oncomplete?.());
              });
              return request;
            },
          };
          transaction.objectStore = () => store;
          return transaction;
        },
      };
      queueMicrotask(() => {
        openRequest.result = db;
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  };
}

globalThis.indexedDB = asyncIndexedDbFake(records);
const S = await import('../public/storage.js');

beforeEach(() => {
  globalThis.indexedDB = asyncIndexedDbFake(records);
});

test('listPendingSales espera a que getAll termine antes de leer result', async () => {
  assert.deepEqual(await S.listPendingSales(), records);
});

test('countPending espera la lectura IndexedDB y cuenta solo pendientes', async () => {
  assert.equal(await S.countPending(), 2);
});

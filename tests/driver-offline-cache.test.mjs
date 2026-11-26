// SW-095: copia local de "Hoy" por usuario.
import assert from 'node:assert/strict';
import { createDriverCache } from '../shared/driver-offline-cache.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, m }; };
const asyncMem = () => { const s = mem(); return { getItem: async (k) => s.getItem(k), setItem: async (k, v) => s.setItem(k, v), removeItem: async (k) => s.removeItem(k) }; };
const snap = { driver: { id: 'd1' }, unit: 'C-01', runs: [{ id: 'run1', routeName: 'Ruta Centro' }] };

for (const storage of [mem(), asyncMem()]) {
  const cache = createDriverCache({ storage, now: () => new Date('2026-10-17T11:42:00Z') });
  assert.equal(await cache.load('u1'), null);
  await cache.save('u1', snap);
  const got = await cache.load('u1');
  assert.deepEqual(got.snapshot, snap);
  assert.equal(got.savedAt, '2026-10-17T11:42:00.000Z');
  assert.equal(await cache.load('otro'), null, 'copia de otra cuenta: no se muestra');
  await cache.clear();
  assert.equal(await cache.load('u1'), null);
}

const bad = mem(); bad.setItem('smartwaste.driver-cache.v1', '{no es json');
assert.equal(await createDriverCache({ storage: bad }).load('u1'), null, 'JSON dañado');

const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('lleno'); } };
const c2 = createDriverCache({ storage: throwing });
await c2.save('u1', snap); // no lanza
assert.equal(await c2.load('u1'), null);
console.log('driver-offline-cache: ok');

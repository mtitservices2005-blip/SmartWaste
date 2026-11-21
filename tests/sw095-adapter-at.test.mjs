// SW-095: las transiciones aceptan la hora real (opts.at) y la corrida exacta (opts.runId).
import assert from 'node:assert/strict';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';

function fakeClient(runs) {
  const updates = [];
  const from = (table) => {
    const filters = []; let patch = null; let id = null;
    const rows = () => (table === 'route_runs' ? runs : []).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (k, v) => { filters.push((r) => r[k] === v); if (k === 'id') id = v; return b; },
      neq: (k, v) => { filters.push((r) => r[k] !== v); return b; },
      not: () => b, order: () => b, limit: () => b, range: () => b,
      update: (p) => { patch = p; return b; },
      maybeSingle: async () => ({ data: [...rows()].sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))[0] ?? null, error: null }),
      single: async () => { if (patch) { const row = runs.find((r) => r.id === id); Object.assign(row, patch); updates.push({ id, ...patch }); return { data: row, error: null }; } return { data: rows()[0], error: null }; },
      then: (resolve) => resolve({ data: [], error: null })
    };
    return b;
  };
  return { from, updates };
}

// start con hora real
let runs = [{ id: 'run1', route_id: 'r1', vehicle_id: null, status: 'assigned', created_at: '2026-10-17T08:00:00Z' }];
let client = fakeClient(runs);
let adapter = createSupabaseOperationsAdapter(client);
let res = await adapter.startRoute('r1', { at: '2026-10-17T09:00:00.000Z', runId: 'run1' });
assert.equal(res.ok, true, JSON.stringify(res.error));
assert.equal(client.updates[0].started_at, '2026-10-17T09:00:00.000Z');

// complete con hora real
res = await adapter.completeRoute('r1', { at: '2026-10-17T10:00:00.000Z', runId: 'run1' });
assert.equal(res.ok, true, JSON.stringify(res.error));
assert.equal(client.updates[1].completed_at, '2026-10-17T10:00:00.000Z');

// corrida exacta: run1 ya completada, run2 (la siguiente, SW-086) NO debe completarse
runs = [
  { id: 'run1', route_id: 'r1', vehicle_id: null, status: 'completed', created_at: '2026-10-17T08:00:00Z', started_at: '2026-10-17T09:00:00.000Z', completed_at: '2026-10-17T10:00:00.000Z' },
  { id: 'run2', route_id: 'r1', vehicle_id: null, status: 'assigned', created_at: '2026-10-17T10:00:01Z' }
];
client = fakeClient(runs);
adapter = createSupabaseOperationsAdapter(client);
res = await adapter.completeRoute('r1', { runId: 'run1' });
assert.equal(res.ok, false);
assert.equal(res.error.code, 'INVALID_ROUTE_TRANSITION');
assert.equal(client.updates.length, 0);
assert.equal(runs[1].status, 'assigned', 'la siguiente corrida no se toca');

// sin runId, igual que antes (la más reciente)
res = await adapter.startRoute('r1');
assert.equal(res.ok, true);
assert.equal(client.updates[0].id, 'run2');
// hora del teléfono anterior al inicio ya guardado: completed_at no baja de started_at (restricción de la base)
runs = [{ id: 'run3', route_id: 'r3', vehicle_id: null, status: 'started', created_at: '2026-10-17T08:00:00Z', started_at: '2026-10-17T09:00:00.000Z' }];
client = fakeClient(runs);
adapter = createSupabaseOperationsAdapter(client);
res = await adapter.completeRoute('r3', { at: '2026-10-17T08:30:00.000Z', runId: 'run3' });
assert.equal(res.ok, true, JSON.stringify(res.error));
assert.equal(client.updates[0].completed_at, '2026-10-17T09:00:00.000Z');
console.log('sw095-adapter-at: ok');

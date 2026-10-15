// SW-086: al completar una corrida el sistema deja lista la siguiente (estado assigned).
// Verificar una ruta debe actuar sobre la corrida TERMINADA, no sobre la siguiente que quedó en espera.
import assert from 'node:assert/strict';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';

// Cliente falso: guarda las corridas y aplica .eq/.not/.order/.limit como lo haría PostgREST.
function fakeClient(rows) {
  const state = { rows, updated: null };
  const from = (table) => {
    assert.equal(table, 'route_runs');
    const filters = []; let order = null; let limit = null; let patch = null; let id = null;
    const run = () => {
      let out = state.rows.filter((r) => filters.every((f) => f(r)));
      if (order) out = out.slice().sort((a, b) => (a[order] < b[order] ? 1 : -1));
      if (limit != null) out = out.slice(0, limit);
      return out;
    };
    const b = {
      select: () => b,
      eq: (k, v) => { filters.push((r) => r[k] === v); if (k === 'id') id = v; return b; },
      not: () => b,
      order: (k) => { order = k; return b; },
      limit: (n) => { limit = n; return b; },
      update: (p) => { patch = p; return b; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => { if (patch) { const row = state.rows.find((r) => r.id === id); Object.assign(row, patch); state.updated = row; return { data: row, error: null }; } return { data: run()[0], error: null }; }
    };
    return b;
  };
  return Object.assign({ from }, { state });
}

const rows = [
  { id: 'run-1', route_id: 'r1', status: 'completed', created_at: '2026-10-14T10:00:00Z', started_at: '2026-10-14T10:05:00Z', completed_at: '2026-10-14T11:00:00Z' },
  { id: 'run-2', route_id: 'r1', status: 'assigned', created_at: '2026-10-14T11:00:00Z' }
];
const client = fakeClient(rows);
const adapter = createSupabaseOperationsAdapter(client);
const verified = await adapter.verifyRoute('r1');
assert.equal(verified.ok, true, JSON.stringify(verified.error));
assert.equal(client.state.updated.id, 'run-1', 'se verifica la corrida terminada');
assert.equal(rows[1].status, 'assigned', 'la corrida siguiente queda intacta');
console.log('route-verify-after-repeat ok');

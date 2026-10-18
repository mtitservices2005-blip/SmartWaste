// SW-099: una corrida con más de 1000 puntos GPS guarda la distancia completa (antes: 4043 puntos → solo 1000 medidos)
// y el trazo de Métricas no se corta. El cliente falso imita el tope de 1000 filas de Supabase.
import assert from 'node:assert/strict';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';

const T0 = Date.parse('2026-10-17T22:18:00Z');
const N = 2500;
// Camión que avanza ~11 m cada 10 s (≈4 km/h) con buena precisión.
const positions = Array.from({ length: N }, (_, i) => ({ id: `p${String(i).padStart(5, '0')}`, latitude: 19.6 + i * 0.0001, longitude: -71.0, accuracy: 2.5, captured_at: new Date(T0 + i * 10_000).toISOString(), source: 'driver_app', route_run_id: 'run-1', vehicle_id: 'veh-1' }));
const SERVER_CAP = 1000;

function fakeClient(runs, vehiclePositions) {
  const updates = [];
  const from = (table) => {
    const filters = []; let patch = null; let id = null; let range = null;
    const rows = () => (table === 'route_runs' ? runs : vehiclePositions).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (k, v) => { filters.push((r) => r[k] === v); if (k === 'id') id = v; return b; },
      neq: (k, v) => { filters.push((r) => r[k] !== v); return b; },
      gte: (k, v) => { filters.push((r) => r[k] >= v); return b; },
      lte: (k, v) => { filters.push((r) => r[k] <= v); return b; },
      not: () => b, order: () => b, limit: () => b,
      range: (a, z) => { range = [a, z]; return b; },
      update: (p) => { patch = p; return b; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => { if (patch) { const row = runs.find((r) => r.id === id); Object.assign(row, patch); updates.push(patch); return { data: row, error: null }; } return { data: rows()[0], error: null }; },
      then: (resolve) => {
        const all = rows().map((r) => ({ ...r }));
        const [a, z] = range ?? [0, all.length];
        resolve({ data: all.slice(a, Math.min(z + 1, a + SERVER_CAP)), error: null });
      }
    };
    return b;
  };
  return { from, updates };
}

const run = { id: 'run-1', route_id: 'r1', vehicle_id: 'veh-1', status: 'started', created_at: '2026-10-17T22:17:00Z', started_at: new Date(T0).toISOString() };
const client = fakeClient([run], positions);
const adapter = createSupabaseOperationsAdapter(client);

const done = await adapter.completeRoute('r1', { runId: undefined });
assert.equal(done.ok, true, JSON.stringify(done.error));
const patch = client.updates[0];
assert.equal(patch.gps_points_count, N, 'cuenta todos los puntos, no solo los primeros 1000');
assert.ok(patch.distance_meters > 27_000 && patch.distance_meters < 28_500, `distancia ${patch.distance_meters} m (≈27,8 km esperados)`);
assert.equal(patch.gps_ended_at, positions[N - 1].captured_at);

const track = await adapter.listRunTrack({ ...run, status: 'completed', completed_at: new Date(T0 + N * 10_000).toISOString() });
assert.equal(track.ok, true);
assert.equal(track.data.length, N, 'el trazo trae todos los puntos');
console.log('sw099-adapter-pagination ok');

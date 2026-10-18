// SW-096: al terminar la ruta la distancia ignora puntos de mala precisión y saltos; el trazo de Métricas también.
import assert from 'node:assert/strict';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';

const T0 = Date.parse('2026-10-17T13:50:00Z');
const pos = (sec, dLat, accuracy = 2.1) => ({ latitude: 19.6 + dLat, longitude: -71.0, captured_at: new Date(T0 + sec * 1000).toISOString(), accuracy, source: 'driver_app', route_run_id: 'run-1', vehicle_id: 'veh-1' });
// ~33 m caminando + un punto de 404,9 m de precisión a ~440 m.
const positions = [pos(0, 0), pos(10, 0.0001), pos(15, 0.0040, 404.9), pos(20, 0.0002), pos(30, 0.0003)];

function fakeClient(runs, vehiclePositions) {
  const updates = [];
  const from = (table) => {
    const filters = []; let patch = null; let id = null; let columns = '*'; let range = null;
    const rows = () => (table === 'route_runs' ? runs : vehiclePositions).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: (c) => { if (c) columns = c; return b; },
      eq: (k, v) => { filters.push((r) => r[k] === v); if (k === 'id') id = v; return b; },
      neq: (k, v) => { filters.push((r) => r[k] !== v); return b; },
      gte: (k, v) => { filters.push((r) => r[k] >= v); return b; },
      lte: (k, v) => { filters.push((r) => r[k] <= v); return b; },
      not: () => b, order: () => b, limit: () => b,
      range: (a, z) => { range = [a, z]; return b; }, // SW-099
      update: (p) => { patch = p; return b; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => { if (patch) { const row = runs.find((r) => r.id === id); Object.assign(row, patch); updates.push(patch); return { data: row, error: null }; } return { data: rows()[0], error: null }; },
      then: (resolve) => { const all = rows().map((r) => ({ ...r })); resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, error: null }); }
    };
    b.columns = () => columns;
    return b;
  };
  return { from, updates };
}

const run = { id: 'run-1', route_id: 'r1', vehicle_id: 'veh-1', status: 'started', created_at: '2026-10-17T13:49:00Z', started_at: new Date(T0).toISOString() };
const client = fakeClient([run], positions);
const adapter = createSupabaseOperationsAdapter(client);

const done = await adapter.completeRoute('r1', { runId: undefined });
assert.equal(done.ok, true, JSON.stringify(done.error));
const patch = client.updates[0];
assert.ok(patch.distance_meters >= 30 && patch.distance_meters <= 36, `distancia ${patch.distance_meters} m (el punto de 405 m no debe sumar)`);
assert.equal(patch.gps_points_count, 5, 'se conserva el total de puntos guardados');
assert.equal(patch.gps_started_at, positions[0].captured_at);
assert.equal(patch.gps_ended_at, positions[4].captured_at);

// Trazo de Métricas: sin el punto malo.
const track = await adapter.listRunTrack({ ...run, status: 'completed', completed_at: new Date(T0 + 60_000).toISOString() });
assert.equal(track.ok, true);
assert.equal(track.data.length, 4);
assert.equal(track.data.some((p) => Number(p.accuracy) === 404.9), false);
console.log('sw096-adapter-quality: ok');

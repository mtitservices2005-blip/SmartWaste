// SW-085: lectura de lo que el chofer ve hoy (ficha, camión, corridas, rutas y paradas) con un cliente falso.
// Si la columna scheduled_start_at aún no existe en la base (migración sin aplicar), la app sigue funcionando sin horas.
import assert from 'node:assert/strict';
import { loadDriverToday, findDriverRow } from '../shared/driver-data.js';

function fakeClient(tables, { missingColumn = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, filters: [], cols: '' };
      const api = {
        select(cols) { q.cols = cols; return api; },
        eq(k, v) { q.filters.push(['eq', k, v]); return api; },
        in(k, v) { q.filters.push(['in', k, v]); return api; },
        ilike(k, v) { q.filters.push(['ilike', k, v]); return api; },
        order() { return api; }, limit() { return api; },
        maybeSingle() { return Promise.resolve(run(true)); },
        then(res, rej) { return Promise.resolve(run(false)).then(res, rej); }
      };
      function run(single) {
        calls.push({ table, cols: q.cols, filters: q.filters });
        if (missingColumn && table === 'route_runs' && q.cols.includes('scheduled_start_at')) return { data: null, error: { code: '42703', message: 'column route_runs.scheduled_start_at does not exist' } };
        let rows = (tables[table] ?? []).filter((r) => q.filters.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : String(r[k] ?? '').toLowerCase() === String(v).toLowerCase()));
        const keys = q.cols.split(',').map((c) => c.trim());
        rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keys.includes(k))));
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      return api;
    }
  };
}

const tables = {
  drivers: [{ id: 'd1', municipality_id: 'm1', profile_id: 'u1', display_name: 'Carlos Peña', email: 'Carlos@Ejemplo.do', status: 'available' }],
  route_runs: [
    { id: 'run1', route_id: 'r1', vehicle_id: 'v1', driver_id: 'd1', status: 'assigned', scheduled_start_at: '2026-10-14T12:00:00Z', created_at: '2026-10-13T10:00:00Z' },
    { id: 'run2', route_id: 'r2', vehicle_id: 'v1', driver_id: 'd1', status: 'assigned', scheduled_start_at: null, created_at: '2026-10-13T11:00:00Z' },
    { id: 'runX', route_id: 'r1', vehicle_id: 'v9', driver_id: 'otro', status: 'assigned', scheduled_start_at: null, created_at: '2026-10-13T11:00:00Z' }
  ],
  routes: [{ id: 'r1', name: 'Ruta Centro' }, { id: 'r2', name: 'Ruta Playa' }],
  route_stops: [
    { route_id: 'r1', sequence: 1, label: 'A', latitude: 19.0, longitude: -71.0 },
    { route_id: 'r1', sequence: 2, label: 'B', latitude: 19.001, longitude: -71.0 },
    { route_id: 'r1', sequence: 3, label: 'C', latitude: 19.002, longitude: -71.0 },
    { route_id: 'r2', sequence: 1, label: 'P', latitude: null, longitude: null }
  ],
  vehicles: [{ id: 'v1', code: 'C-01', plate: 'L 123456' }]
};
const ctx = { userId: 'u1', municipalityId: 'm1', email: 'carlos@ejemplo.do' };

const out = await loadDriverToday(fakeClient(tables), ctx);
assert.equal(out.ok, true);
assert.equal(out.driver.id, 'd1');
assert.equal(out.unit, 'C-01');
assert.equal(out.runs.length, 2, 'solo las corridas de este chofer');
const r1 = out.runs.find((r) => r.id === 'run1');
assert.equal(r1.routeId, 'r1');
assert.equal(r1.routeName, 'Ruta Centro');
assert.equal(r1.stopsCount, 3);
assert.match(r1.distanceText, /^2\d\d m$/, '≈222 m entre las paradas de la ruta');
assert.equal(r1.scheduledStartAt, '2026-10-14T12:00:00Z');
assert.equal(r1.estimatedMinutes, null, 'no inventa un tiempo estimado');
assert.deepEqual(r1.stops.map((s) => s.label), ['A', 'B', 'C']);
const r2 = out.runs.find((r) => r.id === 'run2');
assert.equal(r2.distanceText, '—', 'sin coordenadas, sin distancia');

// Sin la columna nueva: reintenta sin ella.
const old = await loadDriverToday(fakeClient(tables, { missingColumn: true }), ctx);
assert.equal(old.ok, true);
assert.equal(old.runs.length, 2);
assert.equal(old.runs[0].scheduledStartAt, null);

// Sin ficha: ok pero sin conductor (la regla de acceso decide).
const none = await loadDriverToday(fakeClient({ ...tables, drivers: [] }), ctx);
assert.equal(none.ok, true);
assert.equal(none.driver, null);
assert.deepEqual(none.runs, []);

// Ficha por correo cuando aún no tiene profile_id.
const byMail = await findDriverRow(fakeClient({ ...tables, drivers: [{ ...tables.drivers[0], profile_id: null }] }), ctx);
assert.equal(byMail.id, 'd1');
// Un error real de la base no se disfraza de "sin rutas".
const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }) };
const bad = await loadDriverToday(failing, ctx);
assert.equal(bad.ok, false);
assert.match(bad.message, /boom/);
console.log('driver-data ok');

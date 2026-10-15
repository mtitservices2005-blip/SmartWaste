// SW-086 (CA3, CA10): historial de corridas de una ruta — tiempo y kilómetros medidos de cada vez.
import assert from 'node:assert/strict';
import { buildRouteHistory, formatDuration } from '../shared/route-history.js';

assert.equal(formatDuration(42), '42 min');
assert.equal(formatDuration(60), '1 h 00 min');
assert.equal(formatDuration(65), '1 h 05 min');
assert.equal(formatDuration(0.4), '1 min', 'mínimo 1 minuto si hubo tiempo');
assert.equal(formatDuration(null), '—');
assert.equal(formatDuration(NaN), '—');

const run = (id, o = {}) => ({ id, route_id: 'r1', status: 'completed', driver_id: 'd1', started_at: '2026-10-14T12:00:00Z', completed_at: '2026-10-14T12:42:00Z', distance_meters: 6400, ...o });
const drivers = new Map([['d1', 'Carlos Peña'], ['d2', 'Ana Reyes']]);

const runs = [
  run('a', { started_at: '2026-10-12T12:00:00Z', completed_at: '2026-10-12T12:40:00Z', distance_meters: 6200 }),
  run('b', { started_at: '2026-10-13T12:00:00Z', completed_at: '2026-10-13T12:50:00Z', distance_meters: null, driver_id: 'd2' }),
  run('c'),
  run('otra', { route_id: 'r2' }),
  run('abierta', { status: 'started', completed_at: null }),
  run('sinhora', { started_at: null }),
  run('cancelada', { status: 'cancelled' })
];
const h = buildRouteHistory(runs, 'r1', { driverNames: drivers });
// Más reciente primero; solo corridas completadas con inicio y fin; solo de esa ruta.
assert.deepEqual(h.entries.map((e) => e.id), ['c', 'b', 'a']);
assert.equal(h.entries[0].dateText, '14 oct');
assert.equal(h.entries[0].durationText, '42 min');
assert.equal(h.entries[0].distanceText, '6,4 km');
assert.equal(h.entries[0].driverName, 'Carlos Peña');
assert.equal(h.entries[1].distanceText, '—', 'sin GPS no se inventa el kilometraje');
assert.equal(h.entries[1].driverName, 'Ana Reyes');
assert.equal(h.entries[2].dateText, '12 oct');
// Promedios solo con datos reales: tiempo con las 3, kilómetros con las 2 medidas.
assert.equal(h.count, 3);
assert.equal(h.avgDurationText, '44 min', '(42 + 50 + 40) / 3 = 44');
assert.equal(h.avgDistanceText, '6,3 km', '(6400 + 6200) / 2 = 6300 m');
// Límite de filas, sin cambiar los promedios.
assert.equal(buildRouteHistory(runs, 'r1', { driverNames: drivers, limit: 2 }).entries.length, 2);
assert.equal(buildRouteHistory(runs, 'r1', { driverNames: drivers, limit: 2 }).count, 3);
// Sin corridas.
const empty = buildRouteHistory([], 'r1');
assert.deepEqual(empty, { entries: [], count: 0, avgDurationText: '—', avgDistanceText: '—' });
assert.equal(buildRouteHistory(null, 'r1').count, 0);
// Chofer desconocido.
assert.equal(buildRouteHistory([run('z', { driver_id: 'nadie' })], 'r1').entries[0].driverName, '—');
// Duración imposible (fin antes del inicio) se descarta.
assert.equal(buildRouteHistory([run('mal', { completed_at: '2026-10-14T11:00:00Z' })], 'r1').count, 0);
console.log('route-history ok');

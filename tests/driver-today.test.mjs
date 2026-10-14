// SW-085 (CA2): "Rutas de hoy" del chofer. Fecha local de República Dominicana (America/Santo_Domingo, UTC-4,
// sin horario de verano), orden por hora de inicio y luego por creación, y cuál es la siguiente pendiente.
import assert from 'node:assert/strict';
import { selectTodayRoutes, formatStartTime, localDateKey, formatTodayText } from '../shared/driver-today.js';

// 14 oct 2026, 7:30 a. m. en Santo Domingo = 11:30 UTC.
const now = new Date('2026-10-14T11:30:00Z');

assert.equal(localDateKey(new Date('2026-10-14T03:59:00Z')), '2026-10-13', 'antes de las 4:00 UTC aún es el día anterior');
assert.equal(localDateKey(new Date('2026-10-14T04:00:00Z')), '2026-10-14');

assert.equal(formatStartTime('2026-10-14T12:00:00Z'), '8:00 a. m.');
assert.equal(formatStartTime('2026-10-14T15:00:00Z'), '11:00 a. m.');
assert.equal(formatStartTime('2026-10-14T16:00:00Z'), '12:00 p. m.');
assert.equal(formatStartTime('2026-10-14T18:05:00Z'), '2:05 p. m.');
assert.equal(formatStartTime('2026-10-14T04:00:00Z'), '12:00 a. m.');
assert.equal(formatStartTime(null), null);
assert.equal(formatStartTime('no es fecha'), null);

const run = (id, o = {}) => ({ id, routeName: `Ruta ${id}`, status: 'assigned', scheduledStartAt: null, createdAt: '2026-10-10T10:00:00Z', ...o });

// Orden: por hora; sin hora al final, por creación.
const out = selectTodayRoutes([
  run('playa', { scheduledStartAt: '2026-10-14T18:00:00Z' }),
  run('centro', { scheduledStartAt: '2026-10-14T12:00:00Z' }),
  run('mercado', { scheduledStartAt: '2026-10-14T15:00:00Z' }),
  run('sinhora-b', { createdAt: '2026-10-12T10:00:00Z' }),
  run('sinhora-a', { createdAt: '2026-10-11T10:00:00Z' })
], { now });
assert.deepEqual(out.items.map((r) => r.id), ['centro', 'mercado', 'playa', 'sinhora-a', 'sinhora-b']);
assert.equal(out.nextId, 'centro', 'la primera pendiente es la siguiente');
assert.deepEqual(out.items.map((r) => r.slot), ['siguiente', 'proxima', 'proxima', 'proxima', 'proxima']);
assert.equal(out.items[0].startLabel, '8:00 a. m.');
assert.equal(out.items[3].startLabel, null, 'sin hora no inventa una');

// Otro día no aparece; completadas y canceladas no son pendientes.
const mix = selectTodayRoutes([
  run('ayer', { scheduledStartAt: '2026-10-13T12:00:00Z' }),
  run('manana', { scheduledStartAt: '2026-10-15T12:00:00Z' }),
  run('hecha', { scheduledStartAt: '2026-10-14T11:00:00Z', status: 'completed' }),
  run('cancelada', { scheduledStartAt: '2026-10-14T11:00:00Z', status: 'cancelled' }),
  run('hoy', { scheduledStartAt: '2026-10-14T12:00:00Z' })
], { now });
assert.deepEqual(mix.items.map((r) => r.id), ['hecha', 'hoy'], 'solo hoy; la cancelada no se muestra');
assert.equal(mix.items[0].slot, 'completada');
assert.equal(mix.nextId, 'hoy');

// Una ruta en curso es la activa: no hay "siguiente" y manda a la pantalla En ruta.
const active = selectTodayRoutes([
  run('a', { scheduledStartAt: '2026-10-14T12:00:00Z', status: 'in_progress' }),
  run('b', { scheduledStartAt: '2026-10-14T15:00:00Z' })
], { now });
assert.equal(active.activeId, 'a');
assert.equal(active.nextId, null);
assert.equal(active.items[0].slot, 'en-curso');
assert.equal(active.items[1].slot, 'proxima');
for (const st of ['started', 'delayed']) assert.equal(selectTodayRoutes([run('x', { status: st })], { now }).activeId, 'x');

// Una ruta sin hora y abierta cuenta como de hoy aunque se creara antes.
assert.deepEqual(selectTodayRoutes([run('s')], { now }).items.map((r) => r.id), ['s']);

// Vacío y entradas raras no rompen.
assert.deepEqual(selectTodayRoutes([], { now }), { items: [], nextId: null, activeId: null });
assert.deepEqual(selectTodayRoutes(undefined, { now }), { items: [], nextId: null, activeId: null });
assert.deepEqual(selectTodayRoutes([null, {}], { now }).items, []);
assert.equal(formatTodayText(new Date('2026-10-14T11:30:00Z')), 'Miércoles 14 de octubre');
assert.equal(formatTodayText(new Date('2026-10-14T02:00:00Z')), 'Martes 13 de octubre', 'a las 10 p. m. del martes en RD sigue siendo martes');

// SW-086: la hora y los días vienen de la ruta (la hora propia de la corrida manda si existe).
const wed = now; // miércoles 14 oct 2026 → día 3
const routeTimed = selectTodayRoutes([
  run('tarde', { routeStartTime: '14:30:00' }),
  run('manana', { routeStartTime: '08:00:00' }),
  run('propia', { routeStartTime: '20:00:00', scheduledStartAt: '2026-10-14T12:30:00Z' }),
  run('sinhora')
], { now: wed });
assert.deepEqual(routeTimed.items.map((r) => r.id), ['manana', 'propia', 'tarde', 'sinhora'], 'ordenadas por hora del día');
assert.equal(routeTimed.items[0].startLabel, '8:00 a. m.');
assert.equal(routeTimed.items[1].startLabel, '8:30 a. m.', 'la hora de la corrida gana');
assert.equal(routeTimed.items[2].startLabel, '2:30 p. m.');
assert.equal(routeTimed.items[3].startLabel, null);

const byDay = selectTodayRoutes([
  run('lmv', { routeDays: [1, 3, 5] }),
  run('mj', { routeDays: [2, 4] }),
  run('todos', { routeDays: [] }),
  run('nulo', { routeDays: null }),
  run('mj-en-curso', { routeDays: [2, 4], status: 'in_progress' })
], { now: wed });
assert.deepEqual(byDay.items.map((r) => r.id).sort(), ['lmv', 'mj-en-curso', 'nulo', 'todos'], 'fuera de sus días no se muestra, salvo que ya esté en curso');
console.log('driver-today ok');

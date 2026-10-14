// SW-086 (CA1, CA2): tabla de rutas, filtros y contadores del diseño Mando.
import assert from 'node:assert/strict';
import { routeBucket, stateLabel, buildRouteRows, filterRows, countByFilter, FILTERS, headerText } from '../shared/route-list.js';

const NOW = new Date('2026-10-14T15:00:00Z'); // miércoles 11:00 en Santo Domingo

// Estados → grupo del filtro (CA2).
for (const s of ['started', 'in_progress', 'delayed']) assert.equal(routeBucket({ status: s }), 'activas', s);
for (const s of ['planned', 'assigned']) assert.equal(routeBucket({ status: s }), 'programadas', s);
for (const s of ['completed', 'verified']) assert.equal(routeBucket({ status: s }), 'completas', s);
assert.equal(routeBucket({ status: 'rarísimo' }), 'programadas', 'estado desconocido = programada, nunca se pierde una ruta');
// Una ruta que se repite vuelve a "assigned" tras cada corrida: si se completó hoy, cuenta como completa de hoy.
assert.equal(routeBucket({ status: 'assigned', lastCompletedAt: '2026-10-14T12:00:00Z' }, NOW), 'completas');
assert.equal(routeBucket({ status: 'assigned', lastCompletedAt: '2026-10-13T12:00:00Z' }, NOW), 'programadas', 'ayer no cuenta');
assert.equal(routeBucket({ status: 'started', lastCompletedAt: '2026-10-14T12:00:00Z' }, NOW), 'activas', 'si ya salió otra vez, está activa');

// Etiquetas del diseño.
assert.equal(stateLabel({ status: 'started' }), 'EN CURSO');
assert.equal(stateLabel({ status: 'in_progress' }), 'EN CURSO');
assert.equal(stateLabel({ status: 'delayed' }), 'RETRASADA');
assert.equal(stateLabel({ status: 'assigned' }), 'PROGRAMADA');
assert.equal(stateLabel({ status: 'planned' }), 'PROGRAMADA');
assert.equal(stateLabel({ status: 'completed' }), 'COMPLETA');
assert.equal(stateLabel({ status: 'assigned', lastCompletedAt: '2026-10-14T12:00:00Z' }, NOW), 'COMPLETA');

const items = [
  { id: 'r1', name: 'Centro', status: 'in_progress', unit: 'C-01', driverName: 'Carlos Peña', stopsCount: 12, lengthMeters: 6400, startTime: '08:00:00', days: [1, 3, 5] },
  { id: 'r2', name: 'Norte', status: 'started', unit: 'C-02', driverName: 'Ana Reyes', stopsCount: 10, lengthMeters: 5100 },
  { id: 'r3', name: 'Mercado', status: 'completed', unit: 'C-03', driverName: 'Luis Mejía', stopsCount: 9, lengthMeters: 4200 },
  { id: 'r4', name: 'Barrio Nuevo', status: 'planned', unit: null, driverName: null, stopsCount: 14, lengthMeters: 7800, startTime: '06:30:00', days: [] },
  { id: 'r5', name: 'Playa', status: 'assigned', unit: 'C-04', driverName: 'Pedro Díaz', stopsCount: 8, lengthMeters: 3900, days: [6, 0] }
];
const rows = buildRouteRows(items, NOW);
assert.equal(rows.length, 5);
assert.deepEqual(rows[0], { id: 'r1', name: 'Centro', unit: 'C-01', driverName: 'Carlos Peña', stopsCount: 12, lengthText: '6,4 km', stateKey: 'activas', stateLabel: 'EN CURSO', startText: '8:00 a. m.', daysText: 'L X V' });
assert.equal(rows[3].unit, 'Sin asignar', 'sin camión');
assert.equal(rows[3].driverName, '—', 'sin conductor');
assert.equal(rows[3].startText, '6:30 a. m.');
assert.equal(rows[3].daysText, 'Todos los días');
assert.equal(rows[1].startText, '—', 'sin hora no se inventa');
assert.equal(rows[2].lengthText, '4,2 km');
assert.equal(buildRouteRows([{ id: 'x', name: 'Sin trazo', status: 'planned', stopsCount: 0, lengthMeters: null }], NOW)[0].lengthText, '—');

// Filtros y contadores: Todas = suma de las otras tres.
assert.deepEqual(FILTERS.map((f) => f.key), ['todas', 'activas', 'programadas', 'completas']);
assert.deepEqual(countByFilter(rows), { todas: 5, activas: 2, programadas: 2, completas: 1 });
assert.deepEqual(filterRows(rows, 'activas').map((r) => r.id), ['r1', 'r2']);
assert.deepEqual(filterRows(rows, 'programadas').map((r) => r.id), ['r4', 'r5']);
assert.deepEqual(filterRows(rows, 'completas').map((r) => r.id), ['r3']);
assert.equal(filterRows(rows, 'todas').length, 5);
assert.equal(filterRows(rows, 'desconocido').length, 5, 'filtro inválido muestra todas');
const c = countByFilter(rows);
assert.equal(c.todas, c.activas + c.programadas + c.completas);

// Encabezado: sin "datos de ejemplo" con backend real.
assert.equal(headerText({ count: 5, municipality: 'Laguna Salada', demo: false }), '5 rutas en Laguna Salada');
assert.equal(headerText({ count: 5, municipality: 'Laguna Salada', demo: true }), '5 rutas en Laguna Salada · datos de ejemplo');
assert.equal(headerText({ count: 1, municipality: 'Laguna Salada', demo: false }), '1 ruta en Laguna Salada');
assert.equal(headerText({ count: 0, municipality: 'Laguna Salada', demo: false }), 'Aún no hay rutas en Laguna Salada');
console.log('route-list ok');

// SW-086: pantallas de Rutas (tabla, filtros, historial, formulario de ruta nueva). HTML puro, sin DOM.
import assert from 'node:assert/strict';
import { renderRoutesTable, renderFilterChips, renderDayChips, renderHistory, renderDraftPreview } from '../frontend/components/routes-screens.js';

const rows = [
  { id: 'r1', name: 'Ruta <Norte>', unit: 'SW-LS-01', driverName: 'Carlos Pérez', stopsCount: 12, lengthText: '4,2 km', stateKey: 'activas', stateLabel: 'EN CURSO', startText: '8:00 a. m.', daysText: 'L X V' },
  { id: 'r2', name: 'Centro', unit: 'Sin asignar', driverName: '—', stopsCount: 0, lengthText: '—', stateKey: 'programadas', stateLabel: 'PROGRAMADA', startText: '—', daysText: 'Todos los días' }
];
const table = renderRoutesTable({ rows, selectedId: 'r1' });
assert.match(table, /<table class="sw-routes__table"/);
assert.match(table, /<caption class="sw-visually-hidden">Rutas<\/caption>/);
for (const h of ['Ruta', 'Camión', 'Conductor', 'Paradas', 'Largo', 'Estado']) assert.match(table, new RegExp(`<th scope="col">${h}</th>`));
assert.match(table, /data-route="r1"/);
assert.match(table, /sw-routes__row selected/);
assert.ok(table.includes('Ruta &lt;Norte&gt;') && !table.includes('<Norte>'), 'escapa texto');
assert.match(table, /EN CURSO/);
assert.match(renderRoutesTable({ rows: [] }), /Todavía no hay rutas/);

const chips = renderFilterChips({ filter: 'activas', counts: { todas: 2, activas: 1, programadas: 1, completas: 0 } });
assert.match(chips, /data-route-filter="activas"[^>]*aria-pressed="true"/);
assert.match(chips, /data-route-filter="todas"[^>]*aria-pressed="false"/);
assert.match(chips, /Completas · 0/);
assert.match(chips, /Todas · 2/);

const days = renderDayChips({ selected: [1, 3] });
assert.match(days, /data-day="1"[^>]*aria-pressed="true"/);
assert.match(days, /data-day="0"[^>]*aria-pressed="false"/);
assert.equal((days.match(/data-day=/g) || []).length, 7);
assert.ok(days.indexOf('data-day="1"') < days.indexOf('data-day="0"'), 'lunes primero, domingo al final');
assert.match(renderDayChips({ selected: [] }), /Sin días marcados/i);

const hist = renderHistory({ entries: [{ id: 'a', dateText: '14 oct', durationText: '1 h 05 min', distanceText: '4,3 km', driverName: 'Carlos' }], count: 1, avgDurationText: '1 h 05 min', avgDistanceText: '4,3 km' });
assert.match(hist, /Promedio/);
assert.match(hist, /1 h 05 min/);
assert.match(renderHistory({ entries: [], count: 0, avgDurationText: '—', avgDistanceText: '—' }), /Aún no se ha corrido/);

const prev = renderDraftPreview({ pointsText: '3 puntos trazados', distanceText: '2,1 km', stopsCount: 5, timeText: '—' });
assert.match(prev, /3 puntos trazados/);
assert.match(prev, /2,1 km/);
assert.match(prev, /Vista previa del viaje/);
assert.match(prev, /<dt>Paradas<\/dt><dd>5<\/dd>/);
assert.match(prev, /<dt>Tiempo<\/dt><dd>—<\/dd>/);
console.log('routes-screens ok');

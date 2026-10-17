// SW-086c: el botón "Nueva ruta" no debe heredar datos de una ruta que se estaba editando.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');

const mode = app.match(/function setCreateRouteMode\(route\) \{[\s\S]*?\n\}\r?\n/)?.[0] ?? '';
assert.ok(mode, 'existe setCreateRouteMode');
assert.match(mode, /if \(!route\) resetCreateRouteForm\(\)/, 'el modo "nueva" limpia el formulario');

const reset = app.match(/function resetCreateRouteForm\(\) \{[\s\S]*?\n\}\r?\n/)?.[0] ?? '';
assert.ok(reset, 'existe resetCreateRouteForm');
for (const piece of ["#createRouteName", "#createRouteStart", "#createRouteOptimize", "draftDays = []", "#createRouteVehicle", "drawnRoutePoints = clearPoints()", "redrawCreateRouteTrace()"]) {
  assert.ok(reset.includes(piece), `el reinicio cubre ${piece}`);
}
// Abrir una edición pasa por openNewRoute() (limpia) y DESPUÉS carga los datos de la ruta.
const edit = app.match(/function openEditRoute\(routeId\) \{[\s\S]*?\n\}\r?\n/)?.[0] ?? '';
assert.ok(edit.indexOf('openNewRoute()') !== -1 && edit.indexOf('openNewRoute()') < edit.indexOf('setCreateRouteMode(route)'), 'primero limpia y luego aplica el modo edición');
assert.ok(edit.indexOf('setCreateRouteMode(route)') < edit.indexOf("$('#createRouteName')"), 'los datos de la ruta se cargan después del reinicio');
console.log('sw086c ok');

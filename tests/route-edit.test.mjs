// SW-086b: editar una ruta guardada. Lógica pura: valores iniciales, qué cambió, si el trazo se puede editar.
import assert from 'node:assert/strict';
import { canEditGeometry, initialEditValues, diffEdit, validateEdit, routeUpdatePayload, timeInputValue } from '../shared/route-edit.js';

for (const status of ['started', 'in_progress', 'delayed']) {
  const r = canEditGeometry({ status });
  assert.equal(r.ok, false, status);
  assert.equal(r.message, 'Esta ruta está en marcha; podrás editar el trazo cuando termine.');
}
for (const status of ['planned', 'assigned', 'completed', 'verified', undefined]) assert.deepEqual(canEditGeometry({ status }), { ok: true, message: '' }, String(status));

assert.equal(timeInputValue('08:00:00'), '08:00');
assert.equal(timeInputValue('8:05'), '08:05');
assert.equal(timeInputValue(null), '');
assert.equal(timeInputValue('xx'), '');

const route = { id: 'r1', name: 'Centro', startTime: '08:00:00', days: [1, 3, 5], status: 'assigned' };
const points = [[19.0, -71.0], [19.001, -71.001]];
const init = initialEditValues(route, points, { vehicleId: 'v1' });
assert.deepEqual(init, { name: 'Centro', startTime: '08:00', days: [1, 3, 5], vehicleId: 'v1', points });
assert.notEqual(init.points, points, 'copia el arreglo');
assert.deepEqual(initialEditValues({ id: 'x', name: 'N' }, undefined), { name: 'N', startTime: '', days: [], vehicleId: '', points: [] });

const same = diffEdit(init, { ...init, points: init.points.map((p) => [...p]) });
assert.deepEqual(same, { changed: false, meta: false, geometry: false, vehicle: false });
assert.equal(diffEdit(init, { ...init, name: 'Centro 2' }).meta, true);
assert.equal(diffEdit(init, { ...init, startTime: '09:00' }).meta, true);
assert.equal(diffEdit(init, { ...init, days: [1, 3] }).meta, true);
assert.equal(diffEdit(init, { ...init, days: [5, 3, 1] }).meta, false, 'el orden de los días no importa');
assert.equal(diffEdit(init, { ...init, vehicleId: 'v2' }).vehicle, true);
const moved = diffEdit(init, { ...init, points: [[19.0, -71.0], [19.002, -71.001]] });
assert.equal(moved.geometry, true); assert.equal(moved.changed, true);
assert.equal(diffEdit(init, { ...init, points: [[19.0, -71.0]] }).geometry, true);

assert.deepEqual(validateEdit({ name: ' Centro ', points, geometryAllowed: true }), { ok: true, name: 'Centro' });
assert.equal(validateEdit({ name: '', points, geometryAllowed: true }).message, 'Ingresa un nombre para la ruta.');
assert.equal(validateEdit({ name: 'A', points: [[1, 1]], geometryAllowed: true }).message, 'Traza al menos 2 puntos en el mapa.');
assert.equal(validateEdit({ name: 'A', points: [], geometryAllowed: false }).ok, true, 'con la ruta en marcha no se exige trazo');
assert.equal(validateEdit({ name: 'A', points, geometryAllowed: true, saving: true }).message, 'Guardando los cambios…');

assert.deepEqual(routeUpdatePayload({ name: 'Centro', startTime: '08:30', days: [1, 3] }), { name: 'Centro', start_time: '08:30:00', days_of_week: [1, 3] });
assert.deepEqual(routeUpdatePayload({ name: 'Centro', startTime: '', days: [] }), { name: 'Centro', start_time: null, days_of_week: null });
console.log('route-edit ok');

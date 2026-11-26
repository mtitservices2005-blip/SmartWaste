// SW-095: distinguir "sin red" de un error real, y dar la asignación en caché al GPS.
import assert from 'node:assert/strict';
import { isNetworkFailure, createOfflineAssignmentAdapter } from '../shared/driver-offline-net.js';

const f = (code, message) => ({ ok: false, error: { code, message } });
assert.equal(isNetworkFailure(f(undefined, 'TypeError: Failed to fetch')), true);
assert.equal(isNetworkFailure(f('SUPABASE_ERROR', 'TypeError: Load failed')), true);
assert.equal(isNetworkFailure(f('SUPABASE_ERROR', 'NetworkError when attempting to fetch resource.')), true);
assert.equal(isNetworkFailure(f('42501', 'new row violates row-level security policy')), false);
assert.equal(isNetworkFailure(f('INVALID_ROUTE_TRANSITION', 'Rejected route transition completed->started')), false);
assert.equal(isNetworkFailure(f('NO_ACTIVE_ROUTE_ASSIGNED', 'x')), false);
assert.equal(isNetworkFailure({ ok: true }), false);
assert.equal(isNetworkFailure(null), false);
assert.equal(isNetworkFailure(f('42501', 'denegado'), { online: false }), true, 'sin señal manda');
assert.equal(isNetworkFailure({ ok: false, message: 'Failed to fetch' }), true, 'forma de loadDriverToday');

const cached = { vehicle_id: 'v1', route_run_id: 'run1', route_id: 'r1' };
const real = { marker: 'real', startRoute: () => 'x', findOwnVehicleAssignment: async () => f(undefined, 'TypeError: Failed to fetch') };
let a = createOfflineAssignmentAdapter(real, { getCached: () => cached, isOnline: () => false });
assert.deepEqual(await a.findOwnVehicleAssignment('u1'), { ok: true, source: 'OFFLINE_CACHE', data: cached });
assert.equal(a.marker, 'real'); assert.equal(a.startRoute(), 'x');
a = createOfflineAssignmentAdapter(real, { getCached: () => null, isOnline: () => false });
assert.equal((await a.findOwnVehicleAssignment('u1')).ok, false, 'sin caché, el fallo real');
const noRun = { findOwnVehicleAssignment: async () => f('NO_ACTIVE_ROUTE_ASSIGNED', 'sin ruta') };
a = createOfflineAssignmentAdapter(noRun, { getCached: () => cached, isOnline: () => true });
assert.equal((await a.findOwnVehicleAssignment('u1')).error.code, 'NO_ACTIVE_ROUTE_ASSIGNED', 'error real no usa caché');
const okReal = { findOwnVehicleAssignment: async () => ({ ok: true, data: { vehicle_id: 'v9' } }) };
a = createOfflineAssignmentAdapter(okReal, { getCached: () => cached, isOnline: () => true });
assert.equal((await a.findOwnVehicleAssignment('u1')).data.vehicle_id, 'v9');
console.log('driver-offline-net: ok');

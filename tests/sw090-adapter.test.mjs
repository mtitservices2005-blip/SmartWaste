import assert from 'node:assert/strict';
import { createDemoOperationsAdapter } from '../shared/operations-adapter.js';

const a = createDemoOperationsAdapter();
assert.deepEqual(a.listFuelLogs(), []);
a.logFuel({ vehicle_id: 'v1', route_run_id: 'r1', liters: 5 });
const logs = a.listFuelLogs();
assert.equal(logs.length, 1);
assert.equal(logs[0].route_run_id, 'r1');
const v = a.createVehicle({ unit: 'X', plate: 'A1', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' });
assert.equal(v.fuel_efficiency_km_per_l, 4);
assert.equal(v.fuel_type, 'diesel');
assert.equal(a.markRouteRunTest('nope', true).is_test, true);
console.log('sw090-adapter: ok');

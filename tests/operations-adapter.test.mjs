import assert from 'node:assert/strict';
import { createDemoOperationsAdapter, resolveOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints } from '../shared/route-engine.js';
const adapter = createDemoOperationsAdapter();

// SW-034: resolveOperationsAdapter() is the runtime switch frontend/app.js uses — no client means
// demo (same as always), a client means real, mirroring frontend/auth-gate.js's readSupabaseConfig()
// opt-in pattern (no config -> no-op).
assert.equal(resolveOperationsAdapter().mode, 'DEMO_ONLY');
assert.equal(resolveOperationsAdapter({ client: null }).mode, 'DEMO_ONLY');
assert.equal(resolveOperationsAdapter({ client: { from: () => {} } }).mode, 'REAL');
assert(adapter.listVehicles().length > 0);
const route = adapter.createRoute({ id:'route-test', name:'Test', sectors:[], sector:'Centro urbano' });
assert.equal(route.status, 'planned');
assert.equal(adapter.assignVehicle('route-test','truck-01').status, 'assigned');
assert.equal(adapter.startRoute('route-test').status, 'started');
assert.equal(adapter.updateProgress('route-test', 50).status, 'in_progress');
assert.equal(adapter.markDelayed('route-test').status, 'delayed');
assert.equal(adapter.completeRoute('route-test').status, 'completed');
assert.equal(adapter.verifyRoute('route-test').status, 'verified');
assert(adapter.listPositions().every((p) => p.municipality_id));

// SW-025: saveRouteStops/listRouteStops persistence via the demo adapter, using a real
// (route-engine-generated) point sequence, not hand-written fixture points.
const generatedPoints = generateRouteStopPoints('route-centro', { stepMeters: 100 });
const saved = adapter.saveRouteStops('route-test', generatedPoints);
assert.equal(saved.length, generatedPoints.length);
const listed = adapter.listRouteStops('route-test');
assert.equal(listed.length, generatedPoints.length);
assert.deepEqual(listed.map((s) => s.sequence), generatedPoints.map((p) => p.sequence), 'listRouteStops must return stops ordered by sequence');
assert.ok(listed.every((s) => s.route_id === 'route-test'));
assert.equal(adapter.listRouteStops('route-that-does-not-exist').length, 0);

// SW-031: createVehicle/updateVehicle/createDriver — previously only existed on the Supabase
// adapter, so the demo adapter (what frontend/app.js actually uses) had no way to register a new
// vehicle or driver at all.
const vehiclesBefore = adapter.listVehicles().length;
const createdVehicle = adapter.createVehicle({ unit: 'SW-TEST-01', plate: 'DEMO-TEST-01', max_stops: 15 });
assert.ok(createdVehicle.id, 'createVehicle must return a generated id');
assert.equal(createdVehicle.unit, 'SW-TEST-01');
assert.equal(createdVehicle.state, 'offline', 'a freshly registered vehicle has no route yet');
assert.equal(adapter.listVehicles().length, vehiclesBefore + 1);
assert.equal(adapter.getVehicle(createdVehicle.id).unit, 'SW-TEST-01');

const updatedVehicle = adapter.updateVehicle(createdVehicle.id, { state: 'active' });
assert.equal(updatedVehicle.state, 'active');
assert.equal(adapter.getVehicle(createdVehicle.id).state, 'active');

const driversBefore = adapter.listDrivers().length;
const createdDriver = adapter.createDriver({ name: 'Chofer de prueba', phone: 'demo-9999' });
assert.ok(createdDriver.id, 'createDriver must return a generated id');
assert.equal(createdDriver.name, 'Chofer de prueba');
assert.equal(createdDriver.status, 'Disponible', 'default status when none is given');
assert.equal(adapter.listDrivers().length, driversBefore + 1);

console.log('operations-adapter ok');

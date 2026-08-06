import assert from 'node:assert/strict';
import { createDemoOperationsAdapter, createSupabaseOperationsAdapter, resolveOperationsAdapter } from '../shared/operations-adapter.js';
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

// SW-035 fase B: listRouteRuns() is new — nothing previously needed to read route_runs in bulk
// (every other write only transitions a single one by id). Minimal fake client just for the
// `.select().order()` chain this method actually calls.
const fakeRouteRuns = [
  { id: 'run-1', route_id: 'route-a', vehicle_id: 'veh-1', driver_id: 'drv-1', status: 'assigned', progress: 0, created_at: '2026-01-01T00:00:00Z' },
  { id: 'run-2', route_id: 'route-a', vehicle_id: 'veh-1', driver_id: 'drv-1', status: 'in_progress', progress: 40, created_at: '2026-01-02T00:00:00Z' }
];
const fakeClient = { from: (table) => { assert.equal(table, 'route_runs'); return { select: () => ({ order: () => Promise.resolve({ data: fakeRouteRuns, error: null }) }) }; } };
const supabaseAdapter = createSupabaseOperationsAdapter(fakeClient);
const routeRunsResult = await supabaseAdapter.listRouteRuns();
assert.equal(routeRunsResult.ok, true);
assert.equal(routeRunsResult.data.length, 2);
assert.equal(routeRunsResult.data[1].progress, 40, 'must be ordered oldest-first so the latest run per route can be picked by overwriting while iterating');

// Roadmap item 3 ("GPS real"): findOwnVehicleAssignment() resolves the real vehicle_id assigned to
// a signed-in driver's profile_id, via a 2-step drivers -> vehicle_assignments lookup. Fake client
// builds a minimal chainable query per table (select().eq()...eq().maybeSingle()), routed by table
// name and canned response, mirroring the shape createSupabaseOperationsAdapter actually calls.
function makeChainableQuery(result) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => result };
  return query;
}
function makeFakeAssignmentClient({ driverRow, assignmentRow }) {
  return {
    from: (table) => {
      if (table === 'drivers') return makeChainableQuery({ data: driverRow, error: null });
      if (table === 'vehicle_assignments') return makeChainableQuery({ data: assignmentRow, error: null });
      throw new Error(`unexpected table ${table}`);
    }
  };
}

// Happy path: driver row found, assignment found.
const happyAdapter = createSupabaseOperationsAdapter(makeFakeAssignmentClient({ driverRow: { id: 'drv-1' }, assignmentRow: { vehicle_id: 'veh-1' } }));
const happyResult = await happyAdapter.findOwnVehicleAssignment('profile-1');
assert.equal(happyResult.ok, true);
assert.equal(happyResult.data.vehicle_id, 'veh-1');

// No driver row linked to this profile.
const noDriverAdapter = createSupabaseOperationsAdapter(makeFakeAssignmentClient({ driverRow: null, assignmentRow: null }));
const noDriverResult = await noDriverAdapter.findOwnVehicleAssignment('profile-unknown');
assert.equal(noDriverResult.ok, false);
assert.equal(noDriverResult.error.code, 'DRIVER_NOT_FOUND');

// Driver exists but has no vehicle currently assigned.
const noAssignmentAdapter = createSupabaseOperationsAdapter(makeFakeAssignmentClient({ driverRow: { id: 'drv-2' }, assignmentRow: null }));
const noAssignmentResult = await noAssignmentAdapter.findOwnVehicleAssignment('profile-2');
assert.equal(noAssignmentResult.ok, false);
assert.equal(noAssignmentResult.error.code, 'NO_VEHICLE_ASSIGNED');

// Demo adapter always reports NOT_SUPPORTED_IN_DEMO — the GPS button only renders with a real
// backend configured, so this path exists just to keep both adapters' interfaces consistent.
const demoAssignmentResult = adapter.findOwnVehicleAssignment('profile-1');
assert.equal(demoAssignmentResult.ok, false);
assert.equal(demoAssignmentResult.error.code, 'NOT_SUPPORTED_IN_DEMO');

console.log('operations-adapter ok');

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
const startedDemo = adapter.startRoute('route-test');
assert.equal(startedDemo.status, 'started');
// SW-044: the demo adapter must stamp started_at/completed_at too (off the browser's own clock),
// not just the real adapter — routeMeasuredDurationMinutes() (frontend/app.js) needs both to show
// a measured duration regardless of which adapter is active.
assert.ok(startedDemo.started_at, 'demo startRoute() must stamp started_at');
assert.equal(adapter.updateProgress('route-test', 50).status, 'in_progress');
assert.equal(adapter.markDelayed('route-test').status, 'delayed');
const completedDemo = adapter.completeRoute('route-test');
assert.equal(completedDemo.status, 'completed');
assert.ok(completedDemo.completed_at, 'demo completeRoute() must stamp completed_at');
assert.equal(completedDemo.started_at, startedDemo.started_at, 'started_at must survive later transitions unchanged');
assert.equal(adapter.verifyRoute('route-test').status, 'verified');
assert(adapter.listPositions().every((p) => p.municipality_id));

// Idempotent stamping: completeRoute() (unlike startRoute(), which is guarded by
// canTransitionRoute() and can't legally run twice on the same route) uses updateRoute()
// internally with no transition check, so calling it again on an already-completed route is a
// realistic path (e.g. a duplicated click) — must not shift completed_at forward.
const timingRoute = adapter.createRoute({ id: 'route-timing-test', name: 'Timing test', sectors: [], sector: 'Centro urbano' });
adapter.assignVehicle(timingRoute.id, 'truck-02');
const firstComplete = adapter.completeRoute(timingRoute.id);
assert.ok(firstComplete.completed_at);
await new Promise((resolve) => setTimeout(resolve, 5));
const secondComplete = adapter.completeRoute(timingRoute.id);
assert.equal(secondComplete.completed_at, firstComplete.completed_at, 'completed_at must not change on a repeated completeRoute() call');

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

// SW-036: listLatestPositions() dedupes vehicle_positions down to one (the most recent) row per
// vehicle_id — the dispatcher map needs "where is this truck now", not its full history. The fake
// client returns rows already ordered captured_at-desc (same as the real .order() call), same
// pre-sorted-input assumption listRouteRuns' test above makes. Also asserts the query excludes
// source:'simulator' (nothing writes that today, but it documents "real positions only").
let lastNeqArgs = null;
const fakePositions = [
  { vehicle_id: 'veh-1', latitude: 19.43, longitude: -99.13, captured_at: '2026-01-02T00:00:10Z', source: 'browser_geolocation' },
  { vehicle_id: 'veh-2', latitude: 19.40, longitude: -99.10, captured_at: '2026-01-02T00:00:05Z', source: 'browser_geolocation' },
  { vehicle_id: 'veh-1', latitude: 19.42, longitude: -99.12, captured_at: '2026-01-01T00:00:00Z', source: 'browser_geolocation' }
];
const positionsClient = {
  from: (table) => {
    assert.equal(table, 'vehicle_positions');
    return { select: () => ({ neq: (...args) => { lastNeqArgs = args; return { order: () => Promise.resolve({ data: fakePositions, error: null }) }; } }) };
  }
};
const positionsResult = await createSupabaseOperationsAdapter(positionsClient).listLatestPositions();
assert.equal(positionsResult.ok, true);
assert.deepEqual(lastNeqArgs, ['source', 'simulator']);
assert.equal(positionsResult.data.length, 2, 'one row per vehicle_id, not the full history');
const latestVeh1 = positionsResult.data.find((row) => row.vehicle_id === 'veh-1');
assert.equal(latestVeh1.captured_at, '2026-01-02T00:00:10Z', 'must keep the most recent row per vehicle, not the first/oldest');

// Adapter-exception fallback path (no client): mirrors listPositions()'s own fallback, so
// listLatestPositions() degrades the same way when Supabase isn't configured.
const noClientResult = await createSupabaseOperationsAdapter(null).listLatestPositions();
assert.equal(noClientResult.ok, true);
assert.equal(noClientResult.source, 'DEMO_FALLBACK');

// SW-042 (docs/TECHNICAL_DEBT_REGISTER.md #24): demo adapter's assignDriverToVehicle()/
// listVehicleAssignments() — demo trucks already carry driverId directly, so
// listVehicleAssignments() must derive the same {vehicle_id, driver_id, status} shape the real
// adapter reads from the vehicle_assignments table, and assigning a driver already parked on
// another truck must clear them from it first (a driver drives one truck at a time).
assert.ok(adapter.listVehicleAssignments().length > 0, 'the demo trucks seeded from shared/demo-data.js already carry a driverId each');
const demoAssignAdapter = createDemoOperationsAdapter();
demoAssignAdapter.assignDriverToVehicle('truck-05', 'drv-01'); // truck-05 has no driver by default; drv-01 already drives truck-02
assert.equal(demoAssignAdapter.getVehicle('truck-05').driverId, 'drv-01');
assert.equal(demoAssignAdapter.getVehicle('truck-02').driverId, null, 'drv-01 must be cleared from truck-02 once reassigned to truck-05');
assert.ok(demoAssignAdapter.listVehicleAssignments().some((a) => a.vehicle_id === 'truck-05' && a.driver_id === 'drv-01'));
assert.ok(!demoAssignAdapter.listVehicleAssignments().some((a) => a.vehicle_id === 'truck-02'), 'truck-02 must have dropped out of the list once its driver was reassigned');
assert.throws(() => demoAssignAdapter.assignDriverToVehicle('vehicle-does-not-exist', 'drv-01'));

// Real adapter: listVehicleAssignments() is a plain scoped select filtered to status='assigned'.
const assignmentsFakeClient = { from: (table) => { assert.equal(table, 'vehicle_assignments'); return { select: () => ({ eq: () => Promise.resolve({ data: [{ vehicle_id: 'veh-1', driver_id: 'drv-1', status: 'assigned' }], error: null }) }) }; } };
const assignmentsListResult = await createSupabaseOperationsAdapter(assignmentsFakeClient).listVehicleAssignments();
assert.equal(assignmentsListResult.ok, true);
assert.equal(assignmentsListResult.data.length, 1);
assert.equal(assignmentsListResult.data[0].vehicle_id, 'veh-1');

// Real adapter: assignDriverToVehicle() ends any other 'assigned' row for the same vehicle_id or
// driver_id (2 separate update calls, no vehicle_assignments unique constraint enforces this
// server-side — see shared/operations-adapter.js) before inserting the new link. Fake client
// records every update/insert call so the test can assert both ends ran before the insert, and
// that the insert carries municipality_id/vehicle_id/driver_id/status correctly.
// SW-056: assignDriverToVehicle() now also best-effort patches route_runs.driver_id on the
// vehicle's active run after the vehicle_assignments insert — routeRunsResponse lets each test case
// control whether an active run "exists" ({data:{id:...}}) or not ({data:null}), and routeRunUpdates
// records any route_runs.update() calls so tests can assert whether the patch happened.
function makeAssignDriverFakeClient(routeRunsResponse = { data: null, error: null }) {
  const calls = [];
  const routeRunUpdates = [];
  // scoped() (municipality_id set in this test) adds one extra leading .eq('municipality_id', ...)
  // in front of the update()'s own .eq('vehicle_id'|'driver_id', ...).eq('status', 'assigned')
  // chain — this chainable stub just resolves on any .eq() call count, mirroring
  // makeChainableQuery() above.
  const chainableUpdate = { eq: () => chainableUpdate, then: (resolve) => resolve({ data: null, error: null }) };
  const routeRunSelectQuery = { eq: () => routeRunSelectQuery, not: () => routeRunSelectQuery, order: () => routeRunSelectQuery, limit: () => routeRunSelectQuery, maybeSingle: async () => routeRunsResponse };
  const client = {
    from: (table) => {
      if (table === 'route_runs') {
        return {
          select: () => routeRunSelectQuery,
          update: (patch) => { routeRunUpdates.push(patch); return { eq: async () => ({ data: null, error: null }) }; }
        };
      }
      assert.equal(table, 'vehicle_assignments');
      return {
        update: (patch) => { calls.push({ op: 'update', patch }); return chainableUpdate; },
        insert: (row) => { calls.push({ op: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: 'assignment-new', ...row }, error: null }) }) }; }
      };
    }
  };
  return { client, calls, routeRunUpdates };
}
const { client: assignDriverClient, calls: assignDriverCalls } = makeAssignDriverFakeClient();
const assignDriverResult = await createSupabaseOperationsAdapter(assignDriverClient, { municipality_id: 'mun-a' }).assignDriverToVehicle('veh-1', 'drv-1');
assert.equal(assignDriverResult.ok, true);
assert.equal(assignDriverResult.data.vehicle_id, 'veh-1');
assert.equal(assignDriverCalls.length, 3, 'end-by-vehicle, end-by-driver, then insert');
assert.equal(assignDriverCalls[0].op, 'update');
assert.equal(assignDriverCalls[0].patch.status, 'reassigned');
assert.equal(assignDriverCalls[1].op, 'update');
assert.equal(assignDriverCalls[2].op, 'insert');
assert.deepEqual(assignDriverCalls[2].row, { municipality_id: 'mun-a', vehicle_id: 'veh-1', driver_id: 'drv-1', status: 'assigned' });

// SW-056: with an active (non-terminal) route_run on that vehicle, assignDriverToVehicle() must
// patch its driver_id too — this is what makes summarizeRouteRunsByDriver() (SW-047 Estadísticas)
// have anything to read; before this fix nothing ever wrote route_runs.driver_id at all.
const { client: withActiveRunClient, routeRunUpdates: withActiveRunUpdates } = makeAssignDriverFakeClient({ data: { id: 'run-active-1' }, error: null });
const withActiveRunResult = await createSupabaseOperationsAdapter(withActiveRunClient, { municipality_id: 'mun-a' }).assignDriverToVehicle('veh-1', 'drv-1');
assert.equal(withActiveRunResult.ok, true, 'the route_runs best-effort patch must never fail the vehicle_assignments write itself');
assert.equal(withActiveRunUpdates.length, 1, 'must patch the active run once');
assert.deepEqual(withActiveRunUpdates[0], { driver_id: 'drv-1' });

// No active route_run on the vehicle: nothing to patch, still succeeds.
const { client: noActiveRunClient, routeRunUpdates: noActiveRunUpdates } = makeAssignDriverFakeClient({ data: null, error: null });
const noActiveRunResult = await createSupabaseOperationsAdapter(noActiveRunClient, { municipality_id: 'mun-a' }).assignDriverToVehicle('veh-1', 'drv-1');
assert.equal(noActiveRunResult.ok, true);
assert.equal(noActiveRunUpdates.length, 0, 'nothing to patch when the vehicle has no active run');

// No client (demo fallback): falls back to the demo adapter's own assignDriverToVehicle().
const noClientAssignResult = await createSupabaseOperationsAdapter(null).assignDriverToVehicle('truck-05', 'drv-01');
assert.equal(noClientAssignResult.ok, true);
assert.equal(noClientAssignResult.source, 'DEMO_FALLBACK');
assert.equal(noClientAssignResult.data.driverId, 'drv-01');

// SW-044: transitionRouteRun() (the shared engine behind startRoute()/completeRoute()/etc. on the
// real adapter) stamps started_at/completed_at on the corresponding transition, and must not
// overwrite either if the route_run already has one (e.g. completing again via updateProgress(100)
// after completeRoute() already ran). Fake client mimics the exact chain transitionRouteRun() calls:
// select().eq().order().limit().maybeSingle() to read the current row, then
// update().eq()[.eq()].select().single() to write it.
function makeRouteRunFakeClient(currentRun) {
  let updatePatch = null;
  const client = {
    from: (table) => {
      assert.equal(table, 'route_runs');
      return {
        select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: currentRun, error: null }) }) }) }) }),
        update: (patch) => {
          updatePatch = patch;
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...currentRun, ...patch }, error: null }) }) }) };
        }
      };
    }
  };
  return { client, getUpdatePatch: () => updatePatch };
}

const { client: startRunClient, getUpdatePatch: getStartPatch } = makeRouteRunFakeClient({ id: 'run-1', route_id: 'route-x', status: 'assigned', started_at: null, completed_at: null });
const realStartResult = await createSupabaseOperationsAdapter(startRunClient).startRoute('route-x');
assert.equal(realStartResult.ok, true);
assert.ok(getStartPatch().started_at, 'must stamp started_at on the started transition');
assert.equal(realStartResult.data.status, 'started');

// Already has started_at (shouldn't normally happen mid-'assigned', but the guard is unconditional
// on the column, not the status) — must not be included in the update patch, i.e. not overwritten.
const { client: alreadyStartedClient, getUpdatePatch: getAlreadyStartedPatch } = makeRouteRunFakeClient({ id: 'run-2', route_id: 'route-x', status: 'assigned', started_at: '2020-01-01T00:00:00Z', completed_at: null });
await createSupabaseOperationsAdapter(alreadyStartedClient).startRoute('route-x');
assert.equal(getAlreadyStartedPatch().started_at, undefined, 'must not overwrite an existing started_at');

const { client: completeRunClient, getUpdatePatch: getCompletePatch } = makeRouteRunFakeClient({ id: 'run-3', route_id: 'route-x', status: 'in_progress', started_at: '2020-01-01T00:00:00Z', completed_at: null });
const realCompleteResult = await createSupabaseOperationsAdapter(completeRunClient).completeRoute('route-x');
assert.equal(realCompleteResult.ok, true);
assert.ok(getCompletePatch().completed_at, 'must stamp completed_at on the completed transition');

const { client: alreadyCompletedClient, getUpdatePatch: getAlreadyCompletedPatch } = makeRouteRunFakeClient({ id: 'run-4', route_id: 'route-x', status: 'delayed', started_at: '2020-01-01T00:00:00Z', completed_at: '2020-01-01T01:00:00Z' });
await createSupabaseOperationsAdapter(alreadyCompletedClient).completeRoute('route-x');
assert.equal(getAlreadyCompletedPatch().completed_at, undefined, 'must not overwrite an existing completed_at');

// SW-045: on completion, with a vehicle_id and started_at present, transitionRouteRun() also sums
// the real vehicle_positions trail since started_at into distance_meters. Fake client routes by
// table name — route_runs uses the same chain as above, vehicle_positions gets its own
// select().eq().neq().gte().order() chain.
function makeRouteRunWithPositionsFakeClient(currentRun, positions) {
  let updatePatch = null;
  let positionsQueryArgs = null;
  const client = {
    from: (table) => {
      if (table === 'route_runs') {
        return {
          select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: currentRun, error: null }) }) }) }) }),
          update: (patch) => {
            updatePatch = patch;
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...currentRun, ...patch }, error: null }) }) }) };
          }
        };
      }
      if (table === 'vehicle_positions') {
        return {
          select: () => ({ eq: (...eqArgs) => { positionsQueryArgs = eqArgs; return { neq: () => ({ gte: () => ({ order: async () => ({ data: positions, error: null }) }) }) }; } })
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
  return { client, getUpdatePatch: () => updatePatch, getPositionsQueryArgs: () => positionsQueryArgs };
}

// >= 2 real positions: distance_meters gets computed and stamped (haversine between them, > 0 for
// two genuinely different coordinates).
const twoPositions = [
  { latitude: 19.43, longitude: -99.13, captured_at: '2026-01-01T00:00:00Z' },
  { latitude: 19.44, longitude: -99.14, captured_at: '2026-01-01T00:05:00Z' }
];
const { client: distanceClient, getUpdatePatch: getDistancePatch, getPositionsQueryArgs } = makeRouteRunWithPositionsFakeClient(
  { id: 'run-5', route_id: 'route-x', status: 'in_progress', vehicle_id: 'veh-1', started_at: '2026-01-01T00:00:00Z', completed_at: null }, twoPositions
);
const distanceResult = await createSupabaseOperationsAdapter(distanceClient).completeRoute('route-x');
assert.equal(distanceResult.ok, true);
assert.deepEqual(getPositionsQueryArgs(), ['vehicle_id', 'veh-1']);
assert.ok(getDistancePatch().distance_meters > 0, 'must compute a positive distance_meters from 2 distinct positions');

// Fewer than 2 positions: no GPS trail to measure a distance between — distance_meters stays
// unstamped (falls back to the route's estimated distance in the UI), completion still succeeds.
const { client: noTrailClient, getUpdatePatch: getNoTrailPatch } = makeRouteRunWithPositionsFakeClient(
  { id: 'run-6', route_id: 'route-x', status: 'in_progress', vehicle_id: 'veh-2', started_at: '2026-01-01T00:00:00Z', completed_at: null }, [twoPositions[0]]
);
const noTrailResult = await createSupabaseOperationsAdapter(noTrailClient).completeRoute('route-x');
assert.equal(noTrailResult.ok, true, 'completion must still succeed with no measurable distance');
assert.equal(getNoTrailPatch().distance_meters, undefined, 'must not stamp distance_meters without at least 2 positions');

// No vehicle_id on the run: skips the distance query entirely rather than querying vehicle_id=null.
const { client: noVehicleClient, getUpdatePatch: getNoVehiclePatch } = makeRouteRunFakeClient({ id: 'run-7', route_id: 'route-x', status: 'in_progress', started_at: '2026-01-01T00:00:00Z', completed_at: null });
const noVehicleResult = await createSupabaseOperationsAdapter(noVehicleClient).completeRoute('route-x');
assert.equal(noVehicleResult.ok, true);
assert.equal(getNoVehiclePatch().distance_meters, undefined);

// SW-050: createDriver() must forward email through to the drivers insert unchanged — before
// supabase/migrations/202607150014_sw050_driver_email.sql added the column, this field had nowhere
// to persist, and a driver's "Crear cuenta de acceso" button silently stopped being reachable the
// moment the page reloaded (drivers.email now hydrates it back, same as any other real field).
function makeFakeCreateDriverClient() {
  let insertedRow = null;
  const client = {
    from: (table) => {
      assert.equal(table, 'drivers');
      return { insert: (row) => { insertedRow = row; return { select: () => ({ single: async () => ({ data: { id: 'driver-new', ...row }, error: null }) }) }; } };
    }
  };
  return { client, getInsertedRow: () => insertedRow };
}
const { client: createDriverClient, getInsertedRow } = makeFakeCreateDriverClient();
const createDriverResult = await createSupabaseOperationsAdapter(createDriverClient, { municipality_id: 'muni-1' }).createDriver({ display_name: 'Chofer Nuevo', email: 'chofer@example.com' });
assert.equal(createDriverResult.ok, true);
assert.equal(getInsertedRow().email, 'chofer@example.com', 'email must reach the real drivers insert, not be silently dropped');
assert.equal(createDriverResult.data.email, 'chofer@example.com');

// SW-056: assignVehicle() (assignToRouteRun() under the hood) must inherit a driver already paired
// to the vehicle (via a prior assignDriverToVehicle() call, i.e. an existing 'assigned' row in
// vehicle_assignments) onto the route_run it's creating/updating — the reverse order from the
// route_runs.driver_id fix above (driver assigned to vehicle BEFORE the vehicle is ever put on a
// route). Fake client covers the full assignVehicle() call chain: an existing active route_run,
// an existing vehicle_assignments row carrying the driver, no prior vehicle_assignments row keyed
// by route_run_id yet (so it inserts), and the routes table update.
function makeAssignVehicleFakeClient({ existingDriverId }) {
  const routeRunsUpdatePatches = [];
  const vehicleAssignmentInserts = [];
  const isCalls = [];
  let selectCallCount = 0;
  const client = {
    from: (table) => {
      if (table === 'route_runs') {
        const existingRunQuery = { not: () => existingRunQuery, order: () => existingRunQuery, limit: () => existingRunQuery, eq: () => existingRunQuery, maybeSingle: async () => ({ data: { id: 'run-1', municipality_id: 'mun-a' }, error: null }) };
        return {
          select: () => existingRunQuery,
          update: (patch) => {
            routeRunsUpdatePatches.push(patch);
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'run-1', municipality_id: 'mun-a', ...patch }, error: null }) }) }) };
          }
        };
      }
      if (table === 'vehicle_assignments') {
        const driverLookupQuery = {
          eq: () => driverLookupQuery,
          is: (column, value) => { isCalls.push([column, value]); return driverLookupQuery; },
          maybeSingle: async () => ({ data: existingDriverId ? { driver_id: existingDriverId } : null, error: null })
        };
        const existingByRunQuery = { eq: () => existingByRunQuery, maybeSingle: async () => ({ data: null, error: null }) };
        return {
          select: () => { selectCallCount += 1; return selectCallCount === 1 ? driverLookupQuery : existingByRunQuery; },
          insert: (row) => { vehicleAssignmentInserts.push(row); return { select: () => ({ single: async () => ({ data: { id: 'assignment-new', ...row }, error: null }) }) }; }
        };
      }
      if (table === 'routes') {
        const routeQuery = { eq: () => routeQuery, select: () => ({ maybeSingle: async () => ({ data: { id: 'route-1', status: 'assigned' }, error: null }) }) };
        return { update: () => routeQuery };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
  return { client, routeRunsUpdatePatches, vehicleAssignmentInserts, isCalls };
}
const { client: inheritDriverClient, routeRunsUpdatePatches: inheritDriverPatches, vehicleAssignmentInserts: inheritDriverInserts, isCalls: inheritDriverIsCalls } = makeAssignVehicleFakeClient({ existingDriverId: 'drv-existing' });
const inheritDriverResult = await createSupabaseOperationsAdapter(inheritDriverClient, { municipality_id: 'mun-a' }).assignVehicle('route-1', 'veh-1');
assert.equal(inheritDriverResult.ok, true);
assert.equal(inheritDriverPatches[0].driver_id, 'drv-existing', 'route_runs update must inherit the vehicle\'s already-paired driver');
assert.equal(inheritDriverInserts[0].driver_id, 'drv-existing', 'the vehicle_assignments row this creates must carry the inherited driver too');
// Codex review (PR #73): without this filter, a vehicle on its second+ run matches both its
// persistent pairing row (route_run_id IS NULL) and the route_run_id-tagged row this same function
// left behind on the previous run, so maybeSingle() would find multiple rows and the driverPatch
// silently stays empty via the outer catch. Guard that the filter is actually applied.
assert.deepEqual(inheritDriverIsCalls[0], ['route_run_id', null], 'driver lookup must be restricted to the persistent pairing (route_run_id IS NULL)');

// No driver currently paired to the vehicle: nothing to inherit, assignment still succeeds without
// inventing a driver_id.
const { client: noDriverToInheritClient, routeRunsUpdatePatches: noInheritPatches } = makeAssignVehicleFakeClient({ existingDriverId: null });
const noInheritResult = await createSupabaseOperationsAdapter(noDriverToInheritClient, { municipality_id: 'mun-a' }).assignVehicle('route-1', 'veh-1');
assert.equal(noInheritResult.ok, true);
assert.equal(noInheritPatches[0].driver_id, undefined, 'must not invent a driver_id when the vehicle has none assigned');

console.log('operations-adapter ok');

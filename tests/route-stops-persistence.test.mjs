// SW-025: exercises real route_stops persistence (shared/operations-adapter.js's
// saveRouteStops()/listRouteStops()/listRouteStopsWithStatus()) against a local Supabase instance,
// using shared/route-engine.js to generate the point sequence — not hand-written fixture rows.
// Requires `npx supabase start`; see docs/SW020_CLAUDE_CODE_TASK_BRIEF.md section 0.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints, splitIntoTrips } from '../shared/route-engine.js';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const dispatcherAdapter = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });
const driverAdapter = createSupabaseOperationsAdapter(driverClient, { municipality_id: scenario.municipalityA.id });

// 1. Dispatcher creates a route and assigns the seeded vehicle/driver to it.
const created = await dispatcherAdapter.createRoute({ name: 'SW-025 ruta con puntos generados' });
assert.equal(created.ok, true, `createRoute failed: ${JSON.stringify(created.error)}`);
const routeId = created.data.id;
const assignedVehicle = await dispatcherAdapter.assignVehicle(routeId, scenario.vehicleA.id);
assert.equal(assignedVehicle.ok, true, `assignVehicle failed: ${JSON.stringify(assignedVehicle.error)}`);
const assignedDriver = await dispatcherAdapter.assignDriver(routeId, scenario.driverRowA.id);
assert.equal(assignedDriver.ok, true, `assignDriver failed: ${JSON.stringify(assignedDriver.error)}`);

// 2. vehicles.max_stops (202607150008_sw025_vehicle_capacity.sql) defaults to 20 for a freshly
// seeded vehicle (seedScenario doesn't set it) — confirms the migration's default actually applies.
const vehicleRow = await dispatcherAdapter.getVehicle(scenario.vehicleA.id);
assert.equal(vehicleRow.ok, true, `getVehicle failed: ${JSON.stringify(vehicleRow.error)}`);
assert.equal(vehicleRow.data.max_stops, 20, 'vehicles.max_stops must default to 20 per the migration');

// 3. Generate the point sequence from a real routePath and cut it by the vehicle's capacity —
// route-centro has 12 points at the default 100m step (fewer than 20), so this should NOT need
// more than one trip; force a smaller cap to actually exercise the cut.
const points = generateRouteStopPoints('route-centro', { stepMeters: 100 });
assert.ok(points.length > 5, 'sanity check: route-centro should generate more than 5 points at 100m spacing');
const trips = splitIntoTrips(points, 5);
assert.ok(trips.length > 1, 'a 5-stop cap on more than 5 points must produce more than one trip');
const flattened = trips.flat();

// 4. Persist all points for this route_id (a real UUID, not demo-data.js's hardcoded string ids).
const saveResult = await dispatcherAdapter.saveRouteStops(routeId, flattened);
assert.equal(saveResult.ok, true, `saveRouteStops failed: ${JSON.stringify(saveResult.error)}`);
assert.equal(saveResult.data.length, flattened.length);

const persisted = await service.from('route_stops').select('*').eq('route_id', routeId).order('sequence');
assert.equal(persisted.error, null, `route_stops rows missing: ${persisted.error?.message}`);
assert.equal(persisted.data.length, flattened.length);
assert.deepEqual(persisted.data.map((row) => row.sequence), flattened.map((p) => p.sequence), 'persisted rows must keep the generated sequence order');
assert.ok(persisted.data.every((row) => row.municipality_id === scenario.municipalityA.id));

// 5. listRouteStops must read them back the same way, through the adapter (not the service client).
const listed = await dispatcherAdapter.listRouteStops(routeId);
assert.equal(listed.ok, true, `listRouteStops failed: ${JSON.stringify(listed.error)}`);
assert.equal(listed.data.length, flattened.length);
assert.deepEqual(listed.data.map((row) => row.sequence), flattened.map((p) => p.sequence));

// 6. Real RLS rejection: route_stops only grants tenant_insert_staff to municipal_admin/supervisor/
// dispatcher (202607150004_sw014_auth_rls_policies.sql) — a driver must not be able to write stops.
const driverAttempt = await driverAdapter.saveRouteStops(routeId, [points[0]]);
assert.equal(driverAttempt.ok, false, 'driver must not be able to write route_stops');

// 7. Status derivation: record a real vehicle_position at (very near) one stop's coordinates, and
// confirm listRouteStopsWithStatus marks that stop (and only points within range) as recolectado.
const targetStop = flattened[2];
const collectedPosition = await service.from('vehicle_positions').insert({
  vehicle_id: scenario.vehicleA.id,
  municipality_id: scenario.municipalityA.id,
  latitude: targetStop.latitude,
  longitude: targetStop.longitude,
  captured_at: new Date().toISOString(),
  source: 'simulator',
  correlation_id: randomUUID()
}).select('*').single();
assert.equal(collectedPosition.error, null, `vehicle_positions insert failed: ${collectedPosition.error?.message}`);

const withStatus = await dispatcherAdapter.listRouteStopsWithStatus(routeId, scenario.vehicleA.id);
assert.equal(withStatus.ok, true, `listRouteStopsWithStatus failed: ${JSON.stringify(withStatus.error)}`);
const targetResult = withStatus.data.find((stop) => stop.sequence === targetStop.sequence);
assert.equal(targetResult.status, 'recolectado', 'the stop matching the recorded position must be recolectado');
const untouchedResult = withStatus.data.find((stop) => stop.sequence === flattened[flattened.length - 1].sequence);
assert.equal(untouchedResult.status, 'pendiente', 'a stop far from any recorded position must stay pendiente');

console.log('route-stops-persistence ok');

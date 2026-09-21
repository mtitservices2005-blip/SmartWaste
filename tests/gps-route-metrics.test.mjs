// SW-062: real integration proof for the pilot-critical chain:
// active driver run -> browser GPS samples -> persisted trail -> completed run -> saved metrics.
// Requires `npx supabase start` and runs in the integration-tests CI job.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { createTelemetryIngestionAdapter } from '../shared/telemetry-simulator.js';
import { summarizeRouteRunsForMunicipality } from '../shared/route-run-stats.js';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);
const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const dispatcher = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });
const driver = createSupabaseOperationsAdapter(driverClient, { municipality_id: scenario.municipalityA.id });

assert.equal((await dispatcher.assignVehicle(scenario.routeA.id, scenario.vehicleA.id)).ok, true);
assert.equal((await dispatcher.assignDriver(scenario.routeA.id, scenario.driverRowA.id)).ok, true);

const started = await driver.startRoute(scenario.routeA.id);
assert.equal(started.ok, true, `startRoute failed: ${JSON.stringify(started.error)}`);
const routeRunId = started.data.id;

const ownRun = await driver.findOwnVehicleAssignment(scenario.driverUserA.id);
assert.equal(ownRun.ok, true, `active run lookup failed: ${JSON.stringify(ownRun.error)}`);
assert.deepEqual(ownRun.data, {
  vehicle_id: scenario.vehicleA.id,
  route_run_id: routeRunId,
  route_id: scenario.routeA.id
});

const telemetry = createTelemetryIngestionAdapter(driverClient, { municipality_id: scenario.municipalityA.id });
const baseTime = Date.parse(started.data.started_at) + 1000;
const samples = [
  [19.64890, -71.09560],
  [19.64940, -71.09510],
  [19.65000, -71.09450]
];
for (const [index, [latitude, longitude]] of samples.entries()) {
  const result = await telemetry.ingest({
    vehicle_id: scenario.vehicleA.id,
    municipality_id: scenario.municipalityA.id,
    route_run_id: routeRunId,
    latitude,
    longitude,
    accuracy: 8,
    speed: 4,
    heading: 45,
    captured_at: new Date(baseTime + index * 5000).toISOString(),
    received_at: new Date().toISOString(),
    source: 'browser_geolocation',
    device_id: 'integration-browser',
    correlation_id: randomUUID()
  });
  assert.equal(result.ok, true, `GPS sample ${index + 1} failed: ${JSON.stringify(result.error)}`);
}

const storedTrail = await service.from('vehicle_positions').select('*').eq('route_run_id', routeRunId).order('captured_at');
assert.equal(storedTrail.error, null, `stored trail query failed: ${storedTrail.error?.message}`);
assert.equal(storedTrail.data.length, samples.length);
assert.ok(storedTrail.data.every((row) => row.source === 'browser_geolocation'));

const completed = await driver.completeRoute(scenario.routeA.id);
assert.equal(completed.ok, true, `completeRoute failed: ${JSON.stringify(completed.error)}`);
assert.equal(completed.data.status, 'completed');
assert.equal(completed.data.gps_points_count, samples.length);
assert.equal(completed.data.gps_started_at, storedTrail.data[0].captured_at);
assert.equal(completed.data.gps_ended_at, storedTrail.data.at(-1).captured_at);
assert.ok(Number(completed.data.distance_meters) > 0, 'GPS trail must produce a positive measured distance');

const persistedRun = await service.from('route_runs').select('*').eq('id', routeRunId).single();
assert.equal(persistedRun.error, null, `persisted route_run missing: ${persistedRun.error?.message}`);
assert.equal(persistedRun.data.gps_points_count, samples.length);
assert.equal(Number(persistedRun.data.distance_meters), Number(completed.data.distance_meters));

const totals = summarizeRouteRunsForMunicipality([persistedRun.data]);
assert.equal(totals.completedRunsCount, 1);
assert.equal(totals.totalDistanceMeters, Number(persistedRun.data.distance_meters));

console.log('gps-route-metrics ok');

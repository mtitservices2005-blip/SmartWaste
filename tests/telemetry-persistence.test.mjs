// SW-016: exercises real telemetry ingestion, persistence, and Realtime delivery against a local
// Supabase instance, through shared/telemetry-simulator.js's DeviceSimulator and
// createTelemetryIngestionAdapter. Requires `npx supabase start`; see
// docs/SW020_CLAUDE_CODE_TASK_BRIEF.md section 0 for the same local-instance setup used by
// tests/operational-cycle.test.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { DeviceSimulator, createTelemetryIngestionAdapter } from '../shared/telemetry-simulator.js';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);

const dispatcherAdapter = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });

// 1. Dispatcher assigns the driver to vehicleA (opens route_runs/vehicle_assignments in 'assigned'
// status) — driver_insert_own_vehicle_position (202607150006_sw020_rls_fixes.sql) requires an
// active vehicle_assignments row for this driver+vehicle before it allows the insert.
const assignedVehicle = await dispatcherAdapter.assignVehicle(scenario.routeA.id, scenario.vehicleA.id);
assert.equal(assignedVehicle.ok, true, `assignVehicle failed: ${JSON.stringify(assignedVehicle.error)}`);
const assignedDriver = await dispatcherAdapter.assignDriver(scenario.routeA.id, scenario.driverRowA.id);
assert.equal(assignedDriver.ok, true, `assignDriver failed: ${JSON.stringify(assignedDriver.error)}`);

// A second vehicle in the SAME municipality, deliberately left unassigned to this driver — used
// below to prove the database (not just the app-level municipality_id guard in
// createTelemetryIngestionAdapter) rejects the write.
const vehicleA2 = await service.from('vehicles').insert({ municipality_id: scenario.municipalityA.id, code: `SW016-UNASSIGNED-${Date.now().toString(36)}` }).select('*').single();
assert.equal(vehicleA2.error, null, `vehicleA2 insert failed: ${vehicleA2.error?.message}`);

const telemetry = createTelemetryIngestionAdapter(driverClient, { municipality_id: scenario.municipalityA.id });
assert.equal(telemetry.mode, 'REAL');

const simulator = new DeviceSimulator(scenario.vehicleA.id);
simulator.reset();
// makeTelemetry() (shared/telemetry-simulator.js) defaults municipality_id to the demo constant
// 'laguna-salada-rd', not the seeded municipality's UUID — every emitted point must be rescoped to
// scenario.municipalityA.id or the adapter's own municipality_id guard rejects it before Supabase
// is ever contacted.
const scoped = (point) => ({ ...point, municipality_id: scenario.municipalityA.id });

// 2. Ingest one point and confirm it actually persisted in vehicle_positions (sw016.telemetryPersistence).
const firstPoint = scoped(simulator.start());
const firstCorrelation = randomUUID();
const ingested = await telemetry.ingest(firstPoint, { correlation_id: firstCorrelation });
assert.equal(ingested.ok, true, `ingest failed: ${JSON.stringify(ingested.error)}`);
assert.equal(ingested.source, 'REAL');

const persisted = await service.from('vehicle_positions').select('*').eq('correlation_id', firstCorrelation).single();
assert.equal(persisted.error, null, `vehicle_positions row missing: ${persisted.error?.message}`);
assert.equal(persisted.data.vehicle_id, scenario.vehicleA.id);
assert.equal(persisted.data.municipality_id, scenario.municipalityA.id);
assert.equal(persisted.data.source, 'simulator');

// 3. Subscribe to Realtime for this vehicle and wait for the channel to actually confirm
// 'SUBSCRIBED' before ingesting the next point — otherwise there's a race where the INSERT could
// land before the websocket subscription is live server-side. Requires vehicle_positions to be in
// the supabase_realtime publication AND the supabase_realtime_admin role (the one Realtime's own
// server uses to read the WAL, separate from anon/authenticated/service_role) to have SELECT on it
// (202607150007_sw016_telemetry_realtime.sql), plus a tenant_read RLS policy that covers 'driver'
// (202607150004_sw014_auth_rls_policies.sql) so the driver's own subscription is authorized.
let secondCorrelation;
const received = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Realtime event not received within 15s (channel never reached SUBSCRIBED, or the INSERT it saw did not match)')), 15000);
  const subscription = telemetry.subscribe(
    scenario.vehicleA.id,
    (row) => {
      if (row.correlation_id !== secondCorrelation) return;
      clearTimeout(timeout);
      subscription.unsubscribe();
      resolve(row);
    },
    {
      onStatus: (status, err) => {
        console.log(`[telemetry-realtime] channel status: ${status}${err ? ` (${err.message ?? err})` : ''}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(new Error(`Realtime channel failed with status ${status}${err ? `: ${err.message ?? JSON.stringify(err)}` : ''}`));
          return;
        }
        if (status !== 'SUBSCRIBED') return;
        secondCorrelation = randomUUID();
        const secondPoint = scoped(simulator.emit());
        telemetry.ingest(secondPoint, { correlation_id: secondCorrelation }).then((result) => {
          if (!result.ok) { clearTimeout(timeout); reject(new Error(`second ingest failed: ${JSON.stringify(result.error)}`)); }
        });
      }
    }
  );
  assert.equal(subscription.status, 'REALTIME_SUBSCRIBED');
});

const realtimeRow = await received;
assert.equal(realtimeRow.vehicle_id, scenario.vehicleA.id);
assert.equal(realtimeRow.correlation_id, secondCorrelation);

// 4. Real RLS rejection (not just the app-level municipality_id guard): same municipality, but a
// vehicle this driver has no vehicle_assignments row for. driver_insert_own_vehicle_position's
// EXISTS(...) finds nothing, so Postgres itself must deny the insert.
const unassignedPoint = { ...scoped(simulator.emit()), vehicle_id: vehicleA2.data.id };
const rejected = await telemetry.ingest(unassignedPoint, { correlation_id: randomUUID() });
assert.equal(rejected.ok, false, 'driver must not be able to write telemetry for a vehicle they are not assigned to');
assert.notEqual(rejected.error?.code, 'CROSS_TENANT_TELEMETRY', 'rejection must come from RLS at the database, not the app-level municipality_id guard');

console.log('telemetry-realtime ok');
process.exit(0);

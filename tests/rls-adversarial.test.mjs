// SW-020: real adversarial RLS checks against a running local Supabase/Postgres instance —
// each role actually attempting to read/write across municipality_id and confirming the database
// (not application code) rejects what it must reject. Requires `npx supabase start` first; see
// docs/SW020_CLAUDE_CODE_TASK_BRIEF.md section 0. This replaces, not complements, the static
// regex matching in tests/rls-static.test.mjs for the RLS behaviors it covers.
import assert from 'node:assert/strict';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient, createAnonClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

const adminAClient = await createSignedInClient(env, scenario.adminA.email, scenario.adminA.password);
const dispatcherAClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverAClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const adminBClient = await createSignedInClient(env, scenario.adminB.email, scenario.adminB.password);

// 1. Cross-tenant read: admin B must not see municipality A's vehicles.
{
  const { data, error } = await adminBClient.from('vehicles').select('*').eq('id', scenario.vehicleA.id);
  assert.equal(error, null, `unexpected error: ${error?.message}`);
  assert.equal(data.length, 0, 'admin B should not read municipality A vehicles');
}

// 2. Cross-tenant write: admin B must not update municipality A's vehicle, even via its own id.
{
  const { data, error } = await adminBClient.from('vehicles').update({ state: 'maintenance' }).eq('id', scenario.vehicleA.id).select('*');
  assert.equal(error, null, `unexpected error: ${error?.message}`);
  assert.equal(data.length, 0, 'admin B should not be able to update municipality A vehicle');
  const check = await service.from('vehicles').select('state').eq('id', scenario.vehicleA.id).single();
  assert.notEqual(check.data.state, 'maintenance', 'cross-tenant update must not have applied');
}

// 3. Cross-tenant write via forged municipality_id: admin B tries to insert a vehicle claiming municipality A.
{
  const { error } = await adminBClient.from('vehicles').insert({ municipality_id: scenario.municipalityA.id, code: `FORGED-${Date.now()}` });
  assert.ok(error, 'admin B must not be able to insert a vehicle into municipality A');
}

// 4. Own-tenant write: dispatcher A (staff) CAN update municipality A's route.
{
  const { data, error } = await dispatcherAClient.from('routes').update({ status: 'assigned' }).eq('id', scenario.routeA.id).select('*').single();
  assert.equal(error, null, `dispatcher A should be able to update its own municipality route: ${error?.message}`);
  assert.equal(data.status, 'assigned');
}

// 5. Driver scoping: driver A must NOT be able to insert/update vehicles (staff-only table).
// A RLS-blocked update matches zero rows rather than erroring, so assert on the empty result and
// confirm via the service client that nothing actually changed.
{
  const { data, error } = await driverAClient.from('vehicles').update({ state: 'stopped' }).eq('id', scenario.vehicleA.id).select('*');
  assert.equal(error, null, `unexpected error: ${error?.message}`);
  assert.equal(data.length, 0, 'driver must not be able to write to vehicles (not covered by driver_* policies)');
  const check = await service.from('vehicles').select('state').eq('id', scenario.vehicleA.id).single();
  assert.notEqual(check.data.state, 'stopped', 'driver-attempted vehicle update must not have applied');
}

// 6. Driver scoping: driver A CAN start/progress their own route_run, but not set it to 'verified'
// (routes.verify is supervisor-only per PERMISSIONS.driver in shared/auth-context.js).
{
  const routeRun = await service.from('route_runs').insert({ municipality_id: scenario.municipalityA.id, route_id: scenario.routeA.id, vehicle_id: scenario.vehicleA.id, driver_id: scenario.driverRowA.id, status: 'assigned' }).select('*').single();
  assert.equal(routeRun.error, null, `seed route_run failed: ${routeRun.error?.message}`);

  const started = await driverAClient.from('route_runs').update({ status: 'started' }).eq('id', routeRun.data.id).select('*').single();
  assert.equal(started.error, null, `driver should be able to start their own route_run: ${started.error?.message}`);
  assert.equal(started.data.status, 'started');

  // USING passes (it's the driver's own route_run) but WITH CHECK rejects the target status, so
  // Postgres raises a real RLS error here rather than silently matching zero rows.
  const verifyAttempt = await driverAClient.from('route_runs').update({ status: 'verified' }).eq('id', routeRun.data.id).select('*');
  assert.ok(verifyAttempt.error, 'driver must not be able to set route_run status to verified');
}

// 7. Driver scoping: driver A cannot update a route_run that belongs to a different driver.
{
  const otherDriverProfile = await service.auth.admin.createUser({ email: `driver-a2-${Date.now()}@sw020.test`, password: 'sw020-local-test-pass-1234', email_confirm: true });
  assert.equal(otherDriverProfile.error, null);
  await service.from('profiles').insert({ id: otherDriverProfile.data.user.id, display_name: 'Driver A2' });
  await service.from('memberships').insert({ municipality_id: scenario.municipalityA.id, profile_id: otherDriverProfile.data.user.id, role: 'driver', status: 'active' });
  const otherDriverRow = await service.from('drivers').insert({ municipality_id: scenario.municipalityA.id, profile_id: otherDriverProfile.data.user.id, display_name: 'Driver A2' }).select('*').single();
  const otherRouteRun = await service.from('route_runs').insert({ municipality_id: scenario.municipalityA.id, route_id: scenario.routeA.id, driver_id: otherDriverRow.data.id, status: 'assigned' }).select('*').single();

  const attempt = await driverAClient.from('route_runs').update({ status: 'started' }).eq('id', otherRouteRun.data.id).select('*');
  assert.equal(attempt.error, null, `unexpected error: ${attempt.error?.message}`);
  assert.equal(attempt.data.length, 0, "driver must not be able to update another driver's route_run");
}

// 8. Anonymous citizen report insert: allowed with valid shape, denied with an abusive shape.
// No SELECT policy is granted to anon on citizen_reports (see supabase/migrations/202607150006_
// sw020_rls_fixes.sql), so callers must NOT chain .select() on the insert: PostgREST does
// INSERT ... RETURNING under the hood, and when the inserted row isn't visible under the caller's
// SELECT policy it reports that as an RLS violation on the insert itself, even though the insert
// succeeded. Confirmed independently against a scratch table before writing this assertion.
{
  const anon = createAnonClient(env);
  const folio = `SW-FOLIO-${Date.now()}`;

  const validInsert = await anon.from('citizen_reports').insert({ municipality_id: scenario.municipalityA.id, folio, type: 'missed_pickup', channel: 'web', status: 'received', description: 'No pasó el camión' });
  assert.equal(validInsert.error, null, `anon insert should succeed: ${validInsert.error?.message}`);
  const persisted = await service.from('citizen_reports').select('*').eq('folio', folio).single();
  assert.equal(persisted.error, null);
  assert.equal(persisted.data.status, 'received');

  const preResolvedInsert = await anon.from('citizen_reports').insert({ municipality_id: scenario.municipalityA.id, folio: `SW-FOLIO-BAD-${Date.now()}`, type: 'missed_pickup', channel: 'web', status: 'resolved' });
  assert.ok(preResolvedInsert.error, 'anon must not be able to insert a pre-resolved report');

  const internalChannelInsert = await anon.from('citizen_reports').insert({ municipality_id: scenario.municipalityA.id, folio: `SW-FOLIO-BAD2-${Date.now()}`, type: 'missed_pickup', channel: 'internal', status: 'received' });
  assert.ok(internalChannelInsert.error, 'anon must not be able to insert via the internal channel');
}

console.log('rls-adversarial ok');

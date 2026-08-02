// SW-020: exercises the full operational cycle (create route -> assign vehicle/driver via
// route_runs/vehicle_assignments -> start -> progress -> complete -> verify) against a real local
// Supabase instance, through the reconciled shared/operations-adapter.js and
// resolveSupabaseAuthContext (shared/auth-context.js). Requires `npx supabase start`; see
// docs/SW020_CLAUDE_CODE_TASK_BRIEF.md section 0.
import assert from 'node:assert/strict';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { resolveSupabaseAuthContext, can } from '../shared/auth-context.js';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const adminClient = await createSignedInClient(env, scenario.adminA.email, scenario.adminA.password);

const dispatcherCtx = await resolveSupabaseAuthContext(dispatcherClient, { municipality_id: scenario.municipalityA.id });
assert.equal(dispatcherCtx.role, 'dispatcher');
assert.ok(can(dispatcherCtx, 'routes.assign'));

const driverCtx = await resolveSupabaseAuthContext(driverClient, { municipality_id: scenario.municipalityA.id });
assert.equal(driverCtx.role, 'driver');
assert.ok(can(driverCtx, 'routes.start'));
assert.ok(can(driverCtx, 'routes.progress'));
assert.ok(!can(driverCtx, 'routes.verify'), 'driver must not have routes.verify permission');

const dispatcherAdapter = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });
const driverAdapter = createSupabaseOperationsAdapter(driverClient, { municipality_id: scenario.municipalityA.id });
const adminAdapter = createSupabaseOperationsAdapter(adminClient, { municipality_id: scenario.municipalityA.id });

// 1. Dispatcher creates a route (route definition).
const created = await dispatcherAdapter.createRoute({ name: 'SW-020 ciclo operativo' });
assert.equal(created.ok, true, `createRoute failed: ${JSON.stringify(created.error)}`);
assert.equal(created.data.status, 'planned');
const routeId = created.data.id;

// 2. Dispatcher assigns vehicle and driver — this opens the route_run and vehicle_assignments row.
const assignedVehicle = await dispatcherAdapter.assignVehicle(routeId, scenario.vehicleA.id);
assert.equal(assignedVehicle.ok, true, `assignVehicle failed: ${JSON.stringify(assignedVehicle.error)}`);
assert.equal(assignedVehicle.data.status, 'assigned');

const assignedDriver = await dispatcherAdapter.assignDriver(routeId, scenario.driverRowA.id);
assert.equal(assignedDriver.ok, true, `assignDriver failed: ${JSON.stringify(assignedDriver.error)}`);

const routeRunCheck = await service.from('route_runs').select('*').eq('route_id', routeId).single();
assert.equal(routeRunCheck.data.vehicle_id, scenario.vehicleA.id);
assert.equal(routeRunCheck.data.driver_id, scenario.driverRowA.id);
assert.equal(routeRunCheck.data.status, 'assigned');

const assignmentCheck = await service.from('vehicle_assignments').select('*').eq('route_run_id', routeRunCheck.data.id).single();
assert.equal(assignmentCheck.error, null, `vehicle_assignments row missing: ${assignmentCheck.error?.message}`);
assert.equal(assignmentCheck.data.vehicle_id, scenario.vehicleA.id);
assert.equal(assignmentCheck.data.driver_id, scenario.driverRowA.id);
assert.equal(assignmentCheck.data.status, 'assigned');

// 3. Driver starts the route — writes to route_runs, allowed by driver_update_own_route_run.
const started = await driverAdapter.startRoute(routeId);
assert.equal(started.ok, true, `startRoute failed: ${JSON.stringify(started.error)}`);
assert.equal(started.data.status, 'started');

// 4. Driver reports progress.
const progressed = await driverAdapter.updateProgress(routeId, 50);
assert.equal(progressed.ok, true, `updateProgress failed: ${JSON.stringify(progressed.error)}`);
assert.equal(progressed.data.status, 'in_progress');
// SW-030: route_runs.progress used to have no column to persist to, so this numeric value was
// silently discarded (docs/TECHNICAL_DEBT_REGISTER.md item 4) — assert it actually landed.
assert.equal(progressed.data.progress, 50, 'progress must persist on route_runs, not be discarded');

// 5. Driver completes the route.
const completed = await driverAdapter.completeRoute(routeId);
assert.equal(completed.ok, true, `completeRoute failed: ${JSON.stringify(completed.error)}`);
assert.equal(completed.data.status, 'completed');

// 6. Driver reports an incident tied to their own route_run (driver_insert_own_incident policy).
const incident = await driverAdapter.registerIncident({ route_run_id: routeRunCheck.data.id, vehicle_id: scenario.vehicleA.id, type: 'missed_pickup', description: 'Contenedor bloqueado' });
assert.equal(incident.ok, true, `registerIncident failed: ${JSON.stringify(incident.error)}`);
assert.equal(incident.data.route_run_id, routeRunCheck.data.id);

// 7. Driver must NOT be able to verify (supervisor-only per PERMISSIONS.driver); dispatcher/admin can.
const driverVerifyAttempt = await driverAdapter.verifyRoute(routeId);
assert.equal(driverVerifyAttempt.ok, false, 'driver must not be able to verify a route');

const verified = await adminAdapter.verifyRoute(routeId);
assert.equal(verified.ok, true, `verifyRoute failed: ${JSON.stringify(verified.error)}`);
assert.equal(verified.data.status, 'verified');

const finalRouteRun = await service.from('route_runs').select('*').eq('id', routeRunCheck.data.id).single();
assert.equal(finalRouteRun.data.status, 'verified');

console.log('operational-cycle ok');

// SW-027: exercises real route_paths persistence (shared/operations-adapter.js's
// savePathPoints()/listPathPoints()) against a local Supabase instance, mirroring the same
// createRoute -> generateRouteStopPoints -> saveRouteStops flow tests/route-stops-persistence.
// test.mjs already covers, but starting from a hand-drawn path (a raw [[lat,lng], ...] array, not a
// routePaths id) — the exact flow the "Crear ruta" UI drives. Requires `npx supabase start`; see
// docs/SW020_CLAUDE_CODE_TASK_BRIEF.md section 0.
import assert from 'node:assert/strict';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints } from '../shared/route-engine.js';

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const dispatcherAdapter = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });
const driverAdapter = createSupabaseOperationsAdapter(driverClient, { municipality_id: scenario.municipalityA.id });

// 1. Dispatcher creates a route for a hand-drawn trace (no routePaths id involved at all).
const created = await dispatcherAdapter.createRoute({ name: 'SW-027 ruta dibujada' });
assert.equal(created.ok, true, `createRoute failed: ${JSON.stringify(created.error)}`);
const routeId = created.data.id;

const drawnPath = [[19.6500, -71.1000], [19.6510, -71.1010], [19.6520, -71.1020], [19.6530, -71.1030]];

// 2. Persist the drawn geometry.
const pathSave = await dispatcherAdapter.savePathPoints(routeId, drawnPath.map(([latitude, longitude], index) => ({ sequence: index + 1, latitude, longitude })));
assert.equal(pathSave.ok, true, `savePathPoints failed: ${JSON.stringify(pathSave.error)}`);
assert.equal(pathSave.data.length, drawnPath.length);

const persistedPath = await service.from('route_paths').select('*').eq('route_id', routeId).order('sequence');
assert.equal(persistedPath.error, null, `route_paths rows missing: ${persistedPath.error?.message}`);
assert.equal(persistedPath.data.length, drawnPath.length);
assert.deepEqual(persistedPath.data.map((row) => row.sequence), drawnPath.map((_, i) => i + 1));
assert.ok(persistedPath.data.every((row) => row.municipality_id === scenario.municipalityA.id));

const listedPath = await dispatcherAdapter.listPathPoints(routeId);
assert.equal(listedPath.ok, true, `listPathPoints failed: ${JSON.stringify(listedPath.error)}`);
assert.equal(listedPath.data.length, drawnPath.length);

// 3. generateRouteStopPoints()/saveRouteStops() — the same SW-025/026 functions, called on the
// drawn path directly (not reimplemented for this case).
const stopPoints = generateRouteStopPoints(drawnPath);
const stopsSave = await dispatcherAdapter.saveRouteStops(routeId, stopPoints);
assert.equal(stopsSave.ok, true, `saveRouteStops failed: ${JSON.stringify(stopsSave.error)}`);
assert.equal(stopsSave.data.length, stopPoints.length);

const listedStops = await dispatcherAdapter.listRouteStops(routeId);
assert.equal(listedStops.ok, true, `listRouteStops failed: ${JSON.stringify(listedStops.error)}`);
assert.equal(listedStops.data.length, stopPoints.length);

// 4. Real RLS rejection: route_paths only grants tenant_insert_staff to municipal_admin/supervisor/
// dispatcher (202607150009_sw027_route_paths.sql, same 3 roles as route_stops) — a driver must not
// be able to draw/save a route's geometry.
const driverAttempt = await driverAdapter.savePathPoints(routeId, [{ sequence: 99, latitude: 19.66, longitude: -71.11 }]);
assert.equal(driverAttempt.ok, false, 'driver must not be able to write route_paths');

console.log('route-paths-persistence ok');

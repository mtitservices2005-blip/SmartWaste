import { trucks, routes, drivers, incidents, routePaths } from './demo-data.js';
import { canTransitionRoute } from './contracts.js';
import { deriveStopStatus, haversineMeters } from './route-engine.js';

// This adapter (createSupabaseOperationsAdapter, below) is the single entry point for operating
// on routes/route_runs/vehicle_assignments — see docs/CORE_READINESS_REVIEW.md. When MT Workflow
// (MTIT-OS Core) exists, this is the module that would internally call CreateWorkOrder()/
// AssignWorkOrder()/CompleteWorkOrder()/VerifyWorkOrder()/CloseWorkOrder() instead of writing to
// route_runs directly — callers of this adapter should not need to change.

const ok = (data, meta = {}) => ({ ok: true, data, source: meta.source ?? 'REAL', correlation_id: meta.correlation_id ?? null });
const fail = (code, message, meta = {}) => ({ ok: false, error: { code, message }, source: meta.source ?? 'REAL', correlation_id: meta.correlation_id ?? null });
const table = (client, name) => client.from(name);

const clone = (value) => structuredClone(value);
export function createDemoOperationsAdapter(seed = { trucks, routes, drivers, incidents, routeStops: [], routePaths: [] }) {
  const state = clone(seed);
  if (!state.routeStops) state.routeStops = [];
  if (!state.routePaths) state.routePaths = [];
  return {
    mode: 'DEMO_ONLY',
    listVehicles: () => clone(state.trucks),
    listDrivers: () => clone(state.drivers ?? drivers),
    getVehicle: (id) => clone(state.trucks.find((v) => v.id === id) ?? null),
    // SW-031: same shape frontend/app.js already expects from shared/demo-data.js's trucks array
    // (unit/state/driverId/routeId/etc.) — a freshly registered vehicle has no route yet, so it
    // starts 'offline' like the demo's own unassigned truck-05, not 'active'.
    createVehicle: (vehicle) => {
      const created = {
        id: vehicle.id ?? `demo-vehicle-${state.trucks.length + 1}-${Date.now().toString(36)}`,
        unit: vehicle.unit ?? `SW-NEW-${state.trucks.length + 1}`, name: vehicle.name ?? vehicle.unit ?? 'Vehículo nuevo',
        plate: vehicle.plate ?? '', state: vehicle.state ?? 'offline', driverId: null, routeId: null,
        progress: 0, speedKmh: 0, updatedAt: 'Recién creado', sector: 'Sin asignar', nextStop: 'Sin asignar', loadLevel: 0, positionIndex: 0,
        ...vehicle
      };
      state.trucks.push(created);
      return clone(created);
    },
    updateVehicle: (id, patch) => { const vehicle = state.trucks.find((v) => v.id === id); if (!vehicle) throw new Error('Vehicle not found'); Object.assign(vehicle, patch); return clone(vehicle); },
    // Registered without a login account (profile_id equivalent is left unset here) — provisioning
    // real access is a separate, Supabase-only concern (see docs/TECHNICAL_DEBT_REGISTER.md / the
    // SW-031/SW-032 plan split), not something the demo adapter can meaningfully model.
    createDriver: (driver) => {
      if (!state.drivers) state.drivers = clone(drivers);
      const created = { id: driver.id ?? `demo-driver-${state.drivers.length + 1}-${Date.now().toString(36)}`, name: driver.name ?? 'Chofer nuevo', phone: driver.phone ?? '', status: driver.status ?? 'Disponible', ...driver };
      state.drivers.push(created);
      return clone(created);
    },
    listRoutes: () => clone(state.routes),
    getRoute: (id) => clone(state.routes.find((r) => r.id === id) ?? null),
    createRoute: (route) => { const created = { id: route.id ?? `demo-route-${state.routes.length + 1}-${Date.now().toString(36)}`, status:'planned', progress:0, incidents:[], ...route }; state.routes.push(created); return clone(created); },
    // Points already carry `sequence` (see shared/route-engine.js's generateRouteStopPoints()) —
    // this just stamps them with route_id and an id, same shape a real route_stops row would have.
    saveRouteStops: (routeId, points) => {
      const saved = points.map((point, index) => ({ id: `demo-stop-${routeId}-${state.routeStops.length + index + 1}`, route_id: routeId, ...point }));
      state.routeStops.push(...saved);
      return clone(saved);
    },
    listRouteStops: (routeId) => clone(state.routeStops.filter((stop) => stop.route_id === routeId).sort((a, b) => a.sequence - b.sequence)),
    // SW-027: persists a route's drawn geometry (route_paths) — same shape/pattern as
    // saveRouteStops/listRouteStops above, just for the raw drawn line instead of derived
    // collection points.
    savePathPoints: (routeId, points) => {
      const saved = points.map((point, index) => ({ id: `demo-path-${routeId}-${state.routePaths.length + index + 1}`, route_id: routeId, ...point }));
      state.routePaths.push(...saved);
      return clone(saved);
    },
    listPathPoints: (routeId) => clone(state.routePaths.filter((point) => point.route_id === routeId).sort((a, b) => a.sequence - b.sequence)),
    assignVehicle: (routeId, vehicleId) => updateRoute(state, routeId, { truckId: vehicleId, status:'assigned' }),
    assignDriver: (routeId, driverId) => updateRoute(state, routeId, { driverId, status:'assigned' }),
    startRoute: (routeId) => transitionRoute(state, routeId, 'started'),
    updateProgress: (routeId, progress) => updateRoute(state, routeId, { progress, status: progress >= 100 ? 'completed' : 'in_progress' }),
    markDelayed: (routeId) => transitionRoute(state, routeId, 'delayed'),
    completeRoute: (routeId) => updateRoute(state, routeId, { progress:100, status:'completed' }),
    verifyRoute: (routeId) => transitionRoute(state, routeId, 'verified'),
    registerIncident: (incident) => { const created = { code:`INC-${state.incidents.length + 1}`, status:'Abierta', priority:'Media', ...incident }; state.incidents.push(created); return clone(created); },
    listPositions: () => state.trucks.map((truck) => ({ vehicle_id: truck.id, municipality_id:'laguna-salada-rd', position: truck.position ?? routePaths[truck.routeId]?.[truck.positionIndex ?? 0] ?? null, source:'demo' })),
    // SW-042: demo trucks already carry driverId directly (see shared/demo-data.js) rather than
    // through a separate join table — listVehicleAssignments() derives the same {vehicle_id,
    // driver_id, status} shape the real adapter reads from vehicle_assignments, so callers (e.g.
    // frontend/app.js's fleet panel) don't need to branch on adapter mode to read "who drives this
    // truck". assignDriverToVehicle() clears the driver from any other truck first — a driver
    // drives one truck at a time in this model, same constraint the real adapter enforces below.
    listVehicleAssignments: () => state.trucks.filter((truck) => truck.driverId).map((truck) => ({ vehicle_id: truck.id, driver_id: truck.driverId, status:'assigned' })),
    assignDriverToVehicle: (vehicleId, driverId) => {
      const vehicle = state.trucks.find((v) => v.id === vehicleId);
      if (!vehicle) throw new Error('Vehicle not found');
      state.trucks.forEach((truck) => { if (truck.driverId === driverId) truck.driverId = null; });
      vehicle.driverId = driverId;
      return clone(vehicle);
    },
    // Roadmap item 3 ("GPS real"): resolving "which real vehicle is assigned to this signed-in
    // driver" only makes sense once a real Supabase profile/vehicle_assignments row exists — the
    // demo adapter has no such concept to model, so this always fails. The GPS button in
    // frontend/app.js only renders once a real backend is configured anyway, so this path is never
    // exercised in demo-only mode; it exists purely so both adapters expose the same interface.
    findOwnVehicleAssignment: () => ({ ok:false, source:'DEMO_ONLY', error:{ code:'NOT_SUPPORTED_IN_DEMO', message:'Vehicle assignment lookup requires a real backend.' } })
  };
}
// SW-044: stamps started_at/completed_at the first time a route reaches that status — mirrors the
// real adapter's transitionRouteRun() below, so a demo route's "duración medida" (started_at to
// completed_at) works the same way a real one's does, off the browser's own clock rather than
// Supabase's. Never overwrites an existing timestamp (idempotent against a route re-completing via
// a second call, however that might happen).
function stampRouteTiming(route, status) {
  if (status === 'started' && !route.started_at) route.started_at = new Date().toISOString();
  if (status === 'completed' && !route.completed_at) route.completed_at = new Date().toISOString();
}
function updateRoute(state, routeId, patch) { const route = state.routes.find((r) => r.id === routeId); if (!route) throw new Error('Route not found'); Object.assign(route, patch); if (patch.status) stampRouteTiming(route, patch.status); return clone(route); }
function transitionRoute(state, routeId, next) { const route = state.routes.find((r) => r.id === routeId); if (!route) throw new Error('Route not found'); if (!canTransitionRoute(route.status, next)) throw new Error(`Rejected route transition ${route.status}->${next}`); route.status = next; stampRouteTiming(route, next); return clone(route); }

export function createSupabaseOperationsAdapter(client, { fallback = createDemoOperationsAdapter(), municipality_id = null } = {}) {
  const hasClient = Boolean(client?.from);
  const requireClient = (correlation_id) => hasClient ? null : fail('SUPABASE_CLIENT_MISSING', 'Supabase client is not available; using explicit demo fallback only.', { source:'DEMO_FALLBACK', correlation_id });
  const scoped = (query) => municipality_id ? query.eq('municipality_id', municipality_id) : query;
  const run = async (operation, fallbackOperation, correlation_id) => {
    const missing = requireClient(correlation_id);
    if (missing) return ok(await fallbackOperation(), { source:'DEMO_FALLBACK', correlation_id });
    try {
      const result = await operation();
      if (result.error) return fail(result.error.code ?? 'SUPABASE_ERROR', result.error.message, { correlation_id });
      return ok(result.data, { correlation_id });
    } catch (error) {
      return fail('ADAPTER_EXCEPTION', error.message, { correlation_id });
    }
  };
  const selectOne = (name, id) => scoped(table(client, name).select('*')).eq('id', id).maybeSingle();
  return {
    mode: hasClient ? 'REAL' : 'DEMO_FALLBACK',
    listVehicles: (opts = {}) => run(() => scoped(table(client, 'vehicles').select('*').order('code')), () => fallback.listVehicles(), opts.correlation_id),
    getVehicle: (id, opts = {}) => run(() => selectOne('vehicles', id), () => fallback.getVehicle(id), opts.correlation_id),
    createVehicle: (vehicle, opts = {}) => run(() => table(client, 'vehicles').insert({ ...vehicle, municipality_id: vehicle.municipality_id ?? municipality_id }).select('*').single(), () => ({ ...vehicle, id: vehicle.id ?? `demo-${Date.now()}` }), opts.correlation_id),
    updateVehicle: (id, patch, opts = {}) => run(() => {
      let q = scoped(table(client, 'vehicles').update(patch).eq('id', id));
      if (opts.version !== undefined) q = q.eq('version', opts.version);
      return q.select('*').single();
    }, () => ({ ...fallback.getVehicle(id), ...patch }), opts.correlation_id),
    listDrivers: (opts = {}) => run(() => scoped(table(client, 'drivers').select('*').order('display_name')), () => clone(fallback.listDrivers?.() ?? drivers), opts.correlation_id),
    createDriver: (driver, opts = {}) => run(() => table(client, 'drivers').insert({ ...driver, municipality_id: driver.municipality_id ?? municipality_id }).select('*').single(), () => ({ ...driver, id: driver.id ?? `demo-driver-${Date.now()}` }), opts.correlation_id),
    listRoutes: (opts = {}) => run(() => scoped(table(client, 'routes').select('*').order('created_at')), () => fallback.listRoutes(), opts.correlation_id),
    getRoute: (id, opts = {}) => run(() => selectOne('routes', id), () => fallback.getRoute(id), opts.correlation_id),
    createRoute: (route, opts = {}) => run(() => table(client, 'routes').insert({ ...route, municipality_id: route.municipality_id ?? municipality_id, status: route.status ?? 'planned' }).select('*').single(), () => fallback.createRoute(route), opts.correlation_id),
    updateRoute: (id, patch, opts = {}) => run(() => {
      let q = scoped(table(client, 'routes').update(patch).eq('id', id));
      if (opts.version !== undefined) q = q.eq('version', opts.version);
      return q.select('*').single();
    }, () => ({ ...fallback.getRoute(id), ...patch }), opts.correlation_id),
    // Execution lives in route_runs (one row per dispatch of a route), not on routes itself —
    // routes only has route_id/status/etc as the route *definition*. assignVehicle/assignDriver
    // open or reuse the route's active route_run and mirror the assignment into
    // vehicle_assignments. See docs/CURRENT_STATE_AUDIT.md and supabase/migrations/202607150001_sw007_foundation.sql.
    assignVehicle: (routeId, vehicleId, opts = {}) => assignToRouteRun(client, fallback, municipality_id, routeId, { vehicle_id: vehicleId }, opts, () => fallback.assignVehicle(routeId, vehicleId)),
    assignDriver: (routeId, driverId, opts = {}) => assignToRouteRun(client, fallback, municipality_id, routeId, { driver_id: driverId }, opts, () => fallback.assignDriver(routeId, driverId)),
    startRoute: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'started', opts),
    updateProgress: (routeId, progress, opts = {}) => hasClient
      ? transitionRouteRun(client, fallback, municipality_id, routeId, progress >= 100 ? 'completed' : 'in_progress', opts, { progress })
      : ok(fallback.updateProgress(routeId, progress), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id }),
    markDelayed: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'delayed', opts),
    completeRoute: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'completed', opts, { progress: 100 }),
    verifyRoute: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'verified', opts),
    // SW-035 fase B: every other route_runs write above (assignVehicle/assignDriver/startRoute/
    // updateProgress/...) only ever transitions a single route_run by id — nothing previously
    // needed to read them back in bulk. Hydrating routes with their real assignment/progress on
    // page load does, since vehicle_id/driver_id/progress/status live on route_runs, not on routes
    // itself (see the comment on assignVehicle above). Ordered oldest-first so a caller building a
    // route_id -> latest route_run map by iterating and overwriting ends up with the most recent
    // one per route, same "most recent" intent transitionRouteRun()/assignToRouteRun() already
    // apply per-route via their own separate queries.
    listRouteRuns: (opts = {}) => run(() => scoped(table(client, 'route_runs').select('*').order('created_at')), () => fallback.listRouteRuns?.() ?? [], opts.correlation_id),
    registerIncident: (incident, opts = {}) => run(() => table(client, 'incidents').insert({ ...incident, municipality_id: incident.municipality_id ?? municipality_id, correlation_id: opts.correlation_id ?? incident.correlation_id }).select('*').single(), () => fallback.registerIncident(incident), opts.correlation_id),
    listPositions: (opts = {}) => run(() => scoped(table(client, 'vehicle_positions').select('*').order('captured_at', { ascending:false })), () => fallback.listPositions(), opts.correlation_id),
    // SW-036: the dispatcher-facing map needs one row per vehicle (its most recent real position),
    // not the full history listPositions() above returns. The Supabase JS client has no "distinct
    // on" without an RPC/view, so this dedupes client-side over the same already-ordered-by-
    // captured_at-desc query — first occurrence per vehicle_id wins, same pragmatic approach
    // listRouteStopsWithStatus() below already uses over listPositions()'s bulk result.
    // neq('source','simulator') is defensive (nothing writes that source today) but documents the
    // intent: only real positions (browser_geolocation today, driver_app/dedicated_tracker/
    // external_authorized once those sources exist) should ever reach this method.
    listLatestPositions: async (opts = {}) => {
      const result = await run(() => scoped(table(client, 'vehicle_positions').select('*').neq('source', 'simulator').order('captured_at', { ascending:false })), () => fallback.listPositions(), opts.correlation_id);
      if (!result.ok) return result;
      const seen = new Set();
      const data = result.data.filter((row) => { if (seen.has(row.vehicle_id)) return false; seen.add(row.vehicle_id); return true; });
      return { ...result, data };
    },
    // Points come from shared/route-engine.js's generateRouteStopPoints()/splitIntoTrips() —
    // already sequence-ordered and, if the caller split by trip, flattened back into one list
    // before calling this (route_stops has no trip concept, only route_id + sequence).
    saveRouteStops: (routeId, points, opts = {}) => run(
      () => table(client, 'route_stops').insert(points.map((point) => ({
        route_id: routeId,
        municipality_id: municipality_id,
        sequence: point.sequence,
        label: point.label,
        latitude: point.latitude,
        longitude: point.longitude
      }))).select('*'),
      () => fallback.saveRouteStops(routeId, points),
      opts.correlation_id
    ),
    listRouteStops: (routeId, opts = {}) => run(
      () => scoped(table(client, 'route_stops').select('*')).eq('route_id', routeId).order('sequence'),
      () => fallback.listRouteStops(routeId),
      opts.correlation_id
    ),
    // Derives each stop's pending/recolectado status from real recorded vehicle_positions for
    // vehicleId (see route-engine.js's deriveStopStatus) — no status column needed on route_stops.
    // vehicleId is the caller's responsibility to resolve (e.g. from the route's active
    // vehicle_assignments row) rather than re-deriving it here, to keep this method's scope to
    // "stops + positions -> status" only.
    async listRouteStopsWithStatus(routeId, vehicleId, opts = {}) {
      const stopsResult = await run(
        () => scoped(table(client, 'route_stops').select('*')).eq('route_id', routeId).order('sequence'),
        () => fallback.listRouteStops(routeId),
        opts.correlation_id
      );
      if (!stopsResult.ok) return stopsResult;
      const positionsResult = await run(() => scoped(table(client, 'vehicle_positions').select('*').order('captured_at', { ascending:false })), () => fallback.listPositions(), opts.correlation_id);
      // deriveStopStatus() now checks trail SEGMENTS and requires chronological (oldest-first)
      // order — the query above orders descending (most-recent-first, right for other display
      // uses), so re-sort ascending here rather than change what every other caller of listPositions
      // gets.
      const vehiclePositions = positionsResult.ok
        ? positionsResult.data.filter((position) => position.vehicle_id === vehicleId).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
        : [];
      return ok(stopsResult.data.map((stop) => ({ ...stop, status: deriveStopStatus(stop, vehiclePositions) })), opts);
    },
    // SW-027: persists a route's drawn geometry (route_paths) — same pattern as
    // saveRouteStops/listRouteStops above, just for the raw drawn line instead of derived
    // collection points.
    savePathPoints: (routeId, points, opts = {}) => run(
      () => table(client, 'route_paths').insert(points.map((point) => ({
        route_id: routeId,
        municipality_id: municipality_id,
        sequence: point.sequence,
        latitude: point.latitude,
        longitude: point.longitude
      }))).select('*'),
      () => fallback.savePathPoints(routeId, points),
      opts.correlation_id
    ),
    listPathPoints: (routeId, opts = {}) => run(
      () => scoped(table(client, 'route_paths').select('*')).eq('route_id', routeId).order('sequence'),
      () => fallback.listPathPoints(routeId),
      opts.correlation_id
    ),
    // Roadmap item 3 ("GPS real"): resolves the real vehicle_id currently assigned to the signed-in
    // driver (by their auth profile_id), so frontend/app.js's GPS button knows which vehicle_id to
    // tag positions with before calling createTelemetryIngestionAdapter().ingest(). Two-step lookup
    // (drivers -> vehicle_assignments), so it doesn't fit the single-query run() wrapper above.
    findOwnVehicleAssignment: (profileId, opts = {}) => findOwnVehicleAssignment(client, municipality_id, profileId, opts),
    // SW-042 (docs/TECHNICAL_DEBT_REGISTER.md #24): there was no way to read or create a
    // driver<->vehicle link from the frontend at all — vehicle_assignments could only be written
    // directly against Supabase (what scripts/seed-local.mjs/seed-remote.mjs do). listVehicleAssignments()
    // lets hydrateVehiclesAndDrivers() (frontend/app.js) resolve each hydrated truck's real driver
    // instead of always showing "Sin asignar"; assignDriverToVehicle() is the write side, wired to
    // the new "Asignar chofer" control in the truck detail panel.
    listVehicleAssignments: (opts = {}) => run(
      () => scoped(table(client, 'vehicle_assignments').select('*')).eq('status', 'assigned'),
      () => fallback.listVehicleAssignments(),
      opts.correlation_id
    ),
    assignDriverToVehicle: (vehicleId, driverId, opts = {}) => assignDriverToVehicle(client, fallback, municipality_id, vehicleId, driverId, opts),
    // SW-058 (docs/TECHNICAL_DEBT_REGISTER.md #23): citizen_reports already gets real writes from
    // submitCitizenReport() (shared/citizen-portal.js), but nothing ever read them back — the
    // Supervisor panel only ever showed the local demo `incidents` array, so a real citizen report
    // had no way to reach a dispatcher at all. No demo equivalent exists (the demo panel's
    // "incidencias" are a separate, unrelated concept, see shared/demo-data.js), so the demo
    // fallback is an empty list rather than fallback.listCitizenReports() — same
    // no-op-in-demo-mode posture as findOwnVehicleAssignment() above.
    listCitizenReports: (opts = {}) => run(
      () => scoped(table(client, 'citizen_reports').select('*')).neq('status', 'resolved').order('created_at', { ascending: false }),
      () => [],
      opts.correlation_id
    ),
    // No demo fallback here (unlike run()-based methods above): there is no demo concept of a
    // citizen_reports row to mutate, so this fails explicitly rather than silently no-op'ing —
    // same posture as findOwnVehicleAssignment() above, which run() can't express since its
    // fallbackOperation result always gets wrapped in ok().
    updateCitizenReportStatus: async (reportId, status, opts = {}) => {
      if (!hasClient) return fail('NOT_SUPPORTED_IN_DEMO', 'Citizen report resolution requires a real backend.', { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
      const result = await scoped(table(client, 'citizen_reports').update({ status }).eq('id', reportId)).select('*').single();
      if (result.error) return fail(result.error.code ?? 'SUPABASE_ERROR', result.error.message, { correlation_id: opts.correlation_id });
      return ok(result.data, { correlation_id: opts.correlation_id });
    }
  };
}

async function findOwnVehicleAssignment(client, municipality_id, profileId, opts = {}) {
  if (!client?.from) return fail('SUPABASE_CLIENT_MISSING', 'No real client available.', { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  const scoped = (query) => municipality_id ? query.eq('municipality_id', municipality_id) : query;
  const driverRow = await scoped(client.from('drivers').select('id')).eq('profile_id', profileId).maybeSingle();
  if (driverRow.error) return fail(driverRow.error.code ?? 'SUPABASE_ERROR', driverRow.error.message, { correlation_id: opts.correlation_id });
  if (!driverRow.data) return fail('DRIVER_NOT_FOUND', 'No driver row is linked to this account.', { correlation_id: opts.correlation_id });
  const assignment = await scoped(client.from('vehicle_assignments').select('vehicle_id')).eq('driver_id', driverRow.data.id).eq('status', 'assigned').maybeSingle();
  if (assignment.error) return fail(assignment.error.code ?? 'SUPABASE_ERROR', assignment.error.message, { correlation_id: opts.correlation_id });
  if (!assignment.data) return fail('NO_VEHICLE_ASSIGNED', 'This driver has no vehicle currently assigned.', { correlation_id: opts.correlation_id });
  return ok(assignment.data, { correlation_id: opts.correlation_id });
}

// SW-042: creates the driver<->vehicle link a despachador makes from the truck detail panel.
// vehicle_assignments has no unique/exclusion constraint stopping two "assigned" rows for the same
// vehicle or the same driver (see supabase/migrations/202607150001_sw007_foundation.sql), so this
// ends any other active assignment for either side first — a truck has one driver, a driver drives
// one truck, matching the model the demo adapter's trucks[].driverId already assumes. Two update
// calls (not one .or()) to keep the same eq()-chaining style as the rest of this file. Not a single
// query, so — like findOwnVehicleAssignment() above — it doesn't fit the run() wrapper.
async function assignDriverToVehicle(client, fallback, municipality_id, vehicleId, driverId, opts = {}) {
  if (!client?.from) return ok(fallback.assignDriverToVehicle(vehicleId, driverId), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  const scoped = (query) => municipality_id ? query.eq('municipality_id', municipality_id) : query;
  try {
    const endVehicle = await scoped(client.from('vehicle_assignments').update({ status: 'reassigned' })).eq('vehicle_id', vehicleId).eq('status', 'assigned');
    if (endVehicle.error) return fail(endVehicle.error.code ?? 'SUPABASE_ERROR', endVehicle.error.message, { correlation_id: opts.correlation_id });
    const endDriver = await scoped(client.from('vehicle_assignments').update({ status: 'reassigned' })).eq('driver_id', driverId).eq('status', 'assigned');
    if (endDriver.error) return fail(endDriver.error.code ?? 'SUPABASE_ERROR', endDriver.error.message, { correlation_id: opts.correlation_id });
    const inserted = await client.from('vehicle_assignments').insert({ municipality_id, vehicle_id: vehicleId, driver_id: driverId, status: 'assigned' }).select('*').single();
    if (inserted.error) return fail(inserted.error.code ?? 'SUPABASE_ERROR', inserted.error.message, { correlation_id: opts.correlation_id });
    // SW-056: route_runs.driver_id is what listRouteRuns()-based aggregation
    // (summarizeRouteRunsByDriver(), shared/route-run-stats.js) actually reads — nothing ever wrote
    // it before this, so "Por chofer" in Estadísticas (SW-047) stayed empty forever no matter how
    // many times a driver was assigned via this exact function (vehicle_assignments IS updated
    // correctly, it's just a different table than the one the stats query reads). Best-effort, same
    // posture as SW-045's distance computation: stamp the driver onto the vehicle's current active
    // (non-terminal) route_run, if it has one; any failure here is swallowed in its own try/catch so
    // it can never turn the vehicle_assignments write that already succeeded above into a reported
    // failure.
    try {
      const activeRun = await scoped(client.from('route_runs').select('id')).eq('vehicle_id', vehicleId).not('status', 'in', '("completed","verified","cancelled")').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (activeRun.data) await client.from('route_runs').update({ driver_id: driverId }).eq('id', activeRun.data.id);
    } catch { /* best-effort, see comment above */ }
    return ok(inserted.data, { correlation_id: opts.correlation_id });
  } catch (error) {
    return fail('ADAPTER_EXCEPTION', error.message, { correlation_id: opts.correlation_id });
  }
}

// Finds the most recent non-terminal route_run for a route, or creates one, scoped to municipality_id.
async function findOrCreateActiveRouteRun(client, municipality_id, routeId) {
  let findQuery = client.from('route_runs').select('*').eq('route_id', routeId).not('status', 'in', '("completed","verified","cancelled")').order('created_at', { ascending: false }).limit(1);
  if (municipality_id) findQuery = findQuery.eq('municipality_id', municipality_id);
  const existing = await findQuery.maybeSingle();
  if (existing.error) return existing;
  if (existing.data) return existing;
  const routeQuery = municipality_id ? client.from('routes').select('*').eq('municipality_id', municipality_id).eq('id', routeId).maybeSingle() : client.from('routes').select('*').eq('id', routeId).maybeSingle();
  const route = await routeQuery;
  if (route.error) return route;
  if (!route.data) return { data: null, error: null };
  return client.from('route_runs').insert({ route_id: routeId, municipality_id: route.data.municipality_id }).select('*').single();
}

async function assignToRouteRun(client, fallback, municipality_id, routeId, patch, opts = {}, fallbackOperation) {
  const missing = !client?.from;
  if (missing) return ok(fallbackOperation(), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  try {
    const routeRun = await findOrCreateActiveRouteRun(client, municipality_id, routeId);
    if (routeRun.error) return fail(routeRun.error.code ?? 'SUPABASE_ERROR', routeRun.error.message, opts);
    if (!routeRun.data) return fail('ROUTE_NOT_FOUND', 'Route not found', opts);
    // SW-056: covers the reverse order from the fix in assignDriverToVehicle() above — a vehicle
    // assigned to a route (this function, via assignVehicle()) that already had a driver paired to
    // it beforehand. Without this, that driver would only ever land in vehicle_assignments, never
    // on the route_run the stats query actually reads. Best-effort/never blocks the assignment
    // itself; only fills driver_id when the caller didn't already pass one explicitly.
    // route_run_id IS NULL restricts this to the persistent vehicle<->driver pairing: once this
    // function runs once for a vehicle, it also leaves behind a route_run_id-tagged 'assigned' row
    // below (line ~358) that is never flipped to 'reassigned', so on a repeat run the lookup would
    // otherwise match both rows and maybeSingle() would silently fail (multiple rows found).
    let driverPatch = {};
    if (patch.vehicle_id && !patch.driver_id) {
      try {
        let assignmentQuery = client.from('vehicle_assignments').select('driver_id').eq('vehicle_id', patch.vehicle_id).eq('status', 'assigned').is('route_run_id', null);
        if (municipality_id) assignmentQuery = assignmentQuery.eq('municipality_id', municipality_id);
        const currentAssignment = await assignmentQuery.maybeSingle();
        if (currentAssignment.data?.driver_id) driverPatch = { driver_id: currentAssignment.data.driver_id };
      } catch { /* best-effort, see comment above */ }
    }
    const updated = await client.from('route_runs').update({ ...patch, ...driverPatch, status: 'assigned' }).eq('id', routeRun.data.id).select('*').single();
    if (updated.error) return fail(updated.error.code ?? 'SUPABASE_ERROR', updated.error.message, opts);
    const vehicle_id = patch.vehicle_id ?? updated.data.vehicle_id;
    const driver_id = patch.driver_id ?? updated.data.driver_id;
    if (vehicle_id) {
      const existingAssignment = await client.from('vehicle_assignments').select('*').eq('route_run_id', updated.data.id).maybeSingle();
      if (existingAssignment.error) return fail(existingAssignment.error.code ?? 'SUPABASE_ERROR', existingAssignment.error.message, opts);
      const assignmentPatch = { municipality_id: updated.data.municipality_id, vehicle_id, driver_id, route_run_id: updated.data.id, status: 'assigned' };
      const assignment = existingAssignment.data
        ? await client.from('vehicle_assignments').update(assignmentPatch).eq('id', existingAssignment.data.id).select('*').single()
        : await client.from('vehicle_assignments').insert(assignmentPatch).select('*').single();
      if (assignment.error) return fail(assignment.error.code ?? 'SUPABASE_ERROR', assignment.error.message, opts);
    }
    // Only advance the route definition's status out of 'planned'; a second assignVehicle/assignDriver
    // call (or one made after the route already started) must not roll routes.status backwards.
    let routeQ = client.from('routes').update({ status: 'assigned' }).eq('id', routeId).eq('status', 'planned');
    if (municipality_id) routeQ = routeQ.eq('municipality_id', municipality_id);
    const routeUpdate = await routeQ.select('*').maybeSingle();
    if (routeUpdate.error) return fail(routeUpdate.error.code ?? 'SUPABASE_ERROR', routeUpdate.error.message, opts);
    if (routeUpdate.data) return ok(routeUpdate.data, opts);
    const routeSelect = municipality_id ? client.from('routes').select('*').eq('municipality_id', municipality_id).eq('id', routeId).maybeSingle() : client.from('routes').select('*').eq('id', routeId).maybeSingle();
    const routeCurrent = await routeSelect;
    if (routeCurrent.error) return fail(routeCurrent.error.code ?? 'SUPABASE_ERROR', routeCurrent.error.message, opts);
    return ok(routeCurrent.data, opts);
  } catch (error) {
    return fail('ADAPTER_EXCEPTION', error.message, opts);
  }
}

// Route status transitions during execution (start/progress/delay/complete/verify) are recorded on
// route_runs, the execution record — not on routes, the route definition. This also keeps driver-
// initiated transitions (start/progress) inside what the driver RLS policy on route_runs allows;
// routes stays staff-write-only (see supabase/migrations/202607150006_sw020_rls_fixes.sql).
// patch carries fields beyond {status} to write in the same update — currently only updateProgress's
// numeric progress (route_runs has no column for it otherwise the value was silently discarded, see
// docs/TECHNICAL_DEBT_REGISTER.md item 4).
async function transitionRouteRun(client, fallback, municipality_id, routeId, next, opts = {}, patch = {}) {
  const adapterMissing = !client?.from;
  const fallbackMethod = { started:'startRoute', delayed:'markDelayed', completed:'completeRoute', verified:'verifyRoute', in_progress:'updateProgress' }[next] ?? 'markDelayed';
  if (adapterMissing) return ok(fallback[fallbackMethod]?.(routeId) ?? fallback.getRoute(routeId), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  let findQuery = client.from('route_runs').select('*').eq('route_id', routeId).order('created_at', { ascending: false }).limit(1);
  if (municipality_id) findQuery = findQuery.eq('municipality_id', municipality_id);
  const current = await findQuery.maybeSingle();
  if (current.error) return fail(current.error.code ?? 'SUPABASE_ERROR', current.error.message, opts);
  if (!current.data) return fail('ROUTE_RUN_NOT_FOUND', 'No route_run found for route; assign it first', opts);
  if (!canTransitionRoute(current.data.status, next)) return fail('INVALID_ROUTE_TRANSITION', `Rejected route transition ${current.data.status}->${next}`, opts);
  // SW-044: stamps started_at/completed_at (supabase/migrations/202607150012_sw044_route_run_timing.sql)
  // the first time this route_run reaches that status — never overwrites an already-set timestamp
  // (e.g. a route re-completing through updateProgress(100) after completeRoute() already ran).
  // Ordered before ...patch so an explicit patch value (none of today's callers pass one) would win.
  const timingPatch = {};
  if (next === 'started' && !current.data.started_at) timingPatch.started_at = new Date().toISOString();
  if (next === 'completed' && !current.data.completed_at) timingPatch.completed_at = new Date().toISOString();
  // SW-045: sums the real GPS trail (vehicle_positions, already collected whenever the driver
  // shared their location — SW-036) into an actual distance for this run, the same "measured, not
  // estimated" upgrade SW-044 did for duration. Best-effort: any failure here (query error, fewer
  // than 2 points to measure a distance between) just leaves distance_meters unstamped — the UI
  // falls back to the route's drawn/estimated distance, same as it always has. Never blocks the
  // completion itself; this runs after started_at/completed_at are already decided above.
  if (next === 'completed' && !current.data.distance_meters && current.data.vehicle_id && current.data.started_at) {
    const positionsResult = await client.from('vehicle_positions').select('latitude,longitude,captured_at')
      .eq('vehicle_id', current.data.vehicle_id).neq('source', 'simulator').gte('captured_at', current.data.started_at).order('captured_at', { ascending: true });
    if (!positionsResult.error && positionsResult.data?.length >= 2) {
      const points = positionsResult.data.map((row) => [row.latitude, row.longitude]);
      const distanceMeters = points.slice(1).reduce((total, point, index) => total + haversineMeters(points[index], point), 0);
      timingPatch.distance_meters = Math.round(distanceMeters);
    }
  }
  let q = client.from('route_runs').update({ status: next, ...timingPatch, ...patch }).eq('id', current.data.id);
  if (opts.version !== undefined) q = q.eq('version', opts.version);
  const updated = await q.select('*').single();
  if (updated.error) return fail(updated.error.code ?? 'SUPABASE_ERROR', updated.error.message, opts);
  return ok(updated.data, opts);
}

export const operationsAdapter = createDemoOperationsAdapter();

// SW-034: the runtime switch between demo and real Supabase — same opt-in shape as
// frontend/auth-gate.js's readSupabaseConfig() (no client -> demo, exactly like today; a client ->
// real). Kept as a plain factory rather than a singleton so callers control exactly when/with what
// municipality_id it gets built (only known once the session's auth context resolves).
export function resolveOperationsAdapter({ client, municipality_id } = {}) {
  return client ? createSupabaseOperationsAdapter(client, { municipality_id }) : createDemoOperationsAdapter();
}

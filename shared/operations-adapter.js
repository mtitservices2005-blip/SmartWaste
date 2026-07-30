import { trucks, routes, drivers, incidents, routePaths } from './demo-data.js';
import { canTransitionRoute } from './contracts.js';

const ok = (data, meta = {}) => ({ ok: true, data, source: meta.source ?? 'REAL', correlation_id: meta.correlation_id ?? null });
const fail = (code, message, meta = {}) => ({ ok: false, error: { code, message }, source: meta.source ?? 'REAL', correlation_id: meta.correlation_id ?? null });
const table = (client, name) => client.from(name);

const clone = (value) => structuredClone(value);
export function createDemoOperationsAdapter(seed = { trucks, routes, drivers, incidents }) {
  const state = clone(seed);
  return {
    mode: 'DEMO_ONLY',
    listVehicles: () => clone(state.trucks),
    listDrivers: () => clone(state.drivers ?? drivers),
    getVehicle: (id) => clone(state.trucks.find((v) => v.id === id) ?? null),
    listRoutes: () => clone(state.routes),
    getRoute: (id) => clone(state.routes.find((r) => r.id === id) ?? null),
    createRoute: (route) => { const created = { status:'planned', progress:0, incidents:[], ...route }; state.routes.push(created); return clone(created); },
    assignVehicle: (routeId, vehicleId) => updateRoute(state, routeId, { truckId: vehicleId, status:'assigned' }),
    assignDriver: (routeId, driverId) => updateRoute(state, routeId, { driverId, status:'assigned' }),
    startRoute: (routeId) => transitionRoute(state, routeId, 'started'),
    updateProgress: (routeId, progress) => updateRoute(state, routeId, { progress, status: progress >= 100 ? 'completed' : 'in_progress' }),
    markDelayed: (routeId) => transitionRoute(state, routeId, 'delayed'),
    completeRoute: (routeId) => updateRoute(state, routeId, { progress:100, status:'completed' }),
    verifyRoute: (routeId) => transitionRoute(state, routeId, 'verified'),
    registerIncident: (incident) => { const created = { code:`INC-${state.incidents.length + 1}`, status:'Abierta', priority:'Media', ...incident }; state.incidents.push(created); return clone(created); },
    listPositions: () => state.trucks.map((truck) => ({ vehicle_id: truck.id, municipality_id:'laguna-salada-rd', position: truck.position ?? routePaths[truck.routeId]?.[truck.positionIndex ?? 0] ?? null, source:'demo' }))
  };
}
function updateRoute(state, routeId, patch) { const route = state.routes.find((r) => r.id === routeId); if (!route) throw new Error('Route not found'); Object.assign(route, patch); return clone(route); }
function transitionRoute(state, routeId, next) { const route = state.routes.find((r) => r.id === routeId); if (!route) throw new Error('Route not found'); if (!canTransitionRoute(route.status, next)) throw new Error(`Rejected route transition ${route.status}->${next}`); route.status = next; return clone(route); }

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
      ? transitionRouteRun(client, fallback, municipality_id, routeId, progress >= 100 ? 'completed' : 'in_progress', opts)
      : ok(fallback.updateProgress(routeId, progress), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id }),
    markDelayed: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'delayed', opts),
    completeRoute: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'completed', opts),
    verifyRoute: (routeId, opts = {}) => transitionRouteRun(client, fallback, municipality_id, routeId, 'verified', opts),
    registerIncident: (incident, opts = {}) => run(() => table(client, 'incidents').insert({ ...incident, municipality_id: incident.municipality_id ?? municipality_id, correlation_id: opts.correlation_id ?? incident.correlation_id }).select('*').single(), () => fallback.registerIncident(incident), opts.correlation_id),
    listPositions: (opts = {}) => run(() => scoped(table(client, 'vehicle_positions').select('*').order('captured_at', { ascending:false })), () => fallback.listPositions(), opts.correlation_id)
  };
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
    const updated = await client.from('route_runs').update({ ...patch, status: 'assigned' }).eq('id', routeRun.data.id).select('*').single();
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
async function transitionRouteRun(client, fallback, municipality_id, routeId, next, opts = {}) {
  const adapterMissing = !client?.from;
  const fallbackMethod = { started:'startRoute', delayed:'markDelayed', completed:'completeRoute', verified:'verifyRoute', in_progress:'updateProgress' }[next] ?? 'markDelayed';
  if (adapterMissing) return ok(fallback[fallbackMethod]?.(routeId) ?? fallback.getRoute(routeId), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  let findQuery = client.from('route_runs').select('*').eq('route_id', routeId).order('created_at', { ascending: false }).limit(1);
  if (municipality_id) findQuery = findQuery.eq('municipality_id', municipality_id);
  const current = await findQuery.maybeSingle();
  if (current.error) return fail(current.error.code ?? 'SUPABASE_ERROR', current.error.message, opts);
  if (!current.data) return fail('ROUTE_RUN_NOT_FOUND', 'No route_run found for route; assign it first', opts);
  if (!canTransitionRoute(current.data.status, next)) return fail('INVALID_ROUTE_TRANSITION', `Rejected route transition ${current.data.status}->${next}`, opts);
  let q = client.from('route_runs').update({ status: next }).eq('id', current.data.id);
  if (opts.version !== undefined) q = q.eq('version', opts.version);
  const updated = await q.select('*').single();
  if (updated.error) return fail(updated.error.code ?? 'SUPABASE_ERROR', updated.error.message, opts);
  return ok(updated.data, opts);
}

export const operationsAdapter = createDemoOperationsAdapter();

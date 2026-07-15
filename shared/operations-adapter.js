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
    assignVehicle: async (routeId, vehicleId, opts = {}) => {
      const current = hasClient ? (await selectOne('routes', routeId)).data : fallback.getRoute(routeId);
      if (current && !canTransitionRoute(current.status, 'assigned') && current.status !== 'assigned') return fail('INVALID_ROUTE_TRANSITION', `Rejected route transition ${current.status}->assigned`, opts);
      return run(() => scoped(table(client, 'routes').update({ vehicle_id: vehicleId, status:'assigned' }).eq('id', routeId)).select('*').single(), () => fallback.assignVehicle(routeId, vehicleId), opts.correlation_id);
    },
    assignDriver: (routeId, driverId, opts = {}) => run(() => scoped(table(client, 'routes').update({ driver_id: driverId, status:'assigned' }).eq('id', routeId)).select('*').single(), () => fallback.assignDriver(routeId, driverId), opts.correlation_id),
    startRoute: (routeId, opts = {}) => transitionPersistedRoute(client, fallback, municipality_id, routeId, 'started', opts),
    updateProgress: (routeId, progress, opts = {}) => run(() => scoped(table(client, 'routes').update({ progress, status: progress >= 100 ? 'completed' : 'in_progress' }).eq('id', routeId)).select('*').single(), () => fallback.updateProgress(routeId, progress), opts.correlation_id),
    markDelayed: (routeId, opts = {}) => transitionPersistedRoute(client, fallback, municipality_id, routeId, 'delayed', opts),
    completeRoute: (routeId, opts = {}) => run(() => scoped(table(client, 'routes').update({ progress:100, status:'completed' }).eq('id', routeId)).select('*').single(), () => fallback.completeRoute(routeId), opts.correlation_id),
    verifyRoute: (routeId, opts = {}) => transitionPersistedRoute(client, fallback, municipality_id, routeId, 'verified', opts),
    registerIncident: (incident, opts = {}) => run(() => table(client, 'incidents').insert({ ...incident, municipality_id: incident.municipality_id ?? municipality_id, correlation_id: opts.correlation_id ?? incident.correlation_id }).select('*').single(), () => fallback.registerIncident(incident), opts.correlation_id),
    listPositions: (opts = {}) => run(() => scoped(table(client, 'vehicle_positions').select('*').order('captured_at', { ascending:false })), () => fallback.listPositions(), opts.correlation_id)
  };
}

async function transitionPersistedRoute(client, fallback, municipality_id, routeId, next, opts = {}) {
  const adapterMissing = !client?.from;
  if (adapterMissing) return ok(fallback[next === 'started' ? 'startRoute' : next === 'delayed' ? 'markDelayed' : 'verifyRoute'](routeId), { source:'DEMO_FALLBACK', correlation_id: opts.correlation_id });
  const currentQuery = municipality_id ? client.from('routes').select('*').eq('municipality_id', municipality_id).eq('id', routeId).maybeSingle() : client.from('routes').select('*').eq('id', routeId).maybeSingle();
  const current = await currentQuery;
  if (current.error) return fail(current.error.code ?? 'SUPABASE_ERROR', current.error.message, opts);
  if (!current.data) return fail('ROUTE_NOT_FOUND', 'Route not found', opts);
  if (!canTransitionRoute(current.data.status, next)) return fail('INVALID_ROUTE_TRANSITION', `Rejected route transition ${current.data.status}->${next}`, opts);
  let q = client.from('routes').update({ status: next }).eq('id', routeId);
  if (municipality_id) q = q.eq('municipality_id', municipality_id);
  if (opts.version !== undefined) q = q.eq('version', opts.version);
  const updated = await q.select('*').single();
  if (updated.error) return fail(updated.error.code ?? 'SUPABASE_ERROR', updated.error.message, opts);
  return ok(updated.data, opts);
}

export const operationsAdapter = createDemoOperationsAdapter();

import { trucks, routes, drivers, incidents, routePaths } from './demo-data.js';
import { canTransitionRoute } from './contracts.js';

const clone = (value) => structuredClone(value);
export function createDemoOperationsAdapter(seed = { trucks, routes, drivers, incidents }) {
  const state = clone(seed);
  return {
    mode: 'DEMO_ONLY',
    listVehicles: () => clone(state.trucks),
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
export const operationsAdapter = createDemoOperationsAdapter();

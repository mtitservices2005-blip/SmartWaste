// SW-048: single derived "what's blocking this route" badge, replacing the need to read 3
// separate fields (status pill + "Unidad asignada" text + "Conductor" text) to figure out whether
// a route can start. Pure — never persisted, recomputed fresh from route+truck on every render.
// Only overrides the pill for the pre-start window (planned/assigned); once a route is actually
// running or finished, its existing status (started/in_progress/delayed/completed/verified/
// cancelled) is already meaningful on its own and is left untouched by returning null, so the
// caller falls back to the pre-existing routeStatus(route) pill exactly as before.
export function routeReadinessStage(route, truck) {
  if (route.status !== 'planned' && route.status !== 'assigned') return null;
  if (!truck) return 'needs_vehicle';
  if (!truck.driverId) return 'needs_driver';
  return 'ready';
}

export const ROUTE_READINESS_LABELS = {
  needs_vehicle: 'Falta vehículo',
  needs_driver: 'Falta chofer',
  ready: 'Listo para iniciar',
};

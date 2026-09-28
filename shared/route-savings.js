// SW-030: "ruta optimizada vs manual" comparison for the Centro de Impacto y Ahorros — reuses the
// existing route engine (shared/route-optimizer.js's optimizeWaypointOrder(), roadmap item 2, and
// shared/route-engine.js's haversineMeters()) instead of inventing a second distance/optimization
// algorithm. Given a route's real, persisted stops (in the order they were drawn/saved —
// shared/operations-adapter.js's listRouteStops(), already sequence-ordered), this computes what
// that same set of stops would have cost as drawn ("manual") vs. what optimizeWaypointOrder() would
// have produced ("optimizado"), starting from the same first stop.
import { optimizeWaypointOrder } from './route-optimizer.js';
import { haversineMeters } from './route-engine.js';

function pathDistanceMeters(path) {
  return path.slice(1).reduce((total, point, index) => total + haversineMeters(path[index], point), 0);
}

// Fewer than 3 stops has nothing to reorder (same threshold optimizeWaypointOrder() itself uses) —
// returns an all-zero, non-comparable result rather than a misleading 0%.
export function compareManualVsOptimizedRoute(stops, { fixedStart = true } = {}) {
  if (!Array.isArray(stops) || stops.length < 3) {
    return { manualDistanceMeters: 0, optimizedDistanceMeters: 0, savedMeters: 0, savedPercent: 0, comparable: false };
  }
  const manualPath = stops.map((stop) => [stop.latitude, stop.longitude]);
  const optimizedPath = optimizeWaypointOrder(manualPath, { fixedStart });
  const manualDistanceMeters = pathDistanceMeters(manualPath);
  const optimizedDistanceMeters = pathDistanceMeters(optimizedPath);
  // optimizeWaypointOrder() already guarantees it never returns a worse order than the input (see
  // docs/TECHNICAL_DEBT_REGISTER.md item #21) — this clamp is defensive, not load-bearing.
  const savedMeters = Math.max(0, Math.round(manualDistanceMeters - optimizedDistanceMeters));
  const savedPercent = manualDistanceMeters ? Math.round((savedMeters / manualDistanceMeters) * 1000) / 10 : 0;
  return { manualDistanceMeters: Math.round(manualDistanceMeters), optimizedDistanceMeters: Math.round(optimizedDistanceMeters), savedMeters, savedPercent, comparable: true };
}

// Aggregates the comparison above across every real route's stop list the caller has fetched.
// Routes with fewer than 3 stops are excluded from the average (nothing to compare), not counted
// as a 0%-savings route — a caller passing an empty/all-too-short list gets null back, meaning
// "no comparable data" (frontend/app.js shows "pendiente de datos" for that, not a fabricated 0%).
export function aggregateRouteSavings(routeStopsList) {
  const results = (routeStopsList ?? []).map((stops) => compareManualVsOptimizedRoute(stops)).filter((result) => result.comparable);
  if (!results.length) return null;
  const totals = results.reduce((acc, r) => ({
    manualDistanceMeters: acc.manualDistanceMeters + r.manualDistanceMeters,
    optimizedDistanceMeters: acc.optimizedDistanceMeters + r.optimizedDistanceMeters,
    savedMeters: acc.savedMeters + r.savedMeters
  }), { manualDistanceMeters: 0, optimizedDistanceMeters: 0, savedMeters: 0 });
  const savedPercent = totals.manualDistanceMeters ? Math.round((totals.savedMeters / totals.manualDistanceMeters) * 1000) / 10 : 0;
  return { ...totals, savedPercent, routesCompared: results.length };
}

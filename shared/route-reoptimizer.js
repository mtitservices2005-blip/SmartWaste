// "Reoptimización dinámica" (roadmap ítem 4, final): given a truck's current position and its
// route's still-pending stops, suggests a shorter visiting order. Deliberately a SUGGESTION only —
// it never writes anywhere. shared/operations-adapter.js's saveRouteStops()/savePathPoints() are
// insert-only on both adapters (no replace/delete), and a route's covered/pending stop counts are
// static values set once at creation, never updated by the simulation tick (only route.progress %
// updates live) — persisting a reordered stop list safely would need both of those solved first.
// Applying the suggestion is a deliberate future increment, not done here (docs/
// TECHNICAL_DEBT_REGISTER.md item #21).
//
// Pure, no I/O — reuses shared/route-optimizer.js's optimizeWaypointOrder() (already built for
// route creation) rather than reimplementing the heuristic, and shared/route-engine.js's
// haversineMeters() for the before/after distance comparison.
import { optimizeWaypointOrder } from './route-optimizer.js';
import { haversineMeters } from './route-engine.js';

function pairwiseDistance(path) {
  return path.slice(1).reduce((total, point, index) => total + haversineMeters(path[index], point), 0);
}

// currentPosition: [lat,lng] (the truck's live position, e.g. frontend/app.js's routePosition()).
// pendingStops: stop objects with {latitude, longitude, ...}, in their current persisted order.
// Returns the same stop objects reordered (never new objects, never mutated), plus the distance
// comparison that justifies the suggestion.
export function suggestReoptimizedOrder(currentPosition, pendingStops, { fixedStart = true } = {}) {
  if (!Array.isArray(pendingStops) || pendingStops.length < 2) {
    return { order: pendingStops ? pendingStops.slice() : [], currentDistanceMeters: 0, optimizedDistanceMeters: 0, savedMeters: 0 };
  }
  const waypoints = [currentPosition, ...pendingStops.map((stop) => [stop.latitude, stop.longitude])];
  const currentDistanceMeters = pairwiseDistance(waypoints);
  const optimizedWaypoints = optimizeWaypointOrder(waypoints, { fixedStart });
  const optimizedDistanceMeters = pairwiseDistance(optimizedWaypoints);
  // The nearest-neighbor + 2-opt heuristic in optimizeWaypointOrder() only ever improves on its
  // own nearest-neighbor seed — it never compares against the original input order, so it can
  // still land on a result that's worse than what the dispatcher already has (Codex review on
  // PR #46). Never suggest a longer route than the current one: fall back to the existing order.
  if (optimizedDistanceMeters >= currentDistanceMeters) {
    return { order: pendingStops.slice(), currentDistanceMeters, optimizedDistanceMeters: currentDistanceMeters, savedMeters: 0 };
  }
  // optimizeWaypointOrder() returns coordinates, not the original stop objects — match each
  // optimized coordinate back to its stop by lat/lng. A route can legitimately visit the same
  // coordinate more than once (e.g. returning to the depot) — a plain coordinate->stop Map would
  // collapse those into one stop and silently drop another (Codex review on PR #46), so queue
  // same-coordinate stops and consume them in order instead.
  const byCoordinate = new Map();
  pendingStops.forEach((stop) => {
    const key = `${stop.latitude},${stop.longitude}`;
    if (!byCoordinate.has(key)) byCoordinate.set(key, []);
    byCoordinate.get(key).push(stop);
  });
  const order = optimizedWaypoints.slice(1).map((point) => byCoordinate.get(`${point[0]},${point[1]}`).shift());
  return { order, currentDistanceMeters, optimizedDistanceMeters, savedMeters: currentDistanceMeters - optimizedDistanceMeters };
}

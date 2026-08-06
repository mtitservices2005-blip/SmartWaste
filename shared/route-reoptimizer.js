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
  // optimizeWaypointOrder() returns coordinates, not the original stop objects — match each
  // optimized coordinate back to its stop by lat/lng (unique per stop in practice; a route never
  // has two collection points at the exact same coordinate).
  const byCoordinate = new Map(pendingStops.map((stop) => [`${stop.latitude},${stop.longitude}`, stop]));
  const order = optimizedWaypoints.slice(1).map((point) => byCoordinate.get(`${point[0]},${point[1]}`));
  return { order, currentDistanceMeters, optimizedDistanceMeters, savedMeters: currentDistanceMeters - optimizedDistanceMeters };
}

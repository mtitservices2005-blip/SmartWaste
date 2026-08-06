// "Optimización de orden" (roadmap ítem 2): reorders a hand-drawn set of waypoints
// ([[lat,lng],...], click order) to reduce total straight-line (haversine) distance BEFORE they're
// sent to OSRM for street-snapping (shared/osrm-routing.js) — this is about deciding visit ORDER,
// not geometry, so it's deliberately its own module rather than living in shared/route-engine.js,
// whose generateRouteStopPoints() explicitly never reorders (it walks an already-decided path).
//
// Algorithm: nearest-neighbor construction (fixed start) + 2-opt local search, not an exact TSP
// solver. Dispatcher-drawn routes are realistically 2-30 waypoints (a person clicking a map), and
// at that scale nearest-neighbor + 2-opt lands close to optimal in microseconds — enough for a
// synchronous browser call with no visible jank. Exact TSP (factorial/exponential) buys nothing
// visible at this input size and risks noticeable UI stalls as point count grows. Pure CPU, no
// I/O — unlike shared/osrm-routing.js this needs no injected fetch and runs synchronously.
import { haversineMeters } from './route-engine.js';

function totalPathDistance(path) {
  return path.slice(1).reduce((total, point, index) => total + haversineMeters(path[index], point), 0);
}

// waypoints: [[lat,lng],...] in click order. fixedStart pins index 0 (the dispatcher's first
// click, typically the depot/garage) — only the remaining points are reordered. Always returns a
// new array; never mutates the input.
export function optimizeWaypointOrder(waypoints, { fixedStart = true } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 3) return waypoints ? waypoints.slice() : [];

  const startIndex = fixedStart ? 1 : 0;
  const fixed = fixedStart ? [waypoints[0]] : [];
  const remaining = waypoints.slice(startIndex);

  // Nearest-neighbor construction over `remaining`, starting from the last fixed point (or the
  // first remaining point itself when there's no fixed start).
  const ordered = [];
  const pool = remaining.slice();
  let anchor;
  if (fixedStart) {
    anchor = waypoints[0];
  } else {
    anchor = pool.shift();
    ordered.push(anchor);
  }
  while (pool.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const distance = haversineMeters(anchor, pool[i]);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
    }
    anchor = pool[bestIndex];
    ordered.push(anchor);
    pool.splice(bestIndex, 1);
  }

  // 2-opt: repeatedly try reversing segments of `ordered` (the reorderable tail only) and keep any
  // reversal that shortens the fixed+ordered path. Capped passes guard against pathological inputs
  // spinning for a long time — in practice this converges in a handful of passes at this scale.
  const maxPasses = 40;
  let improved = true;
  let passes = 0;
  while (improved && passes < maxPasses) {
    improved = false;
    passes += 1;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const candidate = ordered.slice(0, i).concat(ordered.slice(i, j + 1).reverse(), ordered.slice(j + 1));
        if (totalPathDistance(fixed.concat(candidate)) < totalPathDistance(fixed.concat(ordered)) - 1e-9) {
          ordered.splice(0, ordered.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  return fixed.concat(ordered);
}

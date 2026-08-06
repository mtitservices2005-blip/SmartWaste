// Roadmap item 2 ("optimización de orden de paradas"): unit coverage for
// shared/route-optimizer.js — pure geometry, no I/O, so no mocking needed (contrast with
// tests/osrm-routing.test.mjs, which needs an injected fetchImpl for its network call).
import assert from 'node:assert/strict';
import { optimizeWaypointOrder } from '../shared/route-optimizer.js';
import { haversineMeters } from '../shared/route-engine.js';

function totalDistance(path) {
  return path.slice(1).reduce((total, point, index) => total + haversineMeters(path[index], point), 0);
}

// 1. Fixed-start invariant: the first waypoint (the dispatcher's first click / depot) must never move.
const fourPoints = [[19.60, -71.00], [19.61, -71.05], [19.58, -71.02], [19.63, -71.08]];
assert.deepEqual(optimizeWaypointOrder(fourPoints)[0], fourPoints[0], 'first point must stay fixed by default');
assert.deepEqual(optimizeWaypointOrder(fourPoints, { fixedStart: true })[0], fourPoints[0]);

// 2. Small-input no-ops: nothing to reorder below 3 points.
assert.deepEqual(optimizeWaypointOrder([]), []);
assert.deepEqual(optimizeWaypointOrder([[1, 2]]), [[1, 2]]);
assert.deepEqual(optimizeWaypointOrder([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);

// 3. Never mutates the input array.
const original = [[19.60, -71.00], [19.61, -71.05], [19.58, -71.02]];
const originalCopy = original.map((p) => p.slice());
optimizeWaypointOrder(original);
assert.deepEqual(original, originalCopy, 'input must not be mutated');

// 4. Already-optimal input (straight line, click order matches visiting order) should not get worse.
const straightLine = [[19.60, -71.00], [19.61, -71.00], [19.62, -71.00], [19.63, -71.00]];
const optimizedStraight = optimizeWaypointOrder(straightLine);
assert.ok(Math.abs(totalDistance(optimizedStraight) - totalDistance(straightLine)) < 1e-6, 'an already-optimal order must not be made worse');

// 5. Real improvement: a zig-zag click order should be shortened by optimization. Depot at origin,
// then points clicked in an order that crosses back and forth rather than visiting nearest-first.
const zigzag = [
  [19.60, -71.00], // depot (fixed start)
  [19.65, -71.00], // far
  [19.61, -71.00], // near depot
  [19.66, -71.00], // far
  [19.605, -71.00] // very near depot
];
const optimizedZigzag = optimizeWaypointOrder(zigzag);
assert.ok(totalDistance(optimizedZigzag) < totalDistance(zigzag), 'optimization must reduce total distance on a zig-zag click order');
assert.deepEqual(optimizedZigzag[0], zigzag[0], 'depot must still be first after optimizing the zig-zag');

// 6. Result is always a permutation of the input: same length, same multiset of points, nothing lost or duplicated.
for (const points of [fourPoints, zigzag, straightLine]) {
  const optimized = optimizeWaypointOrder(points);
  assert.equal(optimized.length, points.length, 'optimized path must have the same number of points');
  const toKey = (p) => p.join(',');
  assert.deepEqual(optimized.map(toKey).sort(), points.map(toKey).sort(), 'optimized path must be a permutation of the input, no points lost or duplicated');
}

// 7. fixedStart:false still returns a valid permutation (not used by the UI today, but the option
// must behave sanely since the signature exposes it).
const freeOptimized = optimizeWaypointOrder(fourPoints, { fixedStart: false });
assert.equal(freeOptimized.length, fourPoints.length);
assert.deepEqual(freeOptimized.map((p) => p.join(',')).sort(), fourPoints.map((p) => p.join(',')).sort());

console.log('route-optimizer ok');

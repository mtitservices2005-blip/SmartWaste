// Roadmap item 4 ("reoptimización dinámica" — suggestion only): unit coverage for
// shared/route-reoptimizer.js. Pure geometry, no I/O, no mocking needed.
import assert from 'node:assert/strict';
import { suggestReoptimizedOrder } from '../shared/route-reoptimizer.js';

function makeStop(id, latitude, longitude) { return { id, label: `Parada ${id}`, sequence: id, latitude, longitude }; }

// 1. Real improvement: a zig-zag pending order (same layout as tests/route-optimizer.test.mjs's
// zig-zag case) must show a real, positive savedMeters.
const truckPosition = [19.60, -71.00];
const zigzagStops = [
  makeStop(1, 19.65, -71.00), // far
  makeStop(2, 19.61, -71.00), // near truck
  makeStop(3, 19.66, -71.00), // far
  makeStop(4, 19.605, -71.00) // very near truck
];
const zigzagResult = suggestReoptimizedOrder(truckPosition, zigzagStops);
assert.ok(zigzagResult.savedMeters > 0, 'a zig-zag pending order must show a real distance saving');
assert.ok(Math.abs(zigzagResult.optimizedDistanceMeters - (zigzagResult.currentDistanceMeters - zigzagResult.savedMeters)) < 1e-6, 'savedMeters must equal current minus optimized distance');
assert.equal(zigzagResult.order.length, zigzagStops.length, 'no stops lost or duplicated');
assert.deepEqual(zigzagResult.order.map((s) => s.id).slice().sort(), zigzagStops.map((s) => s.id).sort(), 'order must be a permutation of the input stops by id');
// The returned stops must be the SAME objects (round-trip identity), not copies missing fields.
zigzagResult.order.forEach((stop) => assert.ok(zigzagStops.includes(stop), 'returned stops must be references to the original stop objects'));

// 2. Fewer than 2 pending stops: nothing to optimize, zero savings, input order preserved.
assert.deepEqual(suggestReoptimizedOrder(truckPosition, []), { order: [], currentDistanceMeters: 0, optimizedDistanceMeters: 0, savedMeters: 0 });
const singleStop = [makeStop(1, 19.61, -71.00)];
const singleResult = suggestReoptimizedOrder(truckPosition, singleStop);
assert.deepEqual(singleResult.order, singleStop);
assert.equal(singleResult.savedMeters, 0);

// 3. Already-optimal pending order (straight line away from the truck): near-zero, never-negative savings.
const straightLineStops = [makeStop(1, 19.61, -71.00), makeStop(2, 19.62, -71.00), makeStop(3, 19.63, -71.00)];
const straightResult = suggestReoptimizedOrder(truckPosition, straightLineStops);
assert.ok(straightResult.savedMeters >= -1e-6, 'savings must never be negative — optimization must not make an already-good order worse');
assert.ok(straightResult.savedMeters < 1, 'an already-optimal order should show ~0 savings');

// 4. No mutation of the input stops array or its objects.
const stopsBefore = zigzagStops.map((s) => ({ ...s }));
suggestReoptimizedOrder(truckPosition, zigzagStops);
assert.deepEqual(zigzagStops, stopsBefore, 'input stops must not be mutated');

// 5. Codex review on PR #46, finding 1: a route can legitimately visit the same coordinate more
// than once (e.g. a closed loop returning to the depot). A naive coordinate->stop Map collapses
// duplicate-coordinate stops into one, silently dropping another and duplicating the first in the
// suggested order. All distinct stop objects must survive, by id, none lost or duplicated.
const depotCoordinate = [19.605, -71.00];
const closedLoopStops = [
  makeStop('mid', 19.61, -71.00),
  makeStop('far', 19.65, -71.00),
  makeStop('return', depotCoordinate[0], depotCoordinate[1])
];
// A second stop that happens to share the "return" stop's exact coordinate — the scenario Codex
// flagged (a real route can have two distinct collection points, or a return-to-depot leg, at the
// same lat/lng as another stop).
closedLoopStops.push(makeStop('return-2', depotCoordinate[0], depotCoordinate[1]));
const closedLoopResult = suggestReoptimizedOrder(truckPosition, closedLoopStops);
assert.equal(closedLoopResult.order.length, closedLoopStops.length, 'no stop lost or duplicated when coordinates collide');
assert.deepEqual(closedLoopResult.order.map((s) => s.id).sort(), closedLoopStops.map((s) => s.id).sort(), 'every distinct stop id must appear exactly once, even with duplicate coordinates');

// 6. Codex review on PR #46, finding 3: the heuristic only ever improves on its own
// nearest-neighbor seed and never compares against the original order, so it can converge on a
// result longer than what the dispatcher already has. Across a spread of synthetic layouts
// (including ones prone to bad local optima — clustered points, near-duplicate coordinates),
// savedMeters must never be negative: a suggestion must never be a step backward.
const stressLayouts = [
  [makeStop(1, 19.61, -71.00), makeStop(2, 19.611, -71.001), makeStop(3, 19.612, -71.002), makeStop(4, 19.60, -70.99)],
  [makeStop(1, 19.60, -71.00), makeStop(2, 19.60, -71.00), makeStop(3, 19.65, -71.05), makeStop(4, 19.60001, -71.00001)],
  [makeStop(1, 19.70, -71.20), makeStop(2, 19.30, -70.80), makeStop(3, 19.55, -71.10), makeStop(4, 19.45, -70.95), makeStop(5, 19.62, -71.02)]
];
for (const stops of stressLayouts) {
  const result = suggestReoptimizedOrder(truckPosition, stops);
  assert.ok(result.savedMeters >= -1e-6, 'a suggestion must never be longer than the current order');
  assert.deepEqual(result.order.map((s) => s.id).sort(), stops.map((s) => s.id).sort(), 'the fallback-to-original path must still return every stop exactly once');
}

console.log('route-reoptimizer ok');

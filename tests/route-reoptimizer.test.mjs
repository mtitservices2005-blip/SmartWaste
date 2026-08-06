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

console.log('route-reoptimizer ok');

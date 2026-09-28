// SW-030: unit coverage for shared/route-savings.js — pure geometry over optimizeWaypointOrder()/
// haversineMeters(), same no-mocking style as tests/route-optimizer.test.mjs.
import assert from 'node:assert/strict';
import { compareManualVsOptimizedRoute, aggregateRouteSavings } from '../shared/route-savings.js';

const point = (latitude, longitude) => ({ latitude, longitude });

// 1. Fewer than 3 stops: nothing to compare, not a fabricated 0%.
assert.deepEqual(compareManualVsOptimizedRoute([]), { manualDistanceMeters: 0, optimizedDistanceMeters: 0, savedMeters: 0, savedPercent: 0, comparable: false });
assert.equal(compareManualVsOptimizedRoute([point(19.6, -71.0)]).comparable, false);
assert.equal(compareManualVsOptimizedRoute([point(19.6, -71.0), point(19.61, -71.0)]).comparable, false);

// 2. Zig-zag stop order (same fixture shape as tests/route-optimizer.test.mjs): manual distance must
// be strictly worse than optimized, savings must be positive, and the first stop stays fixed
// (depot), matching optimizeWaypointOrder()'s own fixedStart guarantee.
const zigzagStops = [point(19.60, -71.00), point(19.65, -71.00), point(19.61, -71.00), point(19.66, -71.00), point(19.605, -71.00)];
const zigzagResult = compareManualVsOptimizedRoute(zigzagStops);
assert.equal(zigzagResult.comparable, true);
assert.ok(zigzagResult.optimizedDistanceMeters < zigzagResult.manualDistanceMeters, 'optimized order must be shorter than the manual click order');
assert.ok(zigzagResult.savedMeters > 0);
assert.ok(zigzagResult.savedPercent > 0);
assert.equal(zigzagResult.savedMeters, zigzagResult.manualDistanceMeters - zigzagResult.optimizedDistanceMeters);

// 3. Already-optimal order (straight line): no savings, but still comparable (not treated as
// missing data).
const straightStops = [point(19.60, -71.00), point(19.61, -71.00), point(19.62, -71.00), point(19.63, -71.00)];
const straightResult = compareManualVsOptimizedRoute(straightStops);
assert.equal(straightResult.comparable, true);
assert.equal(straightResult.savedMeters, 0);
assert.equal(straightResult.savedPercent, 0);

// 4. aggregateRouteSavings(): empty/all-too-short input means "no comparable data" (null), not a
// zeroed-out result that could be mistaken for "0% real savings measured".
assert.equal(aggregateRouteSavings([]), null);
assert.equal(aggregateRouteSavings([[point(19.6, -71.0)], [point(19.6, -71.0), point(19.61, -71.0)]]), null);

// 5. aggregateRouteSavings(): mixes a comparable zig-zag route with a too-short one — the too-short
// one must be excluded from the totals/count, not counted as a 0%-savings route.
const aggregated = aggregateRouteSavings([zigzagStops, [point(19.6, -71.0)]]);
assert.equal(aggregated.routesCompared, 1, 'the too-short route must not count toward routesCompared');
assert.equal(aggregated.manualDistanceMeters, zigzagResult.manualDistanceMeters);
assert.equal(aggregated.optimizedDistanceMeters, zigzagResult.optimizedDistanceMeters);
assert.equal(aggregated.savedMeters, zigzagResult.savedMeters);

// 6. aggregateRouteSavings(): totals sum correctly across two comparable routes.
const aggregatedTwo = aggregateRouteSavings([zigzagStops, straightStops]);
assert.equal(aggregatedTwo.routesCompared, 2);
assert.equal(aggregatedTwo.manualDistanceMeters, zigzagResult.manualDistanceMeters + straightResult.manualDistanceMeters);
assert.equal(aggregatedTwo.savedMeters, zigzagResult.savedMeters + straightResult.savedMeters);

console.log('route-savings ok');

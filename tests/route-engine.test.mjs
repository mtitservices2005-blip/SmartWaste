// SW-025: unit coverage for shared/route-engine.js — pure functions, no Supabase needed. Real
// persistence into route_stops via both adapters is covered by tests/operations-adapter.test.mjs
// (demo) and tests/route-stops-persistence.test.mjs (Supabase, integration-tests job in CI).
import assert from 'node:assert/strict';
import { generateRouteStopPoints, splitIntoTrips, deriveStopStatus, haversineMeters } from '../shared/route-engine.js';
import { routePaths } from '../shared/demo-data.js';

// 1. Generation: sequence-ordered, follows the path's own geometry (never reordered).
const points = generateRouteStopPoints('route-centro', { stepMeters: 100 });
assert.ok(points.length > routePaths['route-centro'].length, 'should generate more points than the sparse path waypoints');
points.forEach((point, index) => assert.equal(point.sequence, index + 1, 'sequence must be 1..N in generation order'));
// Monotonic progress check: each point must be strictly further along the path than the last —
// i.e. distance from the path's start point never decreases. A nearest-neighbor reordering bug
// would violate this (it could jump back toward the start).
let previousDistanceFromStart = -1;
for (const point of points) {
  const distanceFromStart = haversineMeters(routePaths['route-centro'][0], [point.latitude, point.longitude]);
  assert.ok(distanceFromStart >= previousDistanceFromStart, `point ${point.sequence} moved backward along the path`);
  previousDistanceFromStart = distanceFromStart;
}
// First/last generated points must match the path's own first/last waypoint (start and end are
// never skipped, even if they don't land exactly on a stepMeters boundary).
assert.deepEqual([points[0].latitude, points[0].longitude], routePaths['route-centro'][0]);
const lastPathPoint = routePaths['route-centro'][routePaths['route-centro'].length - 1];
assert.ok(haversineMeters([points[points.length - 1].latitude, points[points.length - 1].longitude], lastPathPoint) < 1);

assert.throws(() => generateRouteStopPoints('route-does-not-exist'), /Unknown routePath id/);

// 2. Capacity cut: falls on a point boundary, never mid-segment; sequence stays continuous across
// trips (trips are a planning grouping, not a separate numbering).
const trips = splitIntoTrips(points, 5);
assert.equal(trips.length, Math.ceil(points.length / 5));
trips.slice(0, -1).forEach((trip) => assert.equal(trip.length, 5, 'every trip but the last must be exactly at capacity'));
assert.ok(trips[trips.length - 1].length <= 5);
const flattened = trips.flat();
assert.deepEqual(flattened.map((p) => p.sequence), points.map((p) => p.sequence), 'splitting and flattening must reproduce the original sequence with nothing dropped or reordered');

// No cut needed when capacity isn't exceeded.
assert.deepEqual(splitIntoTrips(points, Infinity), [points]);
assert.deepEqual(splitIntoTrips(points, 0), [points]);

// 3. Status derivation: within radius of a recorded position -> recolectado; otherwise pendiente.
const stop = { latitude: 19.6489, longitude: -71.0956 };
const nearbyPosition = { latitude: 19.6489, longitude: -71.0956 }; // same point, 0m away
const farPosition = { latitude: 19.7000, longitude: -71.2000 }; // several km away
assert.equal(deriveStopStatus(stop, [farPosition]), 'pendiente');
assert.equal(deriveStopStatus(stop, [nearbyPosition]), 'recolectado');
assert.equal(deriveStopStatus(stop, []), 'pendiente', 'no positions at all must stay pendiente');
assert.equal(deriveStopStatus(stop, [farPosition, nearbyPosition]), 'recolectado', 'any matching position is enough');

console.log('route-engine ok');

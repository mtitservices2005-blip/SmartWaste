import assert from 'node:assert/strict';
import { summarizeRouteRunsByRoute, summarizeRouteRunsByDriver } from '../shared/route-run-stats.js';

// Two measured runs for route A (driver X), one measured run for route B (driver Y), one
// unmeasured run (no completed_at yet, should be excluded entirely).
const routeRuns = [
  { route_id: 'A', driver_id: 'X', started_at: '2026-08-20T08:00:00Z', completed_at: '2026-08-20T08:50:00Z', distance_meters: 5000 },
  { route_id: 'A', driver_id: 'X', started_at: '2026-08-21T08:00:00Z', completed_at: '2026-08-21T09:10:00Z', distance_meters: 5400 },
  { route_id: 'B', driver_id: 'Y', started_at: '2026-08-20T09:00:00Z', completed_at: '2026-08-20T09:40:00Z', distance_meters: null },
  { route_id: 'A', driver_id: 'X', started_at: '2026-08-22T08:00:00Z', completed_at: null },
];

const byRoute = summarizeRouteRunsByRoute(routeRuns);
assert.equal(byRoute.length, 2, 'only route A and B have measured runs; unmeasured run excluded');
const routeA = byRoute.find((r) => r.routeId === 'A');
assert.equal(routeA.runsCount, 2, 'unmeasured run must not count');
assert.equal(routeA.avgDurationMinutes, 60, '(50+70)/2 = 60');
assert.equal(routeA.lastDurationMinutes, 70, 'last measured run is the 70-minute one');
assert.equal(routeA.avgDistanceKm, 5.2, '(5.0+5.4)/2 = 5.2 km');
assert.equal(routeA.lastDistanceKm, 5.4);

const routeB = byRoute.find((r) => r.routeId === 'B');
assert.equal(routeB.runsCount, 1);
assert.equal(routeB.avgDurationMinutes, 40);
assert.equal(routeB.avgDistanceKm, null, 'no distance_meters on this run — must not invent a value');
assert.equal(routeB.lastDistanceKm, null);

const byDriver = summarizeRouteRunsByDriver(routeRuns);
assert.equal(byDriver.length, 2);
const driverX = byDriver.find((d) => d.driverId === 'X');
assert.equal(driverX.runsCount, 2, 'driver X ran route A twice (measured); the incomplete run excluded');
assert.equal(driverX.avgDurationMinutes, 60);

const driverY = byDriver.find((d) => d.driverId === 'Y');
assert.equal(driverY.runsCount, 1);

// Runs with no driver_id at all (e.g. legacy data) must be excluded from the by-driver grouping,
// not silently attributed to some default group.
const runsWithoutDriver = [{ route_id: 'C', driver_id: null, started_at: '2026-08-20T08:00:00Z', completed_at: '2026-08-20T08:30:00Z' }];
assert.deepEqual(summarizeRouteRunsByDriver(runsWithoutDriver), []);

// Empty input never throws, returns empty arrays.
assert.deepEqual(summarizeRouteRunsByRoute([]), []);
assert.deepEqual(summarizeRouteRunsByDriver([]), []);

console.log('route-run-stats ok');

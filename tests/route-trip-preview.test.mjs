// SW-028: covers splitIntoTrips() as used by frontend/app.js's finishCreateRoute() trip preview —
// purely informational grouping over generateRouteStopPoints()'s output, using a vehicle's
// max_stops. No persistence involved (trips are never written to route_stops/route_paths — see
// docs/TECHNICAL_DEBT_REGISTER.md and the SW-025/026 architecture decision that route_runs remains
// the place for real per-trip tracking later, not a new column/table here).
import assert from 'node:assert/strict';
import { generateRouteStopPoints, splitIntoTrips } from '../shared/route-engine.js';

// Same tiny formatting frontend/app.js's formatTripPreview() does, duplicated here only to assert
// on the exact user-facing shape (sequence ranges) without needing to import app.js (which runs DOM
// side effects at module load and can't be imported in Node).
function formatTripPreview(trips) {
  if (trips.length <= 1) return `1 viaje, ${trips[0]?.length ?? 0} parada(s).`;
  return trips.map((trip, index) => `Viaje ${index + 1}: paradas ${trip[0].sequence}-${trip[trip.length - 1].sequence}`).join(' · ');
}

// 1. Fits in a single trip: route-maestros generates 5 points at the default 100m spacing —
// comfortably under a generous capacity.
const maestrosPoints = generateRouteStopPoints('route-maestros');
const singleTrip = splitIntoTrips(maestrosPoints, 20);
assert.equal(singleTrip.length, 1);
assert.equal(formatTripPreview(singleTrip), `1 viaje, ${maestrosPoints.length} parada(s).`);

// 2. Requires several trips: route-centro generates 12 points at the default spacing; cap at 5.
const centroPoints = generateRouteStopPoints('route-centro');
assert.equal(centroPoints.length, 12);
const multiTrip = splitIntoTrips(centroPoints, 5);
assert.equal(multiTrip.length, 3); // 5 + 5 + 2
assert.deepEqual(multiTrip.map((trip) => trip.length), [5, 5, 2]);
assert.equal(formatTripPreview(multiTrip), 'Viaje 1: paradas 1-5 · Viaje 2: paradas 6-10 · Viaje 3: paradas 11-12');

// 3. Boundary: exactly equal to max_stops must still be a single trip, not spill into a second one.
const exactCapacity = splitIntoTrips(centroPoints, 12);
assert.equal(exactCapacity.length, 1);
assert.equal(exactCapacity[0].length, 12);
assert.equal(formatTripPreview(exactCapacity), '1 viaje, 12 parada(s).');
// One point over capacity must produce a second trip with exactly the overflow.
const oneOver = splitIntoTrips(centroPoints, 11);
assert.equal(oneOver.length, 2);
assert.deepEqual(oneOver.map((trip) => trip.length), [11, 1]);

console.log('route-trip-preview ok');

// SW-026: covers the exact computation frontend/app.js's drawDriverPositions() performs to color
// route_stops markers on the driver map — listRouteStops() + deriveStopStatus() against a recorded
// position trail — without needing a browser/Leaflet. app.js itself can't be imported in Node (it
// runs DOM side effects at module load), and this repo has no committed browser-test harness
// (playwright isn't even a devDependency) — the actual DOM/map rendering was verified manually in a
// real browser instead, same depth as the citizen-portal wiring in PR #23.
import assert from 'node:assert/strict';
import { createDemoOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints, deriveStopStatus } from '../shared/route-engine.js';
import { routes, routePaths } from '../shared/demo-data.js';

const adapter = createDemoOperationsAdapter();
const routeId = 'route-test-driver-stops';
const points = generateRouteStopPoints('route-centro', { stepMeters: 100 });
adapter.saveRouteStops(routeId, points);

const stops = adapter.listRouteStops(routeId);
assert.equal(stops.length, points.length);

// Simulate a truck's recorded trail (the shape frontend/app.js's positionHistory.listPositions()
// returns) that has passed exactly the first 3 stops and nowhere near the rest.
const simulatedTrail = stops.slice(0, 3).map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude }));
const withStatus = stops.map((stop) => ({ ...stop, status: deriveStopStatus(stop, simulatedTrail) }));

withStatus.slice(0, 3).forEach((stop) => assert.equal(stop.status, 'recolectado', `stop ${stop.sequence} should be recolectado`));
withStatus.slice(3).forEach((stop) => assert.equal(stop.status, 'pendiente', `stop ${stop.sequence} should still be pendiente`));

// The "8/12 recolectados"-style progress count frontend/app.js derives from this same array.
const collected = withStatus.filter((stop) => stop.status === 'recolectado').length;
assert.equal(`${collected}/${withStatus.length}`, `3/${points.length}`);

// Empty trail (vehicle never recorded a position yet, e.g. right after page load): every stop
// must stay pendiente, not throw.
const noTrail = stops.map((stop) => ({ ...stop, status: deriveStopStatus(stop, []) }));
assert.ok(noTrail.every((stop) => stop.status === 'pendiente'));

// Sanity: every demo route with a routePath has a matching, non-empty generated+persisted set —
// this is the same filter frontend/app.js's top-level seeding block uses.
routes.filter((route) => routePaths[route.id]).forEach((route) => {
  const routeStopPoints = generateRouteStopPoints(route.id);
  assert.ok(routeStopPoints.length > 0, `${route.id} must generate at least one stop`);
});

console.log('driver-route-stops ok');

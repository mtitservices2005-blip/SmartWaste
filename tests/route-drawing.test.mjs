// SW-027: covers the "Crear ruta" flow's actual logic — no browser/Leaflet needed, since drawing
// itself is just push/pop on an array (frontend/app.js's drawnRoutePoints) and the interesting part
// is what happens with that array afterward: generateRouteStopPoints() accepting a raw drawn path
// (not just a routePaths id), and the full demo persistence flow finishCreateRoute() drives.
import assert from 'node:assert/strict';
import { createDemoOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints, haversineMeters } from '../shared/route-engine.js';
import { routePaths } from '../shared/demo-data.js';

// 1. Drawing logic: add point, undo, sequence — mirrors exactly what frontend/app.js's
// redrawCreateRouteTrace()/undoLastRoutePoint() do to drawnRoutePoints.
let drawnPoints = [];
drawnPoints.push([19.6500, -71.1000]);
drawnPoints.push([19.6510, -71.1010]);
drawnPoints.push([19.6520, -71.1020]);
assert.equal(drawnPoints.length, 3);
drawnPoints.pop(); // undo last point
assert.equal(drawnPoints.length, 2);
assert.deepEqual(drawnPoints, [[19.6500, -71.1000], [19.6510, -71.1010]]);
drawnPoints.push([19.6530, -71.1030]);
drawnPoints.push([19.6540, -71.1040]);
assert.equal(drawnPoints.length, 4);

// generateRouteStopPoints() accepts the raw drawn path directly (not a routePaths id) — the
// capability finishCreateRoute() relies on to avoid reimplementing route-engine.js's generation
// for hand-drawn routes.
const stopPoints = generateRouteStopPoints(drawnPoints);
assert.ok(stopPoints.length >= drawnPoints.length, 'should generate at least as many points as drawn vertices');
stopPoints.forEach((point, index) => assert.equal(point.sequence, index + 1, 'sequence must follow draw order, 1..N'));
assert.deepEqual([stopPoints[0].latitude, stopPoints[0].longitude], drawnPoints[0], 'must start exactly at the first drawn point');
const lastDrawn = drawnPoints[drawnPoints.length - 1];
const lastGenerated = stopPoints[stopPoints.length - 1];
assert.ok(haversineMeters([lastGenerated.latitude, lastGenerated.longitude], lastDrawn) < 1, 'must end exactly at the last drawn point');

// 2. Full demo flow: create a route -> persist the drawn geometry -> generate + persist its stops
// automatically, through the demo adapter — same sequence of calls finishCreateRoute() makes.
const adapter = createDemoOperationsAdapter();
const routeId = 'route-test-drawing';
const created = adapter.createRoute({ id: routeId, name: 'Ruta dibujada de prueba', municipality_id: 'laguna-salada-rd', sectors: ['Ruta personalizada'], sector: 'Ruta personalizada' });
assert.equal(created.status, 'planned');
assert.equal(created.id, routeId);

// Same mechanism frontend/app.js uses to plug a drawn route into DeviceSimulator/routePosition/
// drawMapLayers/drawDriverPositions: they all read routePaths[routeId] directly, demo or not.
routePaths[routeId] = drawnPoints.slice();
assert.deepEqual(routePaths[routeId], drawnPoints);

const savedPath = adapter.savePathPoints(routeId, drawnPoints.map(([latitude, longitude], index) => ({ sequence: index + 1, latitude, longitude })));
assert.equal(savedPath.length, drawnPoints.length);

const savedStops = adapter.saveRouteStops(routeId, stopPoints);
assert.equal(savedStops.length, stopPoints.length);

const listedPath = adapter.listPathPoints(routeId);
assert.equal(listedPath.length, drawnPoints.length);
assert.deepEqual(listedPath.map((p) => p.sequence), drawnPoints.map((_, i) => i + 1));
assert.ok(listedPath.every((p) => p.route_id === routeId));

const listedStops = adapter.listRouteStops(routeId);
assert.equal(listedStops.length, stopPoints.length);
assert.deepEqual(listedStops.map((s) => s.sequence), stopPoints.map((s) => s.sequence));
assert.ok(listedStops.every((s) => s.route_id === routeId));

// A route with no drawn geometry at all must not accidentally pick up another route's stops/path.
assert.equal(adapter.listPathPoints('route-that-does-not-exist').length, 0);
assert.equal(adapter.listRouteStops('route-that-does-not-exist').length, 0);

console.log('route-drawing ok');

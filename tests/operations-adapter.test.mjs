import assert from 'node:assert/strict';
import { createDemoOperationsAdapter } from '../shared/operations-adapter.js';
import { generateRouteStopPoints } from '../shared/route-engine.js';
const adapter = createDemoOperationsAdapter();
assert(adapter.listVehicles().length > 0);
const route = adapter.createRoute({ id:'route-test', name:'Test', sectors:[], sector:'Centro urbano' });
assert.equal(route.status, 'planned');
assert.equal(adapter.assignVehicle('route-test','truck-01').status, 'assigned');
assert.equal(adapter.startRoute('route-test').status, 'started');
assert.equal(adapter.updateProgress('route-test', 50).status, 'in_progress');
assert.equal(adapter.markDelayed('route-test').status, 'delayed');
assert.equal(adapter.completeRoute('route-test').status, 'completed');
assert.equal(adapter.verifyRoute('route-test').status, 'verified');
assert(adapter.listPositions().every((p) => p.municipality_id));

// SW-025: saveRouteStops/listRouteStops persistence via the demo adapter, using a real
// (route-engine-generated) point sequence, not hand-written fixture points.
const generatedPoints = generateRouteStopPoints('route-centro', { stepMeters: 100 });
const saved = adapter.saveRouteStops('route-test', generatedPoints);
assert.equal(saved.length, generatedPoints.length);
const listed = adapter.listRouteStops('route-test');
assert.equal(listed.length, generatedPoints.length);
assert.deepEqual(listed.map((s) => s.sequence), generatedPoints.map((p) => p.sequence), 'listRouteStops must return stops ordered by sequence');
assert.ok(listed.every((s) => s.route_id === 'route-test'));
assert.equal(adapter.listRouteStops('route-that-does-not-exist').length, 0);

console.log('operations-adapter ok');

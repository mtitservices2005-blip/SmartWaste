import assert from 'node:assert/strict';
import { createDemoOperationsAdapter } from '../shared/operations-adapter.js';
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

// updateIncident: needed for the supervisor view's "marcar resuelta" action (frontend/app.js) to
// have a real-adapter counterpart, matching updateVehicle/updateRoute's shape.
const incident = adapter.registerIncident({ type: 'Test incident', sector: 'Centro urbano' });
assert.equal(adapter.updateIncident(incident.code, { status: 'Cerrada' }).status, 'Cerrada');
assert.throws(() => adapter.updateIncident('no-such-incident', { status: 'Cerrada' }), /not found/i);
console.log('operations-adapter ok');

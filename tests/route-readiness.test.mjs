import assert from 'node:assert/strict';
import { routeReadinessStage, ROUTE_READINESS_LABELS } from '../shared/route-readiness.js';

// No truck assigned at all (route.status === 'planned', the state a brand-new route starts in).
assert.equal(routeReadinessStage({ status: 'planned' }, null), 'needs_vehicle');

// Truck assigned (route.status flips to 'assigned' by assignTruckToRoute()) but that truck has no
// driver yet.
assert.equal(routeReadinessStage({ status: 'assigned' }, { driverId: null }), 'needs_driver');
assert.equal(routeReadinessStage({ status: 'assigned' }, { driverId: undefined }), 'needs_driver');

// Truck assigned and it has a driver — nothing left blocking the start.
assert.equal(routeReadinessStage({ status: 'assigned' }, { driverId: 'drv-01' }), 'ready');

// A 'planned' route can also already have a truck (e.g. picked at creation time before the status
// transition ran) — same needs_driver/ready logic applies regardless of planned vs assigned.
assert.equal(routeReadinessStage({ status: 'planned' }, { driverId: null }), 'needs_driver');
assert.equal(routeReadinessStage({ status: 'planned' }, { driverId: 'drv-01' }), 'ready');

// Once a route is actually running or finished, this function steps aside (returns null) so the
// caller keeps using the existing status pill — never invents a readiness badge for a state where
// it no longer applies.
for (const status of ['started', 'in_progress', 'delayed', 'completed', 'verified', 'cancelled']) {
  assert.equal(routeReadinessStage({ status }, { driverId: 'drv-01' }), null, `${status} must fall back to the existing status pill`);
  assert.equal(routeReadinessStage({ status }, null), null, `${status} must fall back even without a truck (e.g. a demo route)`);
}

// Every non-null stage has a label.
assert.equal(ROUTE_READINESS_LABELS.needs_vehicle, 'Falta vehículo');
assert.equal(ROUTE_READINESS_LABELS.needs_driver, 'Falta chofer');
assert.equal(ROUTE_READINESS_LABELS.ready, 'Listo para iniciar');

console.log('route-readiness ok');

import assert from 'node:assert/strict';
import { ROUTE_STATES, VEHICLE_STATES, canTransitionRoute, requireMunicipality, contracts } from '../shared/contracts.js';
assert(ROUTE_STATES.includes('cancelled'));
assert(VEHICLE_STATES.includes('maintenance'));
assert.equal(canTransitionRoute('planned','assigned'), true);
assert.equal(canTransitionRoute('planned','verified'), false);
assert.throws(() => requireMunicipality({ id: 'x' }), /municipality_id/);
assert.equal(contracts.vehicle.municipality_id, 'uuid');
console.log('contracts ok');

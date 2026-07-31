import assert from 'node:assert/strict';
import { ROUTE_STATES, VEHICLE_STATES, ROUTE_TRANSITIONS, canTransitionRoute, driverAllowedTransitions, requireMunicipality, contracts } from '../shared/contracts.js';
assert(ROUTE_STATES.includes('cancelled'));
assert(VEHICLE_STATES.includes('maintenance'));
assert.equal(canTransitionRoute('planned','assigned'), true);
assert.equal(canTransitionRoute('planned','verified'), false);
assert.throws(() => requireMunicipality({ id: 'x' }), /municipality_id/);
assert.equal(contracts.vehicle.municipality_id, 'uuid');

// driverAllowedTransitions (used by frontend/app.js renderConductor, the driver view): matches
// PERMISSIONS.driver in shared/auth-context.js, which grants routes.start/routes.progress but not
// routes.verify or cancellation — so 'verified' and 'cancelled' must never appear, even for states
// whose raw ROUTE_TRANSITIONS entry includes them.
assert.deepEqual(driverAllowedTransitions('assigned'), ['started']);
assert.deepEqual(driverAllowedTransitions('in_progress'), ['delayed', 'completed']);
assert.deepEqual(driverAllowedTransitions('completed'), []); // raw graph only has 'verified' here — supervisor-only
assert.deepEqual(driverAllowedTransitions('unknown-state'), []);
ROUTE_STATES.forEach((state) => {
  driverAllowedTransitions(state).forEach((next) => {
    assert(!['verified', 'cancelled'].includes(next), `driver must never be offered '${next}' from '${state}'`);
    assert(ROUTE_TRANSITIONS[state].includes(next), `'${state}'->'${next}' must still be a real transition`);
  });
});

console.log('contracts ok');

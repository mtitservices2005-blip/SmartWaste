import assert from 'node:assert/strict';
import { municipalFlow, nextFlowState } from '../shared/operation-flow.js';

assert.deepEqual(municipalFlow.map((step) => step.state), [
  'planned', 'assigned', 'started', 'in_progress', 'delayed', 'completed', 'verified'
]);
assert.equal(nextFlowState('planned'), 'assigned');
assert.equal(nextFlowState('verified'), 'planned');
console.log('operation-flow ok');

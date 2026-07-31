// SCOPE (docs/TECHNICAL_DEBT_REGISTER.md #5): validates the shape of the scenario-v2.js step lists
// and a couple of shared/observability.js helpers in-process — it never opens a browser or exercises
// frontend/e2e-demo/index.html. "e2e" here names the demo scenario, not an executed end-to-end test.
import assert from 'node:assert/strict';
import { unifiedE2ESteps, alternateE2ESteps } from '../frontend/e2e-demo/scenario-v2.js';
import { healthCheck, structuredLog } from '../shared/observability.js';
assert.equal(unifiedE2ESteps.length, 14);
assert(alternateE2ESteps.some(([step]) => step === 'Vehículo offline'));
assert.equal(healthCheck().production, 'NO');
assert.equal(structuredLog({ event:'route.started' }).event, 'route.started');
console.log('e2e-v2 ok');

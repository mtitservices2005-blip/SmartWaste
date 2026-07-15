import assert from 'node:assert/strict';
import { unifiedE2ESteps, alternateE2ESteps } from '../frontend/e2e-demo/scenario-v2.js';
import { healthCheck, structuredLog } from '../shared/observability.js';
assert.equal(unifiedE2ESteps.length, 14);
assert(alternateE2ESteps.some(([step]) => step === 'Vehículo offline'));
assert.equal(healthCheck().production, 'NO');
assert.equal(structuredLog({ event:'route.started' }).event, 'route.started');
console.log('e2e-v2 ok');

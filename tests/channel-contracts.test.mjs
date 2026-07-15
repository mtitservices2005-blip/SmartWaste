import assert from 'node:assert/strict';
import { buildCitizenIntent, validateEvidenceFile } from '../shared/channel-contracts.js';
assert.equal(buildCitizenIntent({ intent:'pickup_schedule', sector_id:'centro' }).channel, 'web');
assert.throws(() => buildCitizenIntent({ intent:'bad' }), /Unsupported intent/);
assert.equal(validateEvidenceFile({ size: 1000, type:'image/png' }).ok, true);
assert.equal(validateEvidenceFile({ size: 10, type:'application/x-msdownload' }).ok, false);
console.log('channel-contracts ok');

import assert from 'node:assert/strict';
import { ROLES, createSessionContext, can, assertSameMunicipality } from '../shared/auth-context.js';
assert.equal(ROLES.length, 5);
const dispatcher = createSessionContext({ user_id:'u1', role:'dispatcher', municipality_id:'m1' });
assert.equal(can(dispatcher, 'routes.assign'), true);
assert.throws(() => createSessionContext({ user_id:'u2', role:'driver' }), /municipality_id/);
assert.equal(assertSameMunicipality(dispatcher, { municipality_id:'m1' }), true);
assert.throws(() => assertSameMunicipality(dispatcher, { municipality_id:'m2' }), /Cross-municipality/);
console.log('auth-context ok');

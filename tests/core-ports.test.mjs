// Verifies shared/core-ports.js is a pure delegation layer over shared/auth-context.js (see
// docs/CORE_READINESS_REVIEW.md) — no Supabase instance required. createContext/can/demoContext
// are checked against the same behavior as tests/auth-context.test.mjs; resolveContext is checked
// against a minimal mock Supabase client that mirrors the exact call chain
// resolveSupabaseAuthContext makes, to confirm the port forwards to the real implementation
// rather than reimplementing it.
import assert from 'node:assert/strict';
import { createIdentityProvider, createMunicipalityScope } from '../shared/core-ports.js';

const identity = createIdentityProvider(null);
const ctx = identity.createContext({ user_id: 'u1', role: 'dispatcher', municipality_id: 'm1' });
assert.equal(identity.can(ctx, 'routes.assign'), true);
assert.equal(identity.can(ctx, 'routes.verify'), false);
assert.equal(identity.demoContext.role, 'municipal_admin');

// Mock mirrors the exact chain resolveSupabaseAuthContext (shared/auth-context.js:23-37) calls
// when no municipality_id is passed: profiles select().eq().maybeSingle(), memberships
// select().eq().eq().limit().maybeSingle().
const mockClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'u2' } }, error: null }) },
  from(tableName) {
    if (tableName === 'profiles') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u2', display_name: 'Mock Driver' }, error: null }) }) }) };
    }
    if (tableName === 'memberships') {
      return { select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { role: 'driver', municipality_id: 'm1' }, error: null }) }) }) }) }) };
    }
    throw new Error(`unexpected table in mock client: ${tableName}`);
  }
};

const identityWithClient = createIdentityProvider(mockClient);
const resolved = await identityWithClient.resolveContext();
assert.equal(resolved.role, 'driver');
assert.equal(resolved.municipality_id, 'm1');
assert.equal(identityWithClient.can(resolved, 'routes.start'), true);
assert.equal(identityWithClient.can(resolved, 'routes.verify'), false);

const scope = createMunicipalityScope();
assert.equal(scope.assertSameMunicipality(ctx, { municipality_id: 'm1' }), true);
assert.throws(() => scope.assertSameMunicipality(ctx, { municipality_id: 'm2' }), /Cross-municipality/);

console.log('core-ports ok');

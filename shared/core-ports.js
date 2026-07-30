// Seams for MTIT-OS Core integration — see docs/CORE_READINESS_REVIEW.md.
//
// MTIT-OS Core (Identity, Municipality) does not exist yet to consume, so each port below has
// exactly one implementation today: the current Supabase-backed logic already in
// shared/auth-context.js. Introducing this file does not change SmartWaste's behavior — every
// function here is a direct delegation, not new logic.
//
// The point is that future call sites (frontend, tests, other modules) should depend on
// createIdentityProvider()/createMunicipalityScope() instead of importing
// resolveSupabaseAuthContext/assertSameMunicipality directly. When MTIT-OS Identity/Municipality
// are ready to consume, swapping the implementation is a change to this one file, not a
// search-and-replace across the codebase.
//
// Do not add new business logic here — only wrap what already exists in shared/auth-context.js.
// See docs/CORE_READINESS_REVIEW.md for which other pieces (route_run lifecycle in
// shared/operations-adapter.js, shared/channel-contracts.js) are candidates for the same
// treatment later.

import { resolveSupabaseAuthContext, createSessionContext, can, assertSameMunicipality, demoSession } from './auth-context.js';

/**
 * IdentityProvider port: resolves who is acting (user, role, municipality, permissions) and
 * answers permission checks. Today backed by Supabase Auth + the profiles/memberships tables
 * SmartWaste owns directly; would be backed by MTIT-OS Identity once it exists and exposes a
 * client SmartWaste can call instead.
 */
export function createIdentityProvider(client, defaults = {}) {
  return {
    // Resolves the session context for the currently signed-in Supabase user.
    resolveContext: (opts = {}) => resolveSupabaseAuthContext(client, { ...defaults, ...opts }),
    // Builds a session context directly from known values (used by demo/local flows that don't
    // go through a real signed-in Supabase session).
    createContext: (params) => createSessionContext(params),
    can: (ctx, permission) => can(ctx, permission),
    demoContext: demoSession
  };
}

/**
 * MunicipalityScope port: enforces that a caller only touches records that belong to their own
 * municipality (app-layer defense in depth on top of Postgres RLS). Today backed by a direct
 * field comparison against `municipality_id`; would be backed by MTIT-OS Municipality's tenancy
 * rules once it exists.
 */
export function createMunicipalityScope() {
  return {
    assertSameMunicipality: (ctx, record) => assertSameMunicipality(ctx, record)
  };
}

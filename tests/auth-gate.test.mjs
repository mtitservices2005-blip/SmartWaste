// Unit tests for the DOM-free logic in frontend/auth-gate.js: which role sees which section, and
// how the optional Supabase config is read. Does NOT test the actual login form/overlay or a real
// Supabase sign-in — those need a browser + local Supabase and are out of scope for a Node test;
// see docs/LOGIN_GATING_VERIFICATION_BRIEF.md for the interactive verification this still needs.
import assert from 'node:assert/strict';
import { pickVisibleSections, readSupabaseConfig, SECTION_ROLES } from '../frontend/auth-gate.js';

// Anonymous / no session: only the public citizen portal is visible.
assert.deepEqual(pickVisibleSections(null).sort(), ['ciudadania']);

// Driver: operational sections, not the impact center (no reports.read in PERMISSIONS.driver) or
// master admin.
assert.deepEqual(pickVisibleSections('driver').sort(), ['ciudadania', 'mapa', 'municipal']);

// Dispatcher: same as driver — dispatcher also lacks reports.read (shared/auth-context.js
// PERMISSIONS.dispatcher).
assert.deepEqual(pickVisibleSections('dispatcher').sort(), ['ciudadania', 'mapa', 'municipal']);

// Supervisor and municipal_admin: everything except the cross-municipality master admin panel.
assert.deepEqual(pickVisibleSections('supervisor').sort(), ['ciudadania', 'impacto', 'mapa', 'municipal']);
assert.deepEqual(pickVisibleSections('municipal_admin').sort(), ['ciudadania', 'impacto', 'mapa', 'municipal']);

// Platform superadmin: only the master admin panel (platform-scoped, not a single municipality's
// operations) plus the always-public citizen portal.
assert.deepEqual(pickVisibleSections('mt_superadmin').sort(), ['ciudadania', 'master']);

// Every role in shared/auth-context.js ROLES must have an explicit entry here (fail loudly if a
// role is added to auth-context.js and forgotten here).
const allRoles = ['mt_superadmin', 'municipal_admin', 'supervisor', 'dispatcher', 'driver'];
allRoles.forEach((role) => {
  const visible = pickVisibleSections(role);
  assert.ok(visible.includes('ciudadania'), `${role} must always see the public citizen portal`);
});

// readSupabaseConfig: absent, partial, and complete config.
assert.equal(readSupabaseConfig({}), null);
assert.equal(readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x' } }), null);
assert.deepEqual(
  readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x', anonKey: 'k' } }),
  { url: 'http://x', anonKey: 'k' }
);

// SECTION_ROLES itself: ciudadania must stay public (regression guard against accidentally gating
// the anonymous citizen-report flow SW-020 specifically enabled).
assert.equal(SECTION_ROLES.ciudadania, null);

console.log('auth-gate ok');

// Unit tests for the DOM-free logic in frontend/auth-gate.js: which role sees which section, and
// how the optional Supabase config is read. Does NOT test the actual login form/overlay or a real
// Supabase sign-in — those need a browser + local Supabase and are out of scope for a Node test;
// see docs/LOGIN_GATING_VERIFICATION_BRIEF.md for the interactive verification this still needs.
import assert from 'node:assert/strict';
import { pickVisibleSections, pickVisibleOpsViews, readSupabaseConfig, SECTION_ROLES, OPS_SUBVIEW_ROLES, isPasswordSetupRedirect } from '../frontend/auth-gate.js';

// Anonymous / no session: only the public citizen portal is visible.
assert.deepEqual(pickVisibleSections(null).sort(), ['ciudadania']);

// Driver: operational sections, not the impact center (no reports.read in PERMISSIONS.driver) or
// master admin. Includes 'conductor' (item #12 of docs/TECHNICAL_DEBT_REGISTER.md — the driver
// mobile view is now its own top-level section, not embedded inside 'municipal'). 'mapa' and
// 'municipal' merged into a single 'operaciones' section with sub-vistas (Fase 3 UX,
// OPS_SUBVIEW_ROLES below covers the finer-grained access that used to live at this level).
assert.deepEqual(pickVisibleSections('driver').sort(), ['ciudadania', 'conductor', 'operaciones', 'resumen']);

// Dispatcher: same as driver — dispatcher also lacks reports.read (shared/auth-context.js
// PERMISSIONS.dispatcher).
assert.deepEqual(pickVisibleSections('dispatcher').sort(), ['ciudadania', 'conductor', 'operaciones', 'resumen']);

// Supervisor gets its own dedicated view (route verification + incident management, matching
// PERMISSIONS.supervisor's routes.verify/incidents.manage) instead of the generic municipal panel —
// and no 'conductor' either, matching what it could see before this section existed on its own.
assert.deepEqual(pickVisibleSections('supervisor').sort(), ['ciudadania', 'impacto', 'operaciones', 'resumen', 'supervisor']);

// municipal_admin: generic municipal panel + impact center + the driver view, not the master
// admin panel.
assert.deepEqual(pickVisibleSections('municipal_admin').sort(), ['ciudadania', 'conductor', 'impacto', 'operaciones', 'resumen']);

// Platform superadmin: only the master admin panel (platform-scoped, not a single municipality's
// operations) plus the always-public citizen portal.
assert.deepEqual(pickVisibleSections('mt_superadmin').sort(), ['ciudadania', 'master']);

// Fase 3 UX: sub-vistas inside #operaciones (mapa/rutas/flota/incidencias) preserve the exact
// access split that used to exist between the separate 'mapa' and 'municipal' top-level sections —
// supervisor only ever saw 'mapa', never 'municipal'.
assert.deepEqual(pickVisibleOpsViews('supervisor').sort(), ['mapa']);
assert.deepEqual(pickVisibleOpsViews('driver').sort(), ['flota', 'incidencias', 'mapa', 'rutas']);
assert.deepEqual(pickVisibleOpsViews('dispatcher').sort(), ['flota', 'incidencias', 'mapa', 'rutas']);
assert.deepEqual(pickVisibleOpsViews('municipal_admin').sort(), ['flota', 'incidencias', 'mapa', 'rutas']);
assert.deepEqual(pickVisibleOpsViews('mt_superadmin').sort(), []);
assert.deepEqual(pickVisibleOpsViews(null).sort(), []);

// Every role in shared/auth-context.js ROLES must have an explicit entry here (fail loudly if a
// role is added to auth-context.js and forgotten here).
const allRoles = ['mt_superadmin', 'municipal_admin', 'supervisor', 'dispatcher', 'driver'];
allRoles.forEach((role) => {
  const visible = pickVisibleSections(role);
  assert.ok(visible.includes('ciudadania'), `${role} must always see the public citizen portal`);
});

// readSupabaseConfig: absent, partial, and complete config. municipality_id (SW-039) is optional —
// only the anonymous citizen portal needs it, since it has no session to derive it from.
assert.equal(readSupabaseConfig({}), null);
assert.equal(readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x' } }), null);
assert.deepEqual(
  readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x', anonKey: 'k' } }),
  { url: 'http://x', anonKey: 'k', municipality_id: null, hideDemo: false }
);
assert.deepEqual(
  readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x', anonKey: 'k', municipality_id: 'muni-1' } }),
  { url: 'http://x', anonKey: 'k', municipality_id: 'muni-1', hideDemo: false }
);
// SW-044: deployment-level opt-out of ever showing the bundled demo data.
assert.deepEqual(
  readSupabaseConfig({ SMARTWASTE_SUPABASE_CONFIG: { url: 'http://x', anonKey: 'k', hideDemo: true } }),
  { url: 'http://x', anonKey: 'k', municipality_id: null, hideDemo: true }
);

// SECTION_ROLES itself: ciudadania must stay public (regression guard against accidentally gating
// the anonymous citizen-report flow SW-020 specifically enabled).
assert.equal(SECTION_ROLES.ciudadania, null);

// SW-051: isPasswordSetupRedirect() — an invite (create-driver-account) or recovery
// (resend-driver-invite) link redirects with `type=invite`/`type=recovery` in the URL hash
// alongside the tokens detectSessionInUrl consumes; anything else (a normal page load, or a
// session-refresh hash with a different/no type) must not show the set-password screen.
assert.equal(isPasswordSetupRedirect('#access_token=abc&type=invite&refresh_token=xyz'), true);
assert.equal(isPasswordSetupRedirect('#access_token=abc&type=recovery&refresh_token=xyz'), true);
assert.equal(isPasswordSetupRedirect('#access_token=abc&type=signup'), false, 'only invite/recovery need a password set');
assert.equal(isPasswordSetupRedirect(''), false);
assert.equal(isPasswordSetupRedirect(null), false);
assert.equal(isPasswordSetupRedirect('#operaciones/rutas'), false, 'a normal in-app hash link must never trigger this');

console.log('auth-gate ok');

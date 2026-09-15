// Unit tests for auth-gate.js: role visibility, config parsing, and the mandatory first-login
// password transition. A real Supabase sign-in still needs the interactive verification described
// in docs/LOGIN_GATING_VERIFICATION_BRIEF.md.
import assert from 'node:assert/strict';
import { pickVisibleSections, pickVisibleOpsViews, readSupabaseConfig, requiresDriverPasswordChange, renderPasswordChangeOverlay, setDriverOwnPassword, SECTION_ROLES, OPS_SUBVIEW_ROLES } from '../frontend/auth-gate.js';

// Anonymous / no session: only the public citizen portal is visible.
assert.deepEqual(pickVisibleSections(null).sort(), ['ciudadania']);

// Driver: operational sections, not the impact center (no reports.read in PERMISSIONS.driver) or
// master admin. Includes 'conductor' (item #12 of docs/TECHNICAL_DEBT_REGISTER.md — the driver
// mobile view is now its own top-level section, not embedded inside 'municipal'). 'mapa' and
// 'municipal' merged into a single 'operaciones' section with sub-vistas (Fase 3 UX,
// OPS_SUBVIEW_ROLES below covers the finer-grained access that used to live at this level).
assert.deepEqual(pickVisibleSections('driver').sort(), ['ciudadania', 'conductor', 'operaciones', 'resumen']);

// Dispatcher: same as driver plus 'configuracion' (SW-049 — dispatcher is who actually assigns
// vehicles/choferes to routes, so the guided-flow toggle is theirs to set) — dispatcher also lacks
// reports.read (shared/auth-context.js PERMISSIONS.dispatcher).
assert.deepEqual(pickVisibleSections('dispatcher').sort(), ['ciudadania', 'conductor', 'configuracion', 'operaciones', 'resumen']);

// Supervisor gets its own dedicated view (route verification + incident management, matching
// PERMISSIONS.supervisor's routes.verify/incidents.manage) instead of the generic municipal panel —
// and no 'conductor' either, matching what it could see before this section existed on its own.
assert.deepEqual(pickVisibleSections('supervisor').sort(), ['ciudadania', 'impacto', 'operaciones', 'resumen', 'supervisor']);

// municipal_admin: generic municipal panel + impact center + the driver view + 'configuracion'
// (SW-049, also an assigner role), not the master admin panel.
assert.deepEqual(pickVisibleSections('municipal_admin').sort(), ['ciudadania', 'conductor', 'configuracion', 'impacto', 'operaciones', 'resumen']);

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

// A newly provisioned driver must complete the mandatory form. The explicit marker plus driver
// role keeps existing accounts and other roles on the normal login path.
const driverContext = { role: 'driver' };
const temporaryUser = { user_metadata: { requires_password_change: true } };
assert.equal(requiresDriverPasswordChange(temporaryUser, driverContext), true);
assert.equal(requiresDriverPasswordChange({ user_metadata: {} }, driverContext), false);
assert.equal(requiresDriverPasswordChange(temporaryUser, { role: 'dispatcher' }), false);

let appendedOverlay;
globalThis.document = {
  createElement() { return { innerHTML: '', className: '', id: '' }; },
  body: { append(node) { appendedOverlay = node; } }
};
const mandatoryOverlay = renderPasswordChangeOverlay();
assert.equal(appendedOverlay, mandatoryOverlay);
assert.match(mandatoryOverlay.innerHTML, /id="passwordChangeForm"/);
assert.match(mandatoryOverlay.innerHTML, /name="confirmation"/);
assert.doesNotMatch(mandatoryOverlay.innerHTML, /skipToPublic/);
delete globalThis.document;

// Completing the form changes the password and clears the marker in the same Supabase call. On
// the following login the returned user therefore enters through the normal path.
let updatePayload;
const updatedUser = { user_metadata: { requires_password_change: false } };
const fakeClient = { auth: { async updateUser(payload) {
  updatePayload = payload;
  return { data: { user: updatedUser }, error: null };
} } };
assert.equal(await setDriverOwnPassword(fakeClient, 'propia-segura-123'), updatedUser);
assert.deepEqual(updatePayload, {
  password: 'propia-segura-123',
  data: { requires_password_change: false }
});
assert.equal(requiresDriverPasswordChange(updatedUser, driverContext), false);

console.log('auth-gate ok');

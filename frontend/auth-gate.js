// Login + role gating for the SmartWaste frontend — first real consumer of
// createIdentityProvider() (shared/core-ports.js, see docs/CORE_READINESS_REVIEW.md).
//
// IMPORTANT (CLAUDE.md rule 5 — do not break the approved demo): this gate is fully opt-in. With
// no window.SMARTWASTE_SUPABASE_CONFIG set, initAuthGate() returns immediately without touching
// the DOM at all — every section stays visible exactly like before this file existed. The gate
// only activates when the page is explicitly pointed at a Supabase project (local or real).
//
// Anon key only (CLAUDE.md rule 8 — never a service_role key here). The anon key is meant to be
// public; RLS (supabase/migrations/202607150004_sw014_auth_rls_policies.sql,
// .../202607150006_sw020_rls_fixes.sql) is what actually protects data, not this file.

import { createIdentityProvider } from '../shared/core-ports.js';

// Which top-level <section id="..."> each role may see, per docs/ROLE_PERMISSION_MATRIX.md.
// `null` means the section is public: always shown, logged in or not (the citizen portal is
// designed for anonymous access — see supabase/migrations/202607150006_sw020_rls_fixes.sql's
// anon_insert_citizen_report policy).
export const SECTION_ROLES = {
  resumen: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  operaciones: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  supervisor: ['supervisor'],
  conductor: ['municipal_admin', 'dispatcher', 'driver'],
  impacto: ['municipal_admin', 'supervisor'],
  master: ['mt_superadmin'],
  ciudadania: null
};

// Fase 3 UX (auditoría SW-020): "mapa" y "municipal" se fusionaron en un único top-level section
// #operaciones con sub-vistas locales (frontend/app.js — OPS_VIEWS/renderOperations()), pero el
// límite de acceso original entre ellas se preserva: 'mapa' seguía siendo visible para supervisor,
// 'municipal' (ahora repartida en rutas/flota/incidencias) nunca lo fue. Este mapa gatea las
// sub-vistas dentro de #operaciones exactamente como antes gateaba las dos secciones separadas.
export const OPS_SUBVIEW_ROLES = {
  mapa: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  rutas: ['municipal_admin', 'dispatcher', 'driver'],
  flota: ['municipal_admin', 'dispatcher', 'driver'],
  incidencias: ['municipal_admin', 'dispatcher', 'driver']
};

// Pure, DOM-free — unit-tested directly in tests/auth-gate.test.mjs. Given a role (or null for no
// session / anonymous), returns the section ids that should be visible.
export function pickVisibleSections(role, sections = SECTION_ROLES) {
  return Object.entries(sections)
    .filter(([, allowedRoles]) => allowedRoles === null || (role && allowedRoles.includes(role)))
    .map(([id]) => id);
}

// Same shape as pickVisibleSections(), for the sub-vistas inside #operaciones.
export function pickVisibleOpsViews(role, views = OPS_SUBVIEW_ROLES) {
  return Object.entries(views)
    .filter(([, allowedRoles]) => allowedRoles === null || (role && allowedRoles.includes(role)))
    .map(([id]) => id);
}

// Pure, DOM-free — unit-tested with a fake `win` object. Reads and validates the page's optional
// Supabase config without ever touching a real `window`.
// SW-039: municipality_id is optional and only meaningful for the anonymous citizen portal — every
// other real-backend flow derives it from the signed-in session's membership
// (resolveSupabaseAuthContext()), but an anonymous visitor has no session, and municipalities has
// no anon SELECT policy (see supabase/migrations/202607150006_sw020_rls_fixes.sql's
// municipality_is_onboarded() comment), so there is no way for the browser to discover it on its
// own. The deployer sets it once per municipality-specific deployment, alongside url/anonKey.
export function readSupabaseConfig(win = typeof window !== 'undefined' ? window : {}) {
  const config = win.SMARTWASTE_SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return null;
  return { url: config.url, anonKey: config.anonKey, municipality_id: config.municipality_id ?? null };
}

// SW-032: the client initAuthGate() creates below is what carries the signed-in session (JWT) —
// features added later that need to call an Edge Function as the logged-in user (e.g. the "Crear
// cuenta de acceso" button) reuse this exact client instead of standing up a second one, so there
// is only ever one source of truth for "am I signed in right now". null until initAuthGate() has
// actually run and resolved a config (mirrors this file's opt-in-only behavior).
let authClient = null;
export function getAuthClient() { return authClient; }

function applySectionVisibility(visibleIds, sections = SECTION_ROLES) {
  Object.keys(sections).forEach((id) => {
    const section = document.getElementById(id);
    if (section) section.style.display = visibleIds.includes(id) ? '' : 'none';
    // Codex review on PR #49: "Resumen del día" (frontend/app.js's renderSummary()) links straight
    // to sections/sub-vistas by hash too, same as the topbar nav — a role that can't see the
    // destination must not get a dead-end card for it either. Matches on both the exact hash and a
    // "#id/..." sub-vista prefix (e.g. an operaciones/<vista> link also counts as pointing at
    // 'operaciones'), and isn't scoped to `nav` since these cards live in the page body.
    document.querySelectorAll(`a[href="#${id}"], a[href^="#${id}/"]`).forEach((link) => {
      link.style.display = visibleIds.includes(id) ? '' : 'none';
    });
  });
}

// Gates the sub-vista tabs/panels inside #operaciones the same way applySectionVisibility() gates
// top-level sections — inline style, so it wins over app.js's own class-based tab-switching
// ('hidden' toggled by showOpsView()) regardless of which sub-vista is currently active.
function applyOpsViewVisibility(visibleViews, views = OPS_SUBVIEW_ROLES) {
  Object.keys(views).forEach((view) => {
    const tab = document.querySelector(`[data-ops-nav="${view}"]`);
    if (tab) tab.style.display = visibleViews.includes(view) ? '' : 'none';
    const panel = document.querySelector(`[data-ops-view="${view}"]`);
    if (panel) panel.style.display = visibleViews.includes(view) ? '' : 'none';
    // Same "Resumen del día" concern as applySectionVisibility() above, for cards that link
    // straight to a specific sub-vista (e.g. "Vehículos fuera de servicio" -> #operaciones/flota).
    document.querySelectorAll(`a[href="#operaciones/${view}"]`).forEach((link) => {
      link.style.display = visibleViews.includes(view) ? '' : 'none';
    });
  });
}

// Inserted into the (static, HTML-authored) topbar once a session actually resolves — never shown
// for the anonymous/"skip to public" path, since there's no session to close. A full page reload
// after signOut() is deliberate: app.js holds a lot of module-level mutable state (trucks/routes
// arrays, simState, driverSimulators, hydration flags...) that a real teardown would have to reset
// by hand; reloading is the same "start clean" guarantee login-as-a-different-user needs anyway.
function renderLogoutButton(client) {
  if (document.getElementById('authLogout')) return;
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const button = document.createElement('button');
  button.id = 'authLogout';
  button.type = 'button';
  button.className = 'auth-logout';
  button.textContent = 'Cerrar sesión';
  button.addEventListener('click', async () => {
    button.disabled = true;
    await client.auth.signOut();
    window.location.reload();
  });
  topbar.append(button);
}

function renderOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <form id="authForm" class="auth-card">
      <h2>SmartWaste — acceso municipal</h2>
      <p class="demo">Datos demo · no producción</p>
      <label>Correo<input type="email" name="email" required autocomplete="username"></label>
      <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
      <button type="submit">Ingresar</button>
      <p id="authError" class="auth-error" role="alert"></p>
      <p class="demo">¿Sos ciudadano? <a href="#ciudadania" id="skipToPublic">Ir al portal ciudadano sin iniciar sesión</a>.</p>
    </form>`;
  document.body.append(overlay);
  return overlay;
}

/**
 * Activates the login + role gate. No-ops entirely (see file header) if
 * window.SMARTWASTE_SUPABASE_CONFIG isn't set. Returns the resolved session context, or null if
 * gating is off or the visitor chose the public citizen-portal-only path.
 */
export async function initAuthGate() {
  const config = readSupabaseConfig();
  if (!config) return null;

  // Vendored locally (frontend/vendor/supabase-js.mjs, built from node_modules via esbuild — see
  // frontend/vendor/README.md) instead of a runtime esm.sh import: a real staging test found that
  // esm.sh being unreachable from the visitor's network (corporate firewall, etc.) silently killed
  // the whole auth gate — no login overlay, no error shown, just the raw demo dashboard unfiltered.
  const { createClient } = await import('./vendor/supabase-js.mjs');
  const client = createClient(config.url, config.anonKey);
  authClient = client;
  const identity = createIdentityProvider(client);

  async function tryResolve() {
    try {
      const ctx = await identity.resolveContext();
      applySectionVisibility(pickVisibleSections(ctx.role));
      applyOpsViewVisibility(pickVisibleOpsViews(ctx.role));
      renderLogoutButton(client);
      return ctx;
    } catch {
      return null;
    }
  }

  // Reload with an existing signed-in session: skip the form if we can resolve a context.
  const existing = await tryResolve();
  if (existing) return existing;

  const overlay = renderOverlay();
  return new Promise((resolve) => {
    overlay.querySelector('#skipToPublic').addEventListener('click', (event) => {
      event.preventDefault();
      overlay.remove();
      applySectionVisibility(pickVisibleSections(null));
      applyOpsViewVisibility(pickVisibleOpsViews(null));
      resolve(null);
    });
    overlay.querySelector('#authForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorEl = overlay.querySelector('#authError');
      errorEl.textContent = '';
      const formData = new FormData(event.target);
      const { error: signInError } = await client.auth.signInWithPassword({ email: formData.get('email'), password: formData.get('password') });
      if (signInError) { errorEl.textContent = 'Credenciales inválidas.'; return; }
      const ctx = await tryResolve();
      if (!ctx) { errorEl.textContent = 'Sesión iniciada, pero sin membresía activa en ningún municipio.'; await client.auth.signOut(); return; }
      overlay.remove();
      resolve(ctx);
    });
  });
}

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
  mapa: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  municipal: ['municipal_admin', 'dispatcher', 'driver'],
  supervisor: ['supervisor'],
  conductor: ['municipal_admin', 'dispatcher', 'driver'],
  impacto: ['municipal_admin', 'supervisor'],
  master: ['mt_superadmin'],
  ciudadania: null
};

// Pure, DOM-free — unit-tested directly in tests/auth-gate.test.mjs. Given a role (or null for no
// session / anonymous), returns the section ids that should be visible.
export function pickVisibleSections(role, sections = SECTION_ROLES) {
  return Object.entries(sections)
    .filter(([, allowedRoles]) => allowedRoles === null || (role && allowedRoles.includes(role)))
    .map(([id]) => id);
}

// Pure, DOM-free — unit-tested with a fake `win` object. Reads and validates the page's optional
// Supabase config without ever touching a real `window`.
export function readSupabaseConfig(win = typeof window !== 'undefined' ? window : {}) {
  const config = win.SMARTWASTE_SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return null;
  return { url: config.url, anonKey: config.anonKey };
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
    const navLink = document.querySelector(`nav a[href="#${id}"]`);
    if (navLink) navLink.style.display = visibleIds.includes(id) ? '' : 'none';
  });
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

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.0');
  const client = createClient(config.url, config.anonKey);
  authClient = client;
  const identity = createIdentityProvider(client);

  async function tryResolve() {
    try {
      const ctx = await identity.resolveContext();
      applySectionVisibility(pickVisibleSections(ctx.role));
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

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

import { driverAuthOptions, isConnectivityError } from '../shared/session-restore.js';
import { createIdentityProvider } from '../shared/core-ports.js';
import { demoLine, isDemoUi } from './ui-mode.js';
import { renderStaffLogin } from './components/login-screens.js';
import { validateLogin, loginErrorMessage, googleErrorMessage, FORGOT_MESSAGE, NO_ACCESS_MESSAGE } from '../shared/login-form.js';
import { renderDriverAccess } from './components/driver-screens.js';
import { decideDriverAccess, DRIVER_ACCESS_DENIED_MESSAGE } from '../shared/driver-access.js';
import { findDriverRow } from '../shared/driver-data.js';
import { DRIVER_REDIRECT_URL, extractAuthCode, needsOwnPassword } from '../shared/driver-oauth.js';

// Which top-level <section id="..."> each role may see, per docs/ROLE_PERMISSION_MATRIX.md.
// `null` means the section is public: always shown, logged in or not (the citizen portal is
// designed for anonymous access — see supabase/migrations/202607150006_sw020_rls_fixes.sql's
// anon_insert_citizen_report policy).
export const SECTION_ROLES = {
  resumen: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  operaciones: ['municipal_admin', 'supervisor', 'dispatcher', 'driver'],
  supervisor: ['supervisor'],
  impacto: ['municipal_admin', 'supervisor'],
  master: ['mt_superadmin'],
  // SW-049: operator-level preference (flujo guiado "Poner en marcha"), same audience as who can
  // actually assign vehicles/choferes to routes (OPS_SUBVIEW_ROLES.rutas/flota below) — supervisor
  // and driver never assign, so they don't need this toggle.
  configuracion: ['municipal_admin', 'dispatcher'],
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
  // SW-044: deployment-level opt-out of ever showing the bundled demo data (frontend/app.js clears
  // trucks/routes/drivers/incidents on module init when this is true) — defaults to false/absent,
  // so every existing deployment (including a plain frontend/index.html with no config at all)
  // keeps behaving exactly as before.
  return { url: config.url, anonKey: config.anonKey, municipality_id: config.municipality_id ?? null, hideDemo: Boolean(config.hideDemo), ...(config.googleLogin === true ? { googleLogin: true } : {}) };
}

// SW-032: the client initAuthGate() creates below is what carries the signed-in session (JWT) —
// features added later that need to call an Edge Function as the logged-in user (e.g. the "Crear
// cuenta de acceso" button) reuse this exact client instead of standing up a second one, so there
// is only ever one source of truth for "am I signed in right now". null until initAuthGate() has
// actually run and resolved a config (mirrors this file's opt-in-only behavior).
let authClient = null;
export function getAuthClient() { return authClient; }

// SW-085: el APK del conductor (mobile/scripts/build-web.mjs) fija window.SMARTWASTE_DRIVER_APP = true.
// Solo en ese modo el acceso usa la pantalla del conductor, el botón de Google y la regla de "solo registrados".
export const isDriverApp = (win = globalThis.window) => win?.SMARTWASTE_DRIVER_APP === true;

// Provisioned accounts receive this Auth-owned marker when their initial credential is temporary.
// The marker, rather than the account role, is the source of truth: drivers, municipal admins, and
// any future provisioned role must all replace a temporary password before entering the app.
export function requiresPasswordChange(user) {
  return user?.user_metadata?.requires_password_change === true;
}

export async function setOwnPassword(client, password) {
  if (!client?.auth?.updateUser) throw new Error('Supabase client with auth.updateUser is required');
  const result = await client.auth.updateUser({
    password,
    data: { requires_password_change: false }
  });
  if (result.error) throw new Error(result.error.message);
  return result.data?.user ?? null;
}

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

// SW-088: acceso web del personal (diseño Mando). Sin registro: las cuentas las crea el administrador.
function renderOverlay(errorMessage = '') {
  const config = readSupabaseConfig();
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'sw-login-overlay';
  overlay.innerHTML = renderStaffLogin({ demo: isDemoUi(config), googleEnabled: Boolean(config?.googleLogin), errorMessage });
  document.body.append(overlay);
  return overlay;
}

function renderDriverOverlay(errorMessage = '') {
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'sw-driver-overlay';
  overlay.innerHTML = renderDriverAccess({ errorMessage });
  document.body.append(overlay);
  return overlay;
}

export function renderPasswordChangeOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <form id="passwordChangeForm" class="auth-card">
      <h2>Establece tu contraseña</h2>
      <p>Antes de continuar, reemplaza la contraseña temporal por una contraseña propia.</p>
      <label>Nueva contraseña<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <label>Confirmar contraseña<input type="password" name="confirmation" required minlength="8" autocomplete="new-password"></label>
      <button type="submit">Guardar contraseña y continuar</button>
      <p id="authError" class="auth-error" role="alert"></p>
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
  const driverApp = isDriverApp();
  // Antes de crear el cliente (que limpia la URL): ¿venimos de regresar de Google o de un enlace de recuperación?
  const returnUrl = `${globalThis.window?.location?.search ?? ''}${globalThis.window?.location?.hash ?? ''}`;
  const oauthReturn = !driverApp && /access_token=|[?&]code=/.test(returnUrl);
  const recoveryReturn = !driverApp && /type=recovery/.test(returnUrl);
  const client = createClient(config.url, config.anonKey, driverApp ? driverAuthOptions() : undefined);
  authClient = client;
  const identity = createIdentityProvider(client);

  applySectionVisibility([]);
  applyOpsViewVisibility([]);

  async function resolveAuthenticatedUser() {
    try {
      const [ctx, userResult] = await Promise.all([identity.resolveContext(), client.auth.getUser()]);
      if (userResult.error || !userResult.data?.user) return null;
      return { ctx, user: userResult.data.user };
    } catch {
      return null;
    }
  }

  function grantApplicationAccess(ctx) {
    applySectionVisibility(pickVisibleSections(ctx.role));
    applyOpsViewVisibility(pickVisibleOpsViews(ctx.role));
    renderLogoutButton(client);
  }

  function requireOwnPassword(resolved) {
    const passwordOverlay = renderPasswordChangeOverlay();
    return new Promise((resolve) => {
      passwordOverlay.querySelector('#passwordChangeForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = passwordOverlay.querySelector('#authError');
        errorEl.textContent = '';
        const formData = new FormData(event.target);
        const password = formData.get('password');
        if (password !== formData.get('confirmation')) {
          errorEl.textContent = 'Las contraseñas no coinciden.';
          return;
        }
        const button = event.target.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          await setOwnPassword(client, password);
          passwordOverlay.remove();
          grantApplicationAccess(resolved.ctx);
          resolve(resolved.ctx);
        } catch {
          errorEl.textContent = 'No se pudo actualizar la contraseña. Intenta nuevamente.';
          button.disabled = false;
        }
      });
    });
  }

  // SW-085 (CA7): en el APK del conductor, tras CUALQUIER inicio de sesión se comprueba que el correo esté
  // registrado como conductor activo. Si no, se cierra la sesión. Las reglas de seguridad (RLS) son la última capa.
  async function checkDriverAccess(resolved) {
    if (!driverApp) return { allowed: true };
    try {
      const driver = await findDriverRow(client, { userId: resolved.user.id, municipalityId: resolved.ctx.municipality_id, email: resolved.user.email });
      return decideDriverAccess({ authEmail: resolved.user.email, role: resolved.ctx.role, municipalityId: resolved.ctx.municipality_id, driver, userId: resolved.user.id });
    } catch (error) {
      // Sin señal no es lo mismo que "correo no registrado": la sesión guardada se conserva.
      return { allowed: false, connectivity: isConnectivityError(error), message: 'No se pudo comprobar tu acceso. Revisa tu conexión e inténtalo de nuevo.' };
    }
  }

  // Reload with an existing signed-in session: skip the form if we can resolve a context.
  let initialError = '';
  const existing = await resolveAuthenticatedUser();
  if (existing) {
    const access = await checkDriverAccess(existing);
    if (access.allowed) {
      if (needsOwnPassword(existing.user) || recoveryReturn) return requireOwnPassword(existing);
      grantApplicationAccess(existing.ctx);
      return existing.ctx;
    }
    if (!access.connectivity) await client.auth.signOut();
    initialError = access.message ?? DRIVER_ACCESS_DENIED_MESSAGE;
  }

  // SW-088: regresó de Google pero esa cuenta no tiene membresía: se cierra la sesión y se explica (nunca se crea nada).
  if (!existing && oauthReturn) {
    const stored = await client.auth.getSession().catch(() => null);
    if (stored?.data?.session) { await client.auth.signOut(); initialError = NO_ACCESS_MESSAGE; }
  }
  const overlay = driverApp ? renderDriverOverlay(initialError) : renderOverlay(initialError);
  return new Promise((resolve) => {
    const errorEl = overlay.querySelector('#authError, [role="alert"]');
    const showError = (message) => { if (errorEl) errorEl.textContent = message; };

    async function finishSignIn() {
      const resolved = await resolveAuthenticatedUser();
      if (!resolved) { showError(driverApp ? DRIVER_ACCESS_DENIED_MESSAGE : 'Sesión iniciada, pero sin membresía activa en ningún municipio.'); await client.auth.signOut(); return; }
      const access = await checkDriverAccess(resolved);
      if (!access.allowed) { showError(access.message); await client.auth.signOut(); return; }
      overlay.remove();
      // D5: quien entra con Google no repite la contraseña temporal; con correo y contraseña sí.
      if (needsOwnPassword(resolved.user)) { resolve(await requireOwnPassword(resolved)); return; }
      grantApplicationAccess(resolved.ctx);
      resolve(resolved.ctx);
    }

    overlay.querySelector('#skipToPublic')?.addEventListener('click', (event) => {
      event.preventDefault();
      overlay.remove();
      applySectionVisibility(pickVisibleSections(null));
      applyOpsViewVisibility(pickVisibleOpsViews(null));
      resolve(null);
    });

    overlay.querySelector('#driverLoginForm, #authForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      showError('');
      const formData = new FormData(event.target);
      let credentials = { email: formData.get('email'), password: formData.get('password') };
      if (!driverApp) {
        const check = validateLogin(credentials);
        if (!check.ok) { showError(check.message); return; }
        credentials = check.values;
      }
      const { error: signInError } = await client.auth.signInWithPassword(credentials);
      if (signInError) { showError(driverApp ? 'Credenciales inválidas.' : loginErrorMessage(signInError)); return; }
      await finishSignIn();
    });

    if (!driverApp) {
      // Google solo entra a cuentas que ya existen (los registros nuevos van desactivados en Supabase).
      overlay.querySelector('[data-staff-google]')?.addEventListener('click', async () => {
        showError('');
        const redirectTo = `${globalThis.window.location.origin}${globalThis.window.location.pathname}`;
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        if (error) showError(googleErrorMessage(error.message));
      });
      overlay.querySelector('[data-staff-forgot]')?.addEventListener('click', async () => {
        const email = String(overlay.querySelector('input[name="email"]')?.value ?? '').trim();
        if (!email) { showError('Escribe tu correo arriba y vuelve a tocar "¿Olvidaste tu contraseña?".'); return; }
        const redirectTo = `${globalThis.window.location.origin}${globalThis.window.location.pathname}`;
        try { await client.auth.resetPasswordForEmail(email, { redirectTo }); } catch { /* mensaje neutro igual */ }
        showError(FORGOT_MESSAGE);
      });
    }

    if (driverApp) {
      const native = Boolean(globalThis.window?.Capacitor?.isNativePlatform?.());
      const plugins = globalThis.window?.Capacitor?.Plugins ?? {};
      overlay.querySelector('[data-driver-google]')?.addEventListener('click', async () => {
        showError('');
        const redirectTo = native ? DRIVER_REDIRECT_URL : globalThis.window.location.href.split('#')[0];
        const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
        if (error || !data?.url) { showError('No se pudo abrir Google. Inténtalo de nuevo.'); return; }
        if (native && plugins.Browser?.open) await plugins.Browser.open({ url: data.url });
        else globalThis.window.location.assign(data.url);
      });
      // Regreso de Google al enlace profundo de la app: se completa la sesión con el código (PKCE).
      plugins.App?.addListener?.('appUrlOpen', async ({ url }) => {
        const result = extractAuthCode(url);
        if (!result) return;
        plugins.Browser?.close?.();
        if (result.error) { showError(/sign.?ups?|not allowed|database error/i.test(result.error) ? DRIVER_ACCESS_DENIED_MESSAGE : 'No se pudo entrar con Google. Inténtalo de nuevo.'); return; }
        const { error } = await client.auth.exchangeCodeForSession(result.code);
        if (error) { showError('No se pudo entrar con Google. Inténtalo de nuevo.'); return; }
        await finishSignIn();
      });
      overlay.querySelector('[data-driver-forgot]')?.addEventListener('click', async () => {
        const email = String(overlay.querySelector('input[name="email"]')?.value ?? '').trim();
        if (!email) { showError('Escribe tu correo arriba y vuelve a tocar "¿Olvidaste tu contraseña?".'); return; }
        await client.auth.resetPasswordForEmail(email);
        showError('Si tu correo está registrado, recibirás un enlace para cambiar tu contraseña.');
      });
    }
  });
}

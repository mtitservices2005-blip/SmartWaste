// SW-085: piezas puras del acceso con Google en la app del conductor (sin red ni DOM).
// El flujo: la app abre el navegador con la URL que da Supabase (signInWithOAuth, skipBrowserRedirect),
// Google devuelve al enlace profundo de la app, y con el código se completa la sesión (PKCE).
export const DRIVER_REDIRECT_URL = 'com.mtitservices.smartwaste.driver://auth';

export function extractAuthCode(url) {
  if (typeof url !== 'string' || !url.startsWith(DRIVER_REDIRECT_URL)) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const fromHash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const param = (key) => parsed.searchParams.get(key) ?? fromHash.get(key);
  const error = param('error_description') ?? param('error');
  if (error) return { error };
  const code = param('code');
  return code ? { code } : null;
}

export function signedInWithGoogle(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  if (!identities.length) return false;
  const latest = identities.reduce((a, b) => (new Date(b.last_sign_in_at ?? 0) > new Date(a.last_sign_in_at ?? 0) ? b : a));
  return latest.provider === 'google';
}

// D5 (confirmada por Miguel): quien entra con Google no tiene que cambiar la contraseña temporal.
export function needsOwnPassword(user) {
  return user?.user_metadata?.requires_password_change === true && !signedInWithGoogle(user);
}

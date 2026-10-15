// SW-087 (D3): sesión guardada del conductor. El cliente de Supabase guarda la sesión en el almacenamiento del
// teléfono y renueva el token solo; estas opciones lo dejan explícito. Lógica pura, sin red.
export function driverAuthOptions() {
  return { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true } };
}

const CONNECTIVITY_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout|offline|fetch failed|err_internet/i;

// ¿El error es de conexión (sin señal, DNS, tiempo agotado, puerta de enlace) y no una negativa real del servidor?
export function isConnectivityError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'AuthRetryableFetchError' || error.name === 'TypeError') return true;
  if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) return true;
  return CONNECTIVITY_MESSAGE.test(String(error.message ?? ''));
}

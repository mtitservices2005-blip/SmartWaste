// SW-127: ajustes de la integración con Saibot (clave del ayuntamiento, recepción activa y dirección del aviso de cierre).
// La clave solo se muestra al generarla; en la base solo queda su hash.
export function saibotErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/saibot_not_allowed/.test(m)) return 'Solo el administrador del ayuntamiento puede cambiar esta integración.';
  if (/saibot_invalid_url/.test(m)) return 'La dirección debe empezar con https:// y no tener espacios.';
  if (/saibot_no_key/.test(m)) return 'Primero genera una clave.';
  if (/fetch|network|failed to send/.test(m)) return 'Sin conexión. Inténtalo de nuevo.';
  return null;
}
const fail = (error) => ({ ok: false, message: saibotErrorMessage(error?.message ?? error) ?? `No se pudo completar: ${error?.message ?? error ?? 'error desconocido'}` });

export function validateCallbackUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return { valid: true, url: '' };
  if (url.length > 500 || !/^https:\/\/[^\s]+$/.test(url)) return { valid: false, url, message: saibotErrorMessage('saibot_invalid_url') };
  return { valid: true, url };
}

export function ingestEndpoint(supabaseUrl) {
  const base = String(supabaseUrl ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/functions/v1/saibot-ingest-report` : '';
}

export async function fetchSaibotIntegration(client, municipalityId) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const r = await client.rpc('get_saibot_integration', { p_municipality_id: municipalityId });
  if (r.error) return fail(r.error);
  const d = r.data ?? {};
  return { ok: true, configured: Boolean(d.configured), enabled: d.enabled !== false, last4: d.last4 ?? '', callbackUrl: d.callback_url ?? '', lastUsedAt: d.last_used_at ?? null };
}

export async function generateSaibotKey(client, municipalityId) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const r = await client.rpc('generate_saibot_key', { p_municipality_id: municipalityId });
  if (r.error) return fail(r.error);
  return { ok: true, key: r.data?.key ?? '', last4: r.data?.last4 ?? '' };
}

export async function saveSaibotSettings(client, municipalityId, { enabled = true, callbackUrl = '' } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const check = validateCallbackUrl(callbackUrl);
  if (!check.valid) return { ok: false, message: check.message };
  const r = await client.rpc('set_saibot_integration', { p_municipality_id: municipalityId, p_enabled: Boolean(enabled), p_callback_url: check.url || null });
  if (r.error) return fail(r.error);
  return { ok: true, enabled: r.data?.enabled !== false, callbackUrl: r.data?.callback_url ?? '' };
}

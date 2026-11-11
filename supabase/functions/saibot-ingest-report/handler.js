// SW-127: entrada de reportes de Saibot. Contrato en docs/INTEGRACION_SAIBOT.md.
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_BODY = 20000;
const RATE_LIMIT_PER_MINUTE = 60;
const KEY_RE = /^swk_[0-9a-f]{64}$/;

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Valida el cuerpo y devuelve el registro listo para guardar. Nunca lanza.
export function validateReportPayload(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'El cuerpo debe ser un objeto JSON.' };
  const externalId = clean(body.external_id, 200);
  if (!externalId || externalId.length > 80) return { ok: false, error: 'external_id es obligatorio (máximo 80 caracteres).' };
  const description = clean(body.description, 5000);
  if (!description || description.length > 500) return { ok: false, error: 'description es obligatoria (máximo 500 caracteres).' };
  const reportedAt = new Date(body.reported_at);
  if (typeof body.reported_at !== 'string' || Number.isNaN(reportedAt.getTime())) return { ok: false, error: 'reported_at debe ser una fecha ISO 8601.' };
  if (reportedAt.getTime() > now.getTime() + 24 * 3600000) return { ok: false, error: 'reported_at no puede estar en el futuro.' };
  const loc = body.location && typeof body.location === 'object' ? body.location : {};
  let latitude = null; let longitude = null;
  if (loc.lat !== undefined || loc.lng !== undefined) {
    latitude = typeof loc.lat === 'number' ? loc.lat : NaN; longitude = typeof loc.lng === 'number' ? loc.lng : NaN;
    if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) return { ok: false, error: 'location.lat y location.lng deben ser números válidos (juntos).' };
  }
  const reference = loc.reference === undefined ? null : clean(loc.reference, 400);
  if (reference && reference.length > 200) return { ok: false, error: 'location.reference admite máximo 200 caracteres.' };
  const photosRaw = body.photos === undefined ? [] : body.photos;
  if (!Array.isArray(photosRaw) || photosRaw.length > 5) return { ok: false, error: 'photos admite hasta 5 enlaces.' };
  const photos = [];
  for (const url of photosRaw) {
    if (typeof url !== 'string' || url.length > 500 || !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: 'Cada foto debe ser un enlace https (máximo 500 caracteres).' };
    photos.push(url);
  }
  return { ok: true, value: { external_id: externalId, description, reference: reference || null, latitude, longitude, photo_urls: photos, reported_at: reportedAt.toISOString() } };
}

export function createSaibotIngestHandler({ createClient, env, now = () => new Date() }) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
    const supabaseUrl = env.get('SUPABASE_URL');
    const serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Function is missing required environment configuration' }, 500);

    const key = req.headers.get('X-SmartWaste-Key') ?? '';
    if (!KEY_RE.test(key)) return json({ error: 'Clave inválida.' }, 401);
    const raw = await req.text().catch(() => '');
    if (raw.length > MAX_BODY) return json({ error: 'El cuerpo es demasiado grande.' }, 413);

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const hash = await sha256Hex(key);
    const integ = await db.from('saibot_integrations').select('municipality_id, enabled').eq('key_hash', hash).maybeSingle();
    if (integ.error) return json({ error: 'No se pudo validar la clave.' }, 500);
    if (!integ.data || integ.data.enabled !== true) return json({ error: 'Clave inválida o desactivada.' }, 401);
    const municipalityId = integ.data.municipality_id;

    let body = null;
    try { body = JSON.parse(raw); } catch { return json({ error: 'El cuerpo no es JSON válido.' }, 400); }
    const check = validateReportPayload(body, now());
    if (!check.ok) return json({ error: check.error }, 400);

    const since = new Date(now().getTime() - 60000).toISOString();
    const recent = await db.from('waste_reports').select('id', { count: 'exact', head: true }).eq('municipality_id', municipalityId).gte('created_at', since);
    if (!recent.error && (recent.count ?? 0) >= RATE_LIMIT_PER_MINUTE) return json({ error: 'Demasiados reportes por minuto. Reintenta en un minuto.' }, 429, { 'Retry-After': '60' });

    const existing = async () => db.from('waste_reports').select('id, status').eq('municipality_id', municipalityId).eq('source', 'saibot').eq('external_id', check.value.external_id).maybeSingle();
    const before = await existing();
    if (before.error) return json({ error: 'No se pudo guardar el reporte.' }, 500);
    if (before.data) return json({ id: before.data.id, status: before.data.status, duplicate: true }, 200);

    const inserted = await db.from('waste_reports').insert({ municipality_id: municipalityId, source: 'saibot', ...check.value }).select('id, status').single();
    if (inserted.error) {
      if (inserted.error.code === '23505') { const again = await existing(); if (again.data) return json({ id: again.data.id, status: again.data.status, duplicate: true }, 200); }
      return json({ error: 'No se pudo guardar el reporte.' }, 500);
    }
    await db.from('saibot_integrations').update({ last_used_at: now().toISOString() }).eq('municipality_id', municipalityId); // mejor esfuerzo
    return json({ id: inserted.data.id, status: inserted.data.status }, 201);
  };
}

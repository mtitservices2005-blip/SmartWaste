// SW-119: datos del ayuntamiento (nombre oficial, logo, contacto y firmantes de los reportes).
// Se guardan en municipality_settings.settings.profile (misma tabla y mismas reglas de acceso que los parámetros de costo,
// SW-030): cada ayuntamiento lee y escribe solo lo suyo, y Master Admin no necesita permisos nuevos. Sin migración.
// Módulo puro: el cliente de Supabase llega por parámetro.

export const MAX_SIGNERS = 3;
export const LOGO_MAX_SIDE = 320; // px del lado mayor
export const LOGO_MAX_BYTES = 150 * 1024; // tope del data URL ya reducido
const LIMITS = { officialName: 120, address: 160, phone: 30, email: 120, signerName: 80, signerRole: 60 };
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_PROFILE = Object.freeze({ officialName: '', logo: '', address: '', phone: '', email: '', signers: [] });

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Lo guardado puede estar vacío, incompleto o viejo: se limpia campo por campo y nunca rompe la pantalla.
export function normalizeProfile(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const signers = (Array.isArray(r.signers) ? r.signers : [])
    .map((s) => ({ name: text(s?.name, LIMITS.signerName), role: text(s?.role, LIMITS.signerRole) }))
    .filter((s) => s.name || s.role)
    .slice(0, MAX_SIGNERS);
  const logo = typeof r.logo === 'string' && LOGO_RE.test(r.logo) && r.logo.length <= LOGO_MAX_BYTES ? r.logo : '';
  return {
    officialName: text(r.officialName, LIMITS.officialName),
    logo,
    address: text(r.address, LIMITS.address),
    phone: text(r.phone, LIMITS.phone),
    email: text(r.email, LIMITS.email),
    signers
  };
}

export function isProfileConfigured(profile) {
  const p = normalizeProfile(profile);
  return Boolean(p.officialName || p.logo || p.address || p.phone || p.email || p.signers.length);
}

export function validateProfile(raw) {
  const p = normalizeProfile(raw);
  const errors = [];
  if (!p.officialName) errors.push('Escribe el nombre oficial del ayuntamiento.');
  if (p.email && !EMAIL_RE.test(p.email)) errors.push('El correo no parece válido. Revisa que tenga la forma nombre@dominio.com.');
  if (typeof raw?.logo === 'string' && raw.logo && !p.logo) errors.push('El logo no es válido o es demasiado pesado. Usa una imagen PNG o JPG.');
  const incomplete = (Array.isArray(raw?.signers) ? raw.signers : []).some((s) => (text(s?.name, 200) && !text(s?.role, 200)) || (!text(s?.name, 200) && text(s?.role, 200)));
  if (incomplete) errors.push('Cada firmante necesita nombre y cargo.');
  if ((Array.isArray(raw?.signers) ? raw.signers : []).filter((s) => text(s?.name, 200) || text(s?.role, 200)).length > MAX_SIGNERS) errors.push(`Máximo ${MAX_SIGNERS} firmantes.`);
  return { valid: errors.length === 0, errors, profile: p };
}

// Tamaño reducido que conserva la proporción; nunca agranda.
export function fitLogoSize(width, height, maxSide = LOGO_MAX_SIDE) {
  const w = Number(width); const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// Identidad que usan los reportes: el nombre oficial manda; sin él, "Ayuntamiento de <nombre del municipio>".
export function reportIdentity(profile, fallbackName = '') {
  const p = normalizeProfile(profile);
  const name = p.officialName || (fallbackName ? `Ayuntamiento de ${fallbackName}` : 'Ayuntamiento');
  return { name, logo: p.logo, contact: [p.address, p.phone, p.email].filter(Boolean), signers: p.signers };
}

// Nombre corto para títulos de pantalla ("Corridas completadas en ...").
export function displayName(profile, fallbackName = '') {
  return normalizeProfile(profile).officialName || fallbackName;
}

export async function fetchMunicipalityProfile(client, municipality_id) {
  if (!client?.from) return { ok: false, error: { code: 'SUPABASE_CLIENT_MISSING', message: 'No hay backend real configurado.' } };
  if (!municipality_id) return { ok: false, error: { code: 'NO_MUNICIPALITY', message: 'Falta municipality_id.' } };
  const result = await client.from('municipality_settings').select('settings').eq('municipality_id', municipality_id).maybeSingle();
  if (result.error) return { ok: false, error: { code: result.error.code ?? 'SUPABASE_ERROR', message: result.error.message } };
  const profile = normalizeProfile(result.data?.settings?.profile);
  return { ok: true, profile, configured: isProfileConfigured(profile) };
}

// Lee-modifica-escribe: `settings` es un jsonb compartido (parámetros de costo, etc.); no se pisa nada que no sea `profile`.
export async function saveMunicipalityProfile(client, municipality_id, raw) {
  if (!client?.from) return { ok: false, error: { code: 'SUPABASE_CLIENT_MISSING', message: 'No hay backend real configurado.' } };
  if (!municipality_id) return { ok: false, error: { code: 'NO_MUNICIPALITY', message: 'Falta municipality_id.' } };
  const check = validateProfile(raw);
  if (!check.valid) return { ok: false, error: { code: 'INVALID_PROFILE', message: check.errors.join(' ') } };
  const existing = await client.from('municipality_settings').select('id, settings').eq('municipality_id', municipality_id).maybeSingle();
  if (existing.error) return { ok: false, error: { code: existing.error.code ?? 'SUPABASE_ERROR', message: existing.error.message } };
  const nextSettings = { ...(existing.data?.settings ?? {}), profile: check.profile };
  const write = existing.data
    ? await client.from('municipality_settings').update({ settings: nextSettings }).eq('id', existing.data.id).select('settings').single()
    : await client.from('municipality_settings').insert({ municipality_id, settings: nextSettings }).select('settings').single();
  if (write.error) return { ok: false, error: { code: write.error.code ?? 'SUPABASE_ERROR', message: write.error.message } };
  return { ok: true, profile: normalizeProfile(write.data.settings.profile) };
}

// Demo sin backend: memoria por ayuntamiento, misma forma que las funciones reales.
export function createDemoProfileStore() {
  const store = new Map();
  return {
    get(id) { const profile = normalizeProfile(store.get(id)); return { ok: true, profile, configured: isProfileConfigured(profile) }; },
    save(id, raw) {
      const check = validateProfile(raw);
      if (!check.valid) return { ok: false, error: { code: 'INVALID_PROFILE', message: check.errors.join(' ') } };
      store.set(id, check.profile);
      return { ok: true, profile: check.profile };
    }
  };
}

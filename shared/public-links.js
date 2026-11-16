// SW-132: cada ayuntamiento tiene su propia dirección pública, que se arma con su slug (único en la base de datos).
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidSlug = (slug) => typeof slug === 'string' && slug.length >= 2 && slug.length <= 60 && SLUG_RE.test(slug);

// Dirección del mapa en vivo de un ayuntamiento: https://<sitio>/en-vivo/<slug>
export function liveMapUrl(origin, slug) {
  const base = String(origin ?? '').trim().replace(/\/+$/, '');
  return base && isValidSlug(slug) ? `${base}/en-vivo/${slug}` : '';
}

// Saca el slug de la dirección: /en-vivo/<slug> (preferida) o ?m=<slug> (enlaces anteriores). Vacío si no hay o es inválido.
export function slugFromLocation(loc = {}) {
  const parts = String(loc.pathname ?? '').split('/').filter(Boolean);
  let fromPath = '';
  if (parts[0] === 'en-vivo' && parts[1]) { try { fromPath = decodeURIComponent(parts[1]).toLowerCase(); } catch { fromPath = ''; } }
  if (isValidSlug(fromPath)) return fromPath;
  const fromQuery = String(new URLSearchParams(String(loc.search ?? '')).get('m') ?? '').trim().toLowerCase();
  return isValidSlug(fromQuery) ? fromQuery : '';
}

// Nombre y slug del ayuntamiento de la sesión (los miembros leen su propia fila por RLS).
export async function fetchMunicipalityPublicInfo(client, municipalityId) {
  if (!client?.from || !municipalityId) return { ok: false, message: 'No hay sesión activa.' };
  const r = await client.from('municipalities').select('slug,name').eq('id', municipalityId).maybeSingle();
  if (r.error) return { ok: false, message: 'No se pudo leer el ayuntamiento.' };
  if (!r.data) return { ok: false, message: 'No se encontró el ayuntamiento.' };
  return { ok: true, slug: r.data.slug ?? '', name: r.data.name ?? '' };
}

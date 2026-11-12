// SW-130: peso y destino de lo que se recoge. Todo es opcional por ayuntamiento.
// Modos: off (no se registra), trips (solo viaje y destino), estimated (cuán lleno iba el camión), scale (con báscula).
export const MODES = ['off', 'trips', 'estimated', 'scale'];
export const MODE_LABEL = { off: 'No registrar', trips: 'Solo viaje y destino', estimated: 'Estimado por llenado del camión', scale: 'Con báscula' };
export const MODE_HINT = {
  off: 'No se muestra nada de peso ni destino.',
  trips: 'Se anota cada descarga y su destino, sin peso.',
  estimated: 'Se indica qué tan lleno iba el camión y SmartWaste calcula el peso con la capacidad típica. Siempre se marca como estimado.',
  scale: 'Se anota el peso y el número del ticket de la báscula. Si no hay ticket, se puede dejar sin peso.'
};
export const SITE_KINDS = { landfill: 'Relleno sanitario', transfer: 'Estación de transferencia', plant: 'Planta de valorización', collection_center: 'Centro de acopio', other: 'Otro' };
export const SOURCE_LABEL = { scale: 'Pesado', estimated: 'Estimado', none: 'Sin peso' };
export const FILL_LEVELS = [25, 50, 75, 100];
export const MAX_CAPACITY_KG = 100000;
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'off', defaultCapacityKg: null });

export function normalizeWasteSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(r.mode) ? r.mode : DEFAULT_SETTINGS.mode;
  const cap = Number(r.defaultCapacityKg);
  return { mode, defaultCapacityKg: Number.isFinite(cap) && cap > 0 && cap <= MAX_CAPACITY_KG ? Math.round(cap) : null };
}
export const isEnabled = (settings) => normalizeWasteSettings(settings).mode !== 'off';

export function estimateWeight(capacityKg, fillLevel) {
  const cap = Number(capacityKg);
  if (!(cap > 0) || !FILL_LEVELS.includes(Number(fillLevel))) return null;
  return Math.round(cap * Number(fillLevel)) / 100;
}

// Qué fuentes ofrece el formulario según el modo.
export function sourcesForMode(mode, settings = {}) {
  if (mode === 'scale') return ['scale', 'none'];
  if (mode === 'estimated') return normalizeWasteSettings(settings).defaultCapacityKg ? ['estimated', 'scale', 'none'] : ['scale', 'none'];
  if (mode === 'trips') return ['none'];
  return [];
}

export function validateDisposalInput(input = {}, { mode = 'trips', settings = {} } = {}) {
  const errors = [];
  const source = input.source;
  if (!sourcesForMode(mode, settings).includes(source)) errors.push('Esa forma de registrar el peso no está activa en Configuración.');
  if (!input.vehicleId) errors.push('Elige el camión.');
  if (source === 'scale') { const w = Number(input.weightKg); if (!(input.weightKg !== '' && input.weightKg != null && Number.isFinite(w) && w >= 0 && w <= MAX_CAPACITY_KG)) errors.push('Escribe el peso en kilos (entre 0 y 100,000).'); }
  if (source === 'estimated' && !FILL_LEVELS.includes(Number(input.fillLevel))) errors.push('Elige qué tan lleno iba el camión.');
  if (String(input.ticket ?? '').length > 40) errors.push('El número de ticket admite hasta 40 caracteres.');
  if (String(input.note ?? '').length > 300) errors.push('La nota admite hasta 300 caracteres.');
  return { valid: errors.length === 0, errors };
}

export function formatKg(kg) {
  if (kg == null || kg === '') return '—';
  const n = Number(kg);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toLocaleString('es-DO', { maximumFractionDigits: 2 })} t`;
  return `${n.toLocaleString('es-DO', { maximumFractionDigits: 1 })} kg`;
}

// Resumen de un período: toneladas, cuánto es pesado/estimado y cuántas descargas quedaron sin dato. Las anuladas no cuentan.
export function summarizeDisposals(list = [], { sinceMs = null, now = new Date(), sites = [] } = {}) {
  const from = sinceMs == null ? -Infinity : now.getTime() - sinceMs;
  const rows = list.filter((d) => !d.voided_at && new Date(d.unloaded_at).getTime() >= from);
  const sum = (src) => rows.filter((d) => d.weight_source === src).reduce((a, d) => a + (Number(d.weight_kg) || 0), 0);
  const scale = sum('scale'); const estimated = sum('estimated');
  const bySite = new Map();
  for (const d of rows) { const key = d.site_id ?? ''; const cur = bySite.get(key) ?? { siteId: key || null, name: '', kg: 0, count: 0 }; cur.kg += Number(d.weight_kg) || 0; cur.count += 1; bySite.set(key, cur); }
  const names = new Map(sites.map((s) => [s.id, s.name]));
  const byDestination = [...bySite.values()].map((s) => ({ ...s, name: s.siteId ? (names.get(s.siteId) ?? 'Sitio eliminado') : 'Sin destino' })).sort((a, b) => b.kg - a.kg);
  return { count: rows.length, totalKg: scale + estimated, scaleKg: scale, estimatedKg: estimated, withoutWeight: rows.filter((d) => d.weight_source === 'none').length, byDestination };
}

export function disposalErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/disposal_not_allowed/.test(m)) return 'No tienes permiso para hacer este cambio.';
  if (/disposal_no_capacity/.test(m)) return 'Para estimar el peso, primero escribe la capacidad típica del camión en Configuración.';
  if (/disposal_invalid_weight/.test(m)) return 'El peso debe estar entre 0 y 100,000 kilos.';
  if (/disposal_invalid_date/.test(m)) return 'La fecha de descarga no puede ser futura ni de hace más de 60 días.';
  if (/disposal_duplicate/.test(m)) return 'Ya hay un sitio con ese nombre.';
  if (/disposal_already_voided/.test(m)) return 'Esa descarga ya estaba anulada. Actualiza la lista.';
  if (/disposal_not_found/.test(m)) return 'No se encontró el camión, la ruta o el sitio. Actualiza la lista; si el sitio está desactivado, elige otro.';
  if (/disposal_invalid/.test(m)) return 'Revisa los datos: el motivo de la anulación lleva al menos 3 letras y el nombre del sitio hasta 80.';
  if (/fetch|network|failed to send/.test(m)) return 'Sin conexión. Inténtalo de nuevo.';
  return null;
}
const fail = (error) => ({ ok: false, message: disposalErrorMessage(error?.message ?? error) ?? `No se pudo completar: ${error?.message ?? error ?? 'error desconocido'}` });

export async function fetchWasteSettings(client, municipalityId) {
  if (!client?.from) return fail('No hay sesión activa.');
  const r = await client.from('municipality_settings').select('settings').eq('municipality_id', municipalityId).maybeSingle();
  if (r.error) return fail(r.error);
  return { ok: true, settings: normalizeWasteSettings(r.data?.settings?.waste) };
}

// Lee-modifica-escribe: `settings` es un jsonb compartido con costos, chequeo y datos del ayuntamiento.
export async function saveWasteSettings(client, municipalityId, raw) {
  if (!client?.from) return fail('No hay sesión activa.');
  const settings = normalizeWasteSettings(raw);
  const existing = await client.from('municipality_settings').select('id, settings').eq('municipality_id', municipalityId).maybeSingle();
  if (existing.error) return fail(existing.error);
  const next = { ...(existing.data?.settings ?? {}), waste: settings };
  const write = existing.data
    ? await client.from('municipality_settings').update({ settings: next }).eq('id', existing.data.id).select('settings').single()
    : await client.from('municipality_settings').insert({ municipality_id: municipalityId, settings: next }).select('settings').single();
  if (write.error) return fail(write.error);
  return { ok: true, settings: normalizeWasteSettings(write.data.settings.waste) };
}

export async function fetchDisposalBoard(client, { days = 30, now = new Date() } = {}) {
  if (!client?.from) return fail('No hay sesión activa.');
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const [sites, disposals] = await Promise.all([
    client.from('disposal_sites').select('id,name,kind,active').order('name', { ascending: true }).limit(200),
    client.from('waste_disposals').select('id,vehicle_id,route_run_id,site_id,weight_kg,weight_source,ticket_number,fill_level,note,unloaded_at,voided_at,void_reason').is('voided_at', null).gte('unloaded_at', since).order('unloaded_at', { ascending: false }).limit(500)
  ]);
  if (sites.error) return fail(sites.error);
  if (disposals.error) return fail(disposals.error);
  return { ok: true, sites: sites.data ?? [], disposals: disposals.data ?? [] };
}

export async function saveDisposalSite(client, municipalityId, { id = null, name = '', kind = 'landfill', active = true } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const nm = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!nm || nm.length > 80) return { ok: false, message: 'Escribe el nombre del sitio (hasta 80 letras).' };
  if (!SITE_KINDS[kind]) return { ok: false, message: 'Elige el tipo de sitio.' };
  const r = await client.rpc('upsert_disposal_site', { p_municipality_id: municipalityId, p_site_id: id, p_name: nm, p_kind: kind, p_active: Boolean(active) });
  if (r.error) return fail(r.error);
  return { ok: true, site: r.data };
}

export async function recordDisposal(client, municipalityId, input = {}, ctx = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const check = validateDisposalInput(input, ctx);
  if (!check.valid) return { ok: false, message: check.errors.join(' ') };
  const r = await client.rpc('record_waste_disposal', {
    p_municipality_id: municipalityId, p_vehicle_id: input.vehicleId, p_route_run_id: input.runId ?? null, p_site_id: input.siteId || null,
    p_source: input.source, p_weight_kg: input.source === 'scale' ? Number(input.weightKg) : null,
    p_ticket: String(input.ticket ?? '').trim() || null, p_fill_level: input.source === 'estimated' ? Number(input.fillLevel) : null,
    p_note: String(input.note ?? '').trim() || null, p_unloaded_at: input.unloadedAt ?? null
  });
  if (r.error) return fail(r.error);
  return { ok: true, id: r.data?.id ?? null, weightKg: r.data?.weight_kg ?? null, source: r.data?.weight_source ?? input.source };
}

export async function voidDisposal(client, { disposalId, reason = '' } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 3) return { ok: false, message: 'Escribe el motivo de la anulación (al menos 3 letras).' };
  if (why.length > 300) return { ok: false, message: 'El motivo admite hasta 300 letras.' };
  const r = await client.rpc('void_waste_disposal', { p_disposal_id: disposalId, p_reason: why });
  if (r.error) return fail(r.error);
  return { ok: true };
}

// Etiquetas y ayudas que app.js pasa a los componentes (ellos no importan de shared/).
export const DISPOSAL_UI = Object.freeze({ MODES, MODE_LABEL, MODE_HINT, SITE_KINDS, SOURCE_LABEL, FILL_LEVELS, formatKg, sourcesForMode });

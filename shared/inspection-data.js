// SW-123: lecturas y escrituras del chequeo previo con el cliente de Supabase que llega por parámetro.
import { normalizeInspectionSettings, validateInspection, buildSubmitItems, summarizeInspection, inspectionErrorMessage, dayKey } from './inspection.js';

const fail = (error) => ({ ok: false, message: inspectionErrorMessage(error?.message ?? error) ?? `No se pudo completar: ${error?.message ?? error ?? 'error desconocido'}` });

export async function fetchInspectionSettings(client, municipalityId) {
  if (!client?.from) return fail('No hay sesión activa.');
  const r = await client.from('municipality_settings').select('settings').eq('municipality_id', municipalityId).maybeSingle();
  if (r.error) return fail(r.error);
  return { ok: true, settings: normalizeInspectionSettings(r.data?.settings?.inspection) };
}

// Lee-modifica-escribe: `settings` es un jsonb compartido con los parámetros de costo y los datos del ayuntamiento.
export async function saveInspectionSettings(client, municipalityId, raw) {
  if (!client?.from) return fail('No hay sesión activa.');
  const settings = normalizeInspectionSettings(raw);
  const existing = await client.from('municipality_settings').select('id, settings').eq('municipality_id', municipalityId).maybeSingle();
  if (existing.error) return fail(existing.error);
  const next = { ...(existing.data?.settings ?? {}), inspection: settings };
  const write = existing.data
    ? await client.from('municipality_settings').update({ settings: next }).eq('id', existing.data.id).select('settings').single()
    : await client.from('municipality_settings').insert({ municipality_id: municipalityId, settings: next }).select('settings').single();
  if (write.error) return fail(write.error);
  return { ok: true, settings: normalizeInspectionSettings(write.data.settings.inspection) };
}

// Chequeos recientes del camión y fallas abiertas, para decidir si hay que pedir el chequeo y qué mostrarle al chofer.
export async function fetchVehicleInspectionState(client, { vehicleId, now = new Date() } = {}) {
  if (!client?.from || !vehicleId) return fail('Falta el camión.');
  const since = new Date(now.getTime() - 3 * 86400000).toISOString();
  const [ins, defects] = await Promise.all([
    client.from('vehicle_inspections').select('id,vehicle_id,driver_id,departed,result,created_at').eq('vehicle_id', vehicleId).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
    client.from('vehicle_defects').select('id,item_key,label,severity,status,reported_at').eq('vehicle_id', vehicleId).in('status', ['reported', 'in_review', 'fixed']).order('reported_at', { ascending: false }).limit(20)
  ]);
  if (ins.error) return fail(ins.error);
  if (defects.error) return fail(defects.error);
  return { ok: true, inspections: ins.data ?? [], openDefects: defects.data ?? [] };
}

export async function submitInspection(client, { vehicleId, runId = null, results, note = '' } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  const check = validateInspection(results);
  if (!check.valid) return { ok: false, message: check.errors.join(' ') };
  const r = await client.rpc('submit_vehicle_inspection', { p_vehicle_id: vehicleId, p_route_run_id: runId, p_items: buildSubmitItems(results), p_note: String(note ?? '').slice(0, 300) || null });
  if (r.error) return fail(r.error);
  const d = r.data ?? {};
  return { ok: true, inspectionId: d.inspection_id ?? null, result: d.result ?? summarizeInspection(results).result, departed: d.departed !== false, defectsCreated: Number(d.defects_created) || 0 };
}

export { dayKey };

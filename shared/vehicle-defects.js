// SW-124: bandeja de fallas de los camiones. Recorrido: reportada → en revisión → corregida → verificada.
// Lo puro (estados, resúmenes, cumplimiento) no toca red; las funciones con `client` reciben el cliente de Supabase.
import { dayKey } from './inspection.js';

export const STATUS_LABEL = { reported: 'Reportada', in_review: 'En revisión', fixed: 'Corregida', verified: 'Verificada' };
export const SEVERITY_LABEL = { critical: 'Crítica', minor: 'Menor' };
const TRANSITIONS = { reported: ['in_review', 'fixed'], in_review: ['fixed', 'reported'], fixed: ['verified', 'in_review'], verified: [] };
export const MAX_NOTE = 300;

export const allowedTransitions = (status) => [...(TRANSITIONS[status] ?? [])];
export const isOpen = (d) => d && d.status !== 'verified';

// Críticas primero, luego las más viejas (llevan más tiempo esperando).
export function sortDefects(defects = []) {
  const sev = (d) => (d.severity === 'critical' ? 0 : 1);
  return [...defects].sort((a, b) => sev(a) - sev(b) || String(a.reported_at).localeCompare(String(b.reported_at)));
}

export function summarizeDefects(defects = []) {
  const open = defects.filter(isOpen);
  const awaiting = open.filter((d) => d.status === 'reported');
  return {
    open: open.length,
    critical: open.filter((d) => d.severity === 'critical').length,
    minor: open.filter((d) => d.severity !== 'critical').length,
    awaiting: awaiting.length,
    toVerify: open.filter((d) => d.status === 'fixed').length,
    vehicles: new Set(open.map((d) => d.vehicle_id)).size
  };
}

// vehicles: [{id, code}]; inspections y runs son los de hoy. "Debía chequearse" = tiene una ruta hoy.
export function inspectionCompliance({ vehicles = [], runs = [], inspections = [], now = new Date() } = {}) {
  const today = dayKey(now);
  const codeOf = new Map(vehicles.map((v) => [v.id, v.code ?? '—']));
  const checked = new Set(inspections.filter((i) => dayKey(i.created_at) === today).map((i) => i.vehicle_id));
  const todayRuns = runs.filter((r) => r.vehicle_id && ['started_at', 'scheduled_start_at'].some((k) => r[k] && dayKey(r[k]) === today));
  const expected = [...new Set(todayRuns.map((r) => r.vehicle_id))];
  const startedIds = new Set(todayRuns.filter((r) => r.started_at && dayKey(r.started_at) === today).map((r) => r.vehicle_id));
  const label = (id) => codeOf.get(id) ?? '—';
  return {
    total: expected.length,
    checked: expected.filter((id) => checked.has(id)).length,
    pending: expected.filter((id) => !checked.has(id) && !startedIds.has(id)).map(label),
    leftWithout: expected.filter((id) => !checked.has(id) && startedIds.has(id)).map(label)
  };
}

export function defectErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/defect_not_allowed/.test(m)) return 'No tienes permiso para cambiar esta falla.';
  if (/defect_transition/.test(m)) return 'Ese cambio de estado no es válido. Actualiza la lista e inténtalo de nuevo.';
  if (/defect_not_found/.test(m)) return 'Esa falla ya no existe.';
  if (/defect_invalid/.test(m)) return 'La nota es demasiado larga (máximo 300 letras).';
  if (/fetch|network|failed to send/.test(m)) return 'Sin conexión. Inténtalo de nuevo.';
  return null;
}
const fail = (error) => ({ ok: false, message: defectErrorMessage(error?.message ?? error) ?? `No se pudo completar: ${error?.message ?? error ?? 'error desconocido'}` });

export async function fetchDefectsBoard(client, { now = new Date() } = {}) {
  if (!client?.from) return fail('No hay sesión activa.');
  const startIso = new Date(now.getTime() - 36 * 3600000).toISOString(); // cubre "hoy" en cualquier zona; luego se filtra por día RD
  const [defects, vehicles, inspections, runs] = await Promise.all([
    client.from('vehicle_defects').select('id,vehicle_id,item_key,label,severity,note,status,reported_at,resolved_at,resolution_note,verified_at').neq('status', 'verified').order('reported_at', { ascending: true }).limit(200),
    client.from('vehicles').select('id,code'),
    client.from('vehicle_inspections').select('id,vehicle_id,created_at').gte('created_at', startIso).limit(500),
    client.from('route_runs').select('id,vehicle_id,status,started_at,scheduled_start_at').or(`started_at.gte.${startIso},scheduled_start_at.gte.${startIso}`).limit(500)
  ]);
  if (defects.error) return fail(defects.error);
  if (vehicles.error) return fail(vehicles.error);
  // Cumplimiento es información extra: si falla, la bandeja igual se muestra.
  const compliance = !inspections.error && !runs.error
    ? inspectionCompliance({ vehicles: vehicles.data ?? [], runs: runs.data ?? [], inspections: inspections.data ?? [], now }) : null;
  return { ok: true, defects: sortDefects(defects.data ?? []), vehicles: vehicles.data ?? [], compliance };
}

export async function setDefectStatus(client, { defectId, status, note = '' } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  if (!defectId || !Object.hasOwn(STATUS_LABEL, status)) return { ok: false, message: 'Falta la falla o el estado.' };
  if (String(note ?? '').length > MAX_NOTE) return { ok: false, message: `La nota es demasiado larga (máximo ${MAX_NOTE} letras).` };
  const r = await client.rpc('update_vehicle_defect_status', { p_defect_id: defectId, p_status: status, p_note: String(note ?? '').trim() || null });
  if (r.error) return fail(r.error);
  return { ok: true, id: r.data?.id ?? defectId, status: r.data?.status ?? status };
}

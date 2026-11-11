// SW-127: bandeja de basura acumulada (reportes que llegan desde Saibot). Lo puro no toca red; las funciones con `client`
// reciben el cliente de Supabase.
export const STATUS_LABEL = { new: 'Nuevo', assigned: 'Asignado', collected: 'Atendido', rejected: 'No procede' };
export const SYNC_LABEL = { not_needed: '', pending: 'Aviso a Saibot pendiente', sent: 'Saibot avisado', failed: 'Falló el aviso a Saibot' };
export const MAX_NOTE = 300;
export const isOpen = (r) => r && (r.status === 'new' || r.status === 'assigned');

// Abiertos primero (los más viejos antes: llevan más tiempo esperando), luego los cerrados (los más recientes antes).
export function sortReports(list = []) {
  const open = list.filter(isOpen).sort((a, b) => String(a.reported_at).localeCompare(String(b.reported_at)));
  const closed = list.filter((r) => !isOpen(r)).sort((a, b) => String(b.attended_at ?? b.reported_at).localeCompare(String(a.attended_at ?? a.reported_at)));
  return [...open, ...closed];
}

export function summarizeReports(list = []) {
  return {
    total: list.length,
    new: list.filter((r) => r.status === 'new').length,
    assigned: list.filter((r) => r.status === 'assigned').length,
    collected: list.filter((r) => r.status === 'collected').length,
    rejected: list.filter((r) => r.status === 'rejected').length,
    open: list.filter(isOpen).length
  };
}

export function filterReports(list = [], filter = 'open') {
  if (filter === 'all') return list;
  if (filter === 'open') return list.filter(isOpen);
  if (filter === 'closed') return list.filter((r) => !isOpen(r));
  return list.filter((r) => r.status === filter);
}

export function ageText(iso, now = new Date()) {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min < 2 ? 'hace un momento' : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

// Posiciones de los puntos (0..100) para el plano: respeta las coordenadas reales y deja un margen. Sin coordenadas, sin punto.
export function projectPins(list = [], pad = 8) {
  const withPos = list.filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!withPos.length) return [];
  const lats = withPos.map((r) => r.latitude); const lngs = withPos.map((r) => r.longitude);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const span = (a, b) => (b - a) || 1;
  return withPos.map((r) => ({
    id: r.id,
    x: withPos.length === 1 ? 50 : pad + ((r.longitude - minLng) / span(minLng, maxLng)) * (100 - 2 * pad),
    y: withPos.length === 1 ? 50 : pad + (1 - (r.latitude - minLat) / span(minLat, maxLat)) * (100 - 2 * pad)
  }));
}

export const mapLink = (r) => (Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude)
  ? `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}` : '');

export function wasteErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/waste_not_allowed/.test(m)) return 'No tienes permiso para cambiar este reporte.';
  if (/waste_transition/.test(m)) return 'Este reporte ya estaba cerrado. Actualiza la lista.';
  if (/waste_not_found/.test(m)) return 'Ese reporte ya no existe.';
  if (/waste_invalid/.test(m)) return 'Escribe el motivo (al menos 3 letras) para dejarlo como "No procede". La nota admite hasta 300 letras.';
  if (/fetch|network|failed to send/.test(m)) return 'Sin conexión. Inténtalo de nuevo.';
  return null;
}
const fail = (error) => ({ ok: false, message: wasteErrorMessage(error?.message ?? error) ?? `No se pudo completar: ${error?.message ?? error ?? 'error desconocido'}` });

export async function fetchWasteReports(client) {
  if (!client?.from) return fail('No hay sesión activa.');
  const r = await client.from('waste_reports')
    .select('id,external_id,description,reference,latitude,longitude,photo_urls,reported_at,status,attended_at,attended_note,saibot_sync')
    .order('reported_at', { ascending: false }).limit(300);
  if (r.error) return fail(r.error);
  return { ok: true, reports: sortReports(r.data ?? []) };
}

export async function setWasteReportStatus(client, { reportId, status, note = '' } = {}) {
  if (!client?.rpc) return fail('No hay sesión activa.');
  if (!reportId || (status !== 'collected' && status !== 'rejected')) return { ok: false, message: 'Falta el reporte o el estado.' };
  const text = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_NOTE) return { ok: false, message: `La nota admite hasta ${MAX_NOTE} letras.` };
  if (status === 'rejected' && text.length < 3) return { ok: false, message: 'Escribe el motivo (al menos 3 letras) para dejarlo como "No procede".' };
  const r = await client.rpc('update_waste_report_status', { p_report_id: reportId, p_status: status, p_note: text || null });
  if (r.error) return fail(r.error);
  return { ok: true, id: r.data?.id ?? reportId, status: r.data?.status ?? status };
}

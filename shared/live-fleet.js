// SW-097: normaliza la respuesta de public_live_fleet (pura, sin DOM ni red) y redacta el estado del camión.
export const STALE_AFTER_SECONDS = 180;

const finite = (n) => (n === null || n === '' ? NaN : Number(n));
const validLat = (n) => Number.isFinite(n) && n >= -90 && n <= 90;
const validLng = (n) => Number.isFinite(n) && n >= -180 && n <= 180;
const toMs = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? ms : null; };

function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (const point of path) {
    if (!Array.isArray(point)) continue;
    const lat = finite(point[0]); const lng = finite(point[1]);
    if (validLat(lat) && validLng(lng)) out.push([lat, lng]);
  }
  return out;
}

export function normalizeLiveFleet(payload, nowMs = Date.now()) {
  const serverTimeMs = toMs(payload?.server_time) ?? nowMs;
  const municipality = payload?.municipality && typeof payload.municipality === 'object'
    ? { name: String(payload.municipality.name ?? ''), slug: String(payload.municipality.slug ?? '') }
    : null;
  const vehicles = [];
  for (const raw of Array.isArray(payload?.vehicles) ? payload.vehicles : []) {
    const lat = finite(raw?.lat); const lng = finite(raw?.lng);
    if (!raw?.code || !validLat(lat) || !validLng(lng)) continue;
    const capturedAtMs = toMs(raw.captured_at);
    const ageSeconds = capturedAtMs === null ? Infinity : Math.max(0, Math.round((serverTimeMs - capturedAtMs) / 1000));
    const stale = ageSeconds > STALE_AFTER_SECONDS;
    const heading = finite(raw.heading);
    vehicles.push({
      code: String(raw.code),
      routeName: String(raw.route_name ?? ''),
      status: stale ? 'sin_senal' : (['en_ruta', 'detenido', 'sin_senal'].includes(raw.status) ? raw.status : 'en_ruta'),
      lat, lng,
      heading: Number.isFinite(heading) ? heading : null,
      capturedAtMs,
      ageSeconds,
      stoppedSinceMs: raw.stopped_since ? toMs(raw.stopped_since) : null,
      runStartedAtMs: raw.run_started_at ? toMs(raw.run_started_at) : null,
      path: normalizePath(raw.path)
    });
  }
  return { municipality, vehicles, serverTimeMs };
}

const hhmm = (ms) => new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

// nowMs = hora del servidor al responder (por omisión: la de la última señal + su antigüedad).
export function describeVehicleStatus(vehicle, nowMs = (vehicle.capturedAtMs ?? 0) + (Number.isFinite(vehicle.ageSeconds) ? vehicle.ageSeconds * 1000 : 0)) {
  if (vehicle.status === 'sin_senal') return vehicle.capturedAtMs ? `Sin señal desde las ${hhmm(vehicle.capturedAtMs)}` : 'Sin señal';
  if (vehicle.status === 'detenido') {
    const minutes = vehicle.stoppedSinceMs ? Math.max(0, Math.floor((nowMs - vehicle.stoppedSinceMs) / 60000)) : 0;
    return minutes >= 1 ? `Detenido hace ${minutes} min` : 'Detenido';
  }
  return 'En ruta';
}

// SW-085: distancia a la siguiente parada y textos de progreso. Lógica pura. Sin dato, "—" (nunca inventar).
const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const isCoord = (v) => typeof v === 'number' && Number.isFinite(v);

export function haversineMeters(a, b) {
  if (!a || !b || !isCoord(a.latitude) || !isCoord(a.longitude) || !isCoord(b.latitude) || !isCoord(b.longitude)) return null;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '—';
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export function nextStopInfo({ stops = [], position = null } = {}) {
  const list = (Array.isArray(stops) ? stops : []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const total = list.length;
  const done = list.filter((s) => s.status === 'completed').length;
  const next = list.find((s) => s.status !== 'completed') ?? null;
  const meters = next ? haversineMeters(position, next) : null;
  return {
    label: next?.label ?? null,
    distanceText: formatDistance(meters),
    pending: total - done,
    done,
    total,
    progressText: total ? `${done} de ${total} paradas` : '—'
  };
}

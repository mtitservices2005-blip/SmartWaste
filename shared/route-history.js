// SW-086: historial de corridas de una ruta, con el tiempo y los kilómetros medidos de cada vez.
// Solo datos reales: sin GPS no se inventa el kilometraje; sin inicio o fin no hay duración.
import { formatDistance } from './driver-nav.js';

const TIME_ZONE = 'America/Santo_Domingo';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

function dateText(value) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric' }).formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
}

export function buildRouteHistory(runs, routeId, { driverNames = new Map(), limit = 10 } = {}) {
  const done = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && r.route_id === routeId && r.status !== 'cancelled' && (r.status === 'completed' || r.status === 'verified') && r.started_at && r.completed_at)
    .map((r) => ({ r, minutes: (new Date(r.completed_at) - new Date(r.started_at)) / 60000 }))
    .filter((x) => Number.isFinite(x.minutes) && x.minutes > 0)
    .sort((a, b) => new Date(b.r.completed_at) - new Date(a.r.completed_at));
  const measured = done.filter((x) => Number.isFinite(x.r.distance_meters) && x.r.distance_meters > 0);
  const avg = (list, pick) => (list.length ? list.reduce((s, x) => s + pick(x), 0) / list.length : null);
  const avgMinutes = avg(done, (x) => x.minutes);
  const avgMeters = avg(measured, (x) => x.r.distance_meters);
  return {
    entries: done.slice(0, limit).map(({ r, minutes }) => ({
      id: r.id,
      dateText: dateText(r.completed_at),
      durationText: formatDuration(minutes),
      distanceText: Number.isFinite(r.distance_meters) && r.distance_meters > 0 ? formatDistance(r.distance_meters) : '—',
      driverName: driverNames.get?.(r.driver_id) ?? '—'
    })),
    count: done.length,
    avgDurationText: avgMinutes === null ? '—' : formatDuration(avgMinutes),
    avgDistanceText: avgMeters === null ? '—' : formatDistance(avgMeters)
  };
}

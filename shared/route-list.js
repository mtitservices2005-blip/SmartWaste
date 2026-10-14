// SW-086: tabla de rutas del diseño Mando. Lógica pura (sin DOM ni red). Las rutas se repiten: tras cada
// corrida la ruta vuelve a quedar "asignada", así que "completada hoy" se decide con la última corrida terminada.
import { formatDistance } from './driver-nav.js';
import { formatDays, formatTimeOfDay } from './route-schedule.js';

const TIME_ZONE = 'America/Santo_Domingo';
const ACTIVE = new Set(['started', 'in_progress', 'delayed']);
const DONE = new Set(['completed', 'verified']);

export const FILTERS = [
  { key: 'todas', label: 'Todas' },
  { key: 'activas', label: 'Activas' },
  { key: 'programadas', label: 'Programadas' },
  { key: 'completas', label: 'Completas' }
];

const dayKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const completedToday = (item, now) => Boolean(item.lastCompletedAt) && dayKey(item.lastCompletedAt) !== null && dayKey(item.lastCompletedAt) === dayKey(now);

export function routeBucket(item, now = new Date()) {
  if (ACTIVE.has(item.status)) return 'activas';
  if (DONE.has(item.status)) return 'completas';
  if (completedToday(item, now)) return 'completas';
  return 'programadas';
}

export function stateLabel(item, now = new Date()) {
  if (item.status === 'delayed') return 'RETRASADA';
  const bucket = routeBucket(item, now);
  return bucket === 'activas' ? 'EN CURSO' : bucket === 'completas' ? 'COMPLETA' : 'PROGRAMADA';
}

export function buildRouteRows(items, now = new Date()) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit || 'Sin asignar',
    driverName: item.driverName || '—',
    stopsCount: item.stopsCount ?? 0,
    lengthText: Number.isFinite(item.lengthMeters) && item.lengthMeters > 0 ? formatDistance(item.lengthMeters) : '—',
    stateKey: routeBucket(item, now),
    stateLabel: stateLabel(item, now),
    startText: formatTimeOfDay(item.startTime) ?? '—',
    daysText: formatDays(item.days)
  }));
}

export function filterRows(rows, key) {
  if (!['activas', 'programadas', 'completas'].includes(key)) return rows;
  return rows.filter((r) => r.stateKey === key);
}

export function countByFilter(rows) {
  const out = { todas: rows.length, activas: 0, programadas: 0, completas: 0 };
  rows.forEach((r) => { out[r.stateKey] += 1; });
  return out;
}

export function headerText({ count, municipality, demo }) {
  if (!count) return `Aún no hay rutas en ${municipality}`;
  const base = `${count} ${count === 1 ? 'ruta' : 'rutas'} en ${municipality}`;
  return demo ? `${base} · datos de ejemplo` : base;
}

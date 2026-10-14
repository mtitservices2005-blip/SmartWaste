// SW-086b: editar una ruta guardada. Lógica pura (sin DOM ni red). La pantalla es la misma de "Nueva ruta".
import { normalizeDays, normalizeStartTime } from './route-schedule.js';

const RUNNING = new Set(['started', 'in_progress', 'delayed']);

export function canEditGeometry(route) {
  if (RUNNING.has(route?.status)) return { ok: false, message: 'Esta ruta está en marcha; podrás editar el trazo cuando termine.' };
  return { ok: true, message: '' };
}

// "08:00:00" → "08:00" (formato del campo de hora); vacío o inválido → "".
export function timeInputValue(value) {
  const t = normalizeStartTime(value);
  return t ? t.slice(0, 5) : '';
}

export function initialEditValues(route, points, { vehicleId = '' } = {}) {
  return {
    name: route?.name ?? '',
    startTime: timeInputValue(route?.startTime),
    days: normalizeDays(route?.days),
    vehicleId: vehicleId ?? '',
    points: (Array.isArray(points) ? points : []).map((p) => [p[0], p[1]])
  };
}

const samePoints = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

export function diffEdit(before, after) {
  const meta = before.name !== after.name || timeInputValue(before.startTime) !== timeInputValue(after.startTime)
    || normalizeDays(before.days).join(',') !== normalizeDays(after.days).join(',');
  const geometry = !samePoints(before.points ?? [], after.points ?? []);
  const vehicle = (before.vehicleId ?? '') !== (after.vehicleId ?? '');
  return { changed: meta || geometry || vehicle, meta, geometry, vehicle };
}

export function validateEdit({ name, points, geometryAllowed = true, saving = false } = {}) {
  if (saving) return { ok: false, message: 'Guardando los cambios…' };
  const clean = String(name ?? '').trim();
  if (!clean) return { ok: false, message: 'Ingresa un nombre para la ruta.' };
  if (geometryAllowed && (!Array.isArray(points) || points.length < 2)) return { ok: false, message: 'Traza al menos 2 puntos en el mapa.' };
  return { ok: true, name: clean };
}

export function routeUpdatePayload({ name, startTime, days }) {
  const d = normalizeDays(days);
  return { name: String(name ?? '').trim(), start_time: normalizeStartTime(startTime), days_of_week: d.length ? d : null };
}

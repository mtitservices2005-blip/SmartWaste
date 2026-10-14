// SW-086: trazo de la ruta nueva. Lógica pura (sin DOM ni red): añadir, mover, deshacer, borrar todo,
// validar y vista previa. La pantalla solo dibuja lo que este módulo decide.
import { haversineMeters, generateRouteStopPoints } from './route-engine.js';
import { formatDistance } from './driver-nav.js';

const validPoint = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

export function addPoint(points, point) {
  return validPoint(point) ? [...points, [point[0], point[1]]] : points;
}
export function movePoint(points, index, point) {
  if (!Number.isInteger(index) || index < 0 || index >= points.length || !validPoint(point)) return points;
  return points.map((p, i) => (i === index ? [point[0], point[1]] : p));
}
export const undoPoint = (points) => points.slice(0, -1);
export const clearPoints = () => [];

export function validateDraft({ name, points, saving = false }) {
  const clean = String(name ?? '').trim();
  if (saving) return { ok: false, message: 'Guardando la ruta…' };
  if (!clean) return { ok: false, message: 'Ingresa un nombre para la ruta.' };
  if (!Array.isArray(points) || points.length < 2) return { ok: false, message: 'Traza al menos 2 puntos en el mapa.' };
  return { ok: true, message: '', name: clean };
}

const lengthOf = (path) => path.slice(1).reduce((sum, p, i) => sum + haversineMeters(path[i], p), 0);

export function previewDraft({ points, path, durationSeconds } = {}) {
  const pts = Array.isArray(points) ? points : [];
  const line = Array.isArray(path) && path.length >= 2 ? path : pts;
  const meters = line.length >= 2 ? lengthOf(line) : 0;
  const minutes = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null;
  return {
    pointsText: `${pts.length} ${pts.length === 1 ? 'punto trazado' : 'puntos trazados'}`,
    distanceText: meters > 0 ? formatDistance(meters) : '—',
    stopsCount: line.length >= 2 ? generateRouteStopPoints(line).length : 0,
    timeText: minutes ? `${minutes} min` : '—'
  };
}

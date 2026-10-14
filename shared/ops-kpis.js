// SW-084: indicadores del centro de control (En ruta, Cobertura, Distancia, Combustible, antigüedad del dato).
// Función pura sobre datos que la plataforma ya cargó: no consulta nada y nunca inventa un número;
// un dato ausente se muestra "—". Formato con coma decimal, como el resto de la plataforma.
export const FRESH_LIMIT_SECONDS = 90; // mismo umbral de "sin señal" que shared/fleet-status.js
const DASH = '—';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function group(intPart) { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function decimal(value) {
  const rounded = Math.round(value * 10) / 10;
  const [i, d] = String(rounded).split('.');
  return d ? `${group(i)},${d}` : group(i);
}

export const formatKm = (v) => (isNum(v) && v >= 0 ? `${decimal(v)} km` : DASH);
export const formatLiters = (v) => (isNum(v) && v >= 0 ? `${decimal(v)} L` : DASH);
export const formatPercent = (v) => (isNum(v) && v >= 0 ? `${Math.round(v)}%` : DASH);

function toMillis(value) {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function freshnessLabel({ lastCapturedAt, now = Date.now() } = {}) {
  const last = toMillis(lastCapturedAt);
  if (last === null) return 'SIN DATOS';
  const seconds = Math.max(0, Math.floor((toMillis(now) - last) / 1000));
  if (seconds > FRESH_LIMIT_SECONDS) return 'SIN DATOS RECIENTES';
  return seconds < 60 ? `EN VIVO · ${seconds} s` : `EN VIVO · ${Math.floor(seconds / 60)} min`;
}

export function computeOpsKpis({ vehicles = [], coverageRate = null, distanceKm = null, fuelLiters = null, now = Date.now() } = {}) {
  const latest = vehicles.map((v) => toMillis(v.lastCapturedAt)).filter((v) => v !== null);
  return {
    enRuta: vehicles.filter((v) => v.status === 'en_ruta').length,
    alerts: vehicles.filter((v) => v.status === 'sin_senal').length,
    coverage: formatPercent(coverageRate),
    distance: formatKm(distanceKm),
    fuel: formatLiters(fuelLiters),
    freshness: freshnessLabel({ lastCapturedAt: latest.length ? Math.max(...latest) : null, now })
  };
}

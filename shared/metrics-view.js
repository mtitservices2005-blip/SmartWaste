// SW-090: modelo de vista de la pantalla Métricas. Puro (sin DOM ni red): filtra, agrupa y prepara
// lo que dibuja frontend/components/metrics-screens.js.
import { summarizeMetrics, filterRunsByPeriod, dailySeries } from './run-metrics.js';

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const [int, dec] = Number(value).toFixed(digits).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmed = dec ? dec.replace(/0+$/, '') : '';
  return trimmed ? `${grouped},${trimmed}` : grouped;
}
export const formatKm = (km) => (km === null || km === undefined ? '—' : `${formatNumber(km)} km`);
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  const total = Math.round(Number(minutes));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

const vehicleLabel = (v) => v?.code ?? v?.unit ?? v?.name ?? '—';
const driverLabel = (d) => d?.display_name ?? d?.name ?? '—';

function groupRows(rows, keyOf, labelOf, extra = () => ({})) {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r.run);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, label: labelOf(key), runs: 0, km: 0, minutes: 0, liters: null, co2Kg: null, co2Km: 0, sources: new Set(), ...extra(key) });
    const g = map.get(key);
    g.runs += 1; g.km += r.distanceKm ?? 0; g.minutes += r.durationMin ?? 0;
    g.sources.add(r.source);
    if (r.liters !== null) g.liters = (g.liters ?? 0) + r.liters;
    if (r.co2Kg !== null) { g.co2Kg = (g.co2Kg ?? 0) + r.co2Kg; g.co2Km += r.distanceKm ?? 0; }
  }
  return [...map.values()].map((g) => {
    const withData = [...g.sources].filter((s) => s !== 'sin_datos');
    const source = withData.length === 0 ? 'sin_datos' : withData.every((s) => s === 'real') && !g.sources.has('sin_datos') ? 'real' : 'estimado';
    const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);
    return { ...g, sources: undefined, km: r2(g.km), minutes: Math.round(g.minutes * 10) / 10, liters: r2(g.liters), co2Kg: r2(g.co2Kg), source, co2PerKm: g.co2Kg !== null && g.co2Km > 0 ? r2(g.co2Kg / g.co2Km) : null, co2Km: undefined };
  }).sort((a, b) => b.km - a.km);
}

export function buildMetricsView({ runs = [], vehicles = [], routes = [], drivers = [], fuelLogs = [], period = 14, filters = {}, now = new Date() } = {}) {
  const inPeriod = filterRunsByPeriod(runs.filter((r) => r.status === 'completed'), period, now)
    .filter((r) => (!filters.vehicleId || r.vehicle_id === filters.vehicleId)
      && (!filters.routeId || r.route_id === filters.routeId)
      && (!filters.driverId || r.driver_id === filters.driverId));
  const excludedTests = inPeriod.filter((r) => r.is_test).length;
  const scope = filters.includeTests ? inPeriod : inPeriod.filter((r) => !r.is_test);
  // Las pruebas incluidas se calculan como corridas normales para poder listarlas y sumarlas.
  const asReal = scope.map((r) => ({ ...r, is_test: false }));
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const rById = new Map(routes.map((r) => [r.id, r]));
  const dById = new Map(drivers.map((d) => [d.id, d]));
  const summary = summarizeMetrics(asReal, vehicles, fuelLogs);
  const rows = summary.rows;
  const flag = new Map(scope.map((r) => [r.id, r.is_test]));
  const byVehicle = groupRows(rows, (r) => r.vehicle_id, (k) => vehicleLabel(vById.get(k)), (k) => ({ vehicleId: k }));
  const byRoute = groupRows(rows, (r) => r.route_id, (k) => rById.get(k)?.name ?? '—');
  const byDriver = groupRows(rows, (r) => r.driver_id, (k) => driverLabel(dById.get(k)));
  const runRows = rows
    .map((r) => ({
      id: r.run.id, startedAt: r.run.started_at, routeName: rById.get(r.run.route_id)?.name ?? '—',
      vehicleLabel: vehicleLabel(vById.get(r.run.vehicle_id)), driverName: driverLabel(dById.get(r.run.driver_id)),
      distanceKm: r.distanceKm, durationMin: r.durationMin, gpsPoints: r.run.gps_points_count ?? null,
      liters: r.liters, co2Kg: r.co2Kg, source: r.source, fuelType: r.fuelType, isTest: Boolean(flag.get(r.run.id)),
      co2PerKm: r.co2Kg !== null && r.distanceKm ? Math.round((r.co2Kg / r.distanceKm) * 100) / 100 : null
    }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const missingConfig = byVehicle.filter((g) => g.source === 'sin_datos').map((g) => ({ vehicleId: g.vehicleId, label: g.label }));
  return {
    summary, excludedTests, byVehicle, byRoute, byDriver, runRows, missingConfig,
    series: dailySeries(asReal, vehicles, fuelLogs, period, now),
    isEmpty: summary.runCount === 0
  };
}

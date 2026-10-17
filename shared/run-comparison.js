// SW-091: comparativas y desvíos. Puro (sin red ni DOM). Solo lee corridas ya guardadas; no inventa datos:
// sin base suficiente (menos de 3 corridas previas de la misma ruta) no se marca desvío.
import { computeRunMetrics, filterRunsByPeriod, summarizeMetrics } from './run-metrics.js';

export const COMPARISON_THRESHOLDS = { minBaseRuns: 3, baselineDays: 90, durationPct: 20, distancePct: 15, co2Pct: 25 };

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
export function pctDelta(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return r1(((value - base) / base) * 100);
}
const vehicleLabel = (v) => v?.code ?? v?.unit ?? '—';
const isValid = (r) => r.status === 'completed' && !r.is_test;

function totals(runs, vehicles, fuelLogs) {
  const s = summarizeMetrics(runs, vehicles, fuelLogs);
  return { runCount: s.runCount, km: s.totalKm, minutes: s.totalMinutes, liters: s.liters, co2Kg: s.co2Kg };
}

export function buildComparison({ runs = [], vehicles = [], routes = [], drivers = [], fuelLogs = [], period = 14, now = new Date() } = {}) {
  const T = COMPARISON_THRESHOLDS;
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const rById = new Map(routes.map((r) => [r.id, r]));
  const valid = runs.filter(isValid);
  const metricOf = (run) => computeRunMetrics(run, { vehicle: vById.get(run.vehicle_id) ?? null, fuelLogs });

  const current = filterRunsByPeriod(valid, period, now);
  const previous = filterRunsByPeriod(valid, period, new Date(now.getTime() - period * 86400000));
  const cur = totals(current, vehicles, fuelLogs);
  const prev = totals(previous, vehicles, fuelLogs);
  const deltas = {};
  for (const k of ['runCount', 'km', 'minutes', 'liters', 'co2Kg']) deltas[k] = pctDelta(cur[k], prev[k]);

  // Desvíos: cada corrida del periodo contra la mediana de las corridas previas de su ruta.
  const deviations = [];
  let withoutBase = 0;
  const routesWithRuns = new Set(); const routesCompared = new Set();
  for (const run of current) {
    const t = new Date(run.started_at).getTime();
    const priors = valid.filter((p) => p.route_id === run.route_id && p.id !== run.id && new Date(p.started_at).getTime() < t && t - new Date(p.started_at).getTime() <= T.baselineDays * 86400000);
    routesWithRuns.add(run.route_id);
    if (priors.length < T.minBaseRuns) continue;
    routesCompared.add(run.route_id);
    const m = metricOf(run); const base = priors.map(metricOf);
    const flags = [];
    const check = (metric, value, key, limit, both) => {
      const b = median(base.map((x) => x[key]));
      const d = pctDelta(value, b);
      if (d !== null && (both ? Math.abs(d) > limit : d > limit)) flags.push({ metric, value, baseline: r2(b), deltaPct: d });
    };
    check('duracion', m.durationMin, 'durationMin', T.durationPct, false);
    check('distancia', m.distanceKm, 'distanceKm', T.distancePct, true);
    check('co2', m.co2Kg, 'co2Kg', T.co2Pct, false);
    if (flags.length) deviations.push({ runId: run.id, startedAt: run.started_at, routeName: rById.get(run.route_id)?.name ?? '—', vehicleLabel: vehicleLabel(vById.get(run.vehicle_id)), flags });
  }
  withoutBase = [...routesWithRuns].filter((id) => !routesCompared.has(id)).length;
  deviations.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  // Camiones en la misma ruta (al menos 2 camiones con 2 corridas cada uno).
  const trucksOnRoute = [];
  for (const [routeId, route] of rById) {
    const byVeh = new Map();
    for (const run of current.filter((r) => r.route_id === routeId)) {
      const m = metricOf(run);
      if (!byVeh.has(run.vehicle_id)) byVeh.set(run.vehicle_id, []);
      byVeh.get(run.vehicle_id).push(m);
    }
    const trucks = [...byVeh.entries()].filter(([, ms]) => ms.length >= 2).map(([vid, ms]) => {
      const both = ms.filter((m) => m.distanceKm !== null && m.durationMin !== null);
      const km = both.reduce((s, m) => s + m.distanceKm, 0); const min = both.reduce((s, m) => s + m.durationMin, 0);
      const withL = ms.filter((m) => m.liters !== null && m.distanceKm !== null);
      const lKm = withL.reduce((s, m) => s + m.distanceKm, 0); const lL = withL.reduce((s, m) => s + m.liters, 0);
      const withC = ms.filter((m) => m.co2Kg !== null && m.distanceKm !== null);
      const cKm = withC.reduce((s, m) => s + m.distanceKm, 0); const cC = withC.reduce((s, m) => s + m.co2Kg, 0);
      return { vehicleId: vid, label: vehicleLabel(vById.get(vid)), runs: ms.length, minPerKm: km > 0 ? r2(min / km) : null, kmPerL: lL > 0 ? r2(lKm / lL) : null, co2PerKm: cKm > 0 ? r2(cC / cKm) : null };
    });
    if (trucks.length < 2) continue;
    let bestBy = 'co2PerKm';
    let candidates = trucks.filter((x) => x.co2PerKm !== null);
    if (candidates.length < 2) { bestBy = 'minPerKm'; candidates = trucks.filter((x) => x.minPerKm !== null); }
    const best = candidates.length >= 2 ? candidates.reduce((a, b) => (b[bestBy] < a[bestBy] ? b : a)) : null;
    trucksOnRoute.push({ routeId, routeName: route.name, trucks, bestVehicleId: best?.vehicleId ?? null, bestBy: best ? bestBy : null });
  }

  return { periodVsPrevious: { current: cur, previous: prev, deltas }, deviations, withoutBase, trucksOnRoute, isEmpty: cur.runCount === 0 };
}

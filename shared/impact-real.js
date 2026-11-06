// SW-113: Impacto y Ahorros calculado solo con corridas reales. Puro (sin red ni DOM).
// SW-114: el combustible sale siempre de km ÷ rendimiento configurado de cada camión (nunca de lo que el chofer anota).
// Tres bloques que nunca se mezclan: Medido (lo ocurrido), Proyectado (promedio por día con corridas × días operativos)
// y Potencial (orden real de paradas vs. orden óptimo). Solo cuentan corridas completadas y no marcadas como prueba.
import { filterRunsByPeriod, summarizeMetrics, dailySeries, localDay } from './run-metrics.js';
import { compareManualVsOptimizedRoute } from './route-savings.js';
import { co2KgForLiters } from './emission-factors.js';

export const MIN_ACTIVE_DAYS_TO_PROJECT = 3;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

function sourceOf(rows) {
  const kinds = new Set(rows.map((r) => r.source));
  if (kinds.size === 1) return [...kinds][0];
  return 'parcial'; // algún camión de la ruta no tiene rendimiento configurado
}

export function buildRealImpact({ runs = [], vehicles = [], fuelLogs = [], routes = [], routeStops = {}, costParameters = {}, periodDays = 30, now = new Date() } = {}) {
  const fuelPrice = Number(costParameters.fuelPrice);
  const operatingDays = positive(costParameters.operatingDays) ? Number(costParameters.operatingDays) : 22;
  const inPeriod = filterRunsByPeriod(runs, periodDays, now);
  const summary = summarizeMetrics(inPeriod, vehicles, fuelLogs);
  const rows = summary.rows;
  const series = dailySeries(inPeriod, vehicles, fuelLogs, Math.min(periodDays, 30), now);
  const activeDays = new Set(rows.map((r) => (r.run.started_at ? localDay(r.run.started_at) : null)).filter(Boolean)).size;

  const litersKnown = round(rows.reduce((s, r) => s + (r.liters ?? 0), 0), 2);
  const kmWithFuel = rows.filter((r) => r.liters !== null).reduce((s, r) => s + (r.distanceKm ?? 0), 0);
  const runsWithoutFuel = rows.filter((r) => r.source === 'sin_datos').length;
  const hasFuel = litersKnown > 0;
  const priceOk = positive(fuelPrice);
  const measured = {
    runs: summary.runCount,
    activeDays,
    km: summary.totalKm,
    hours: round(summary.totalMinutes / 60, 1),
    liters: hasFuel ? litersKnown : null,
    loggedLiters: summary.loggedLiters,
    runsWithoutFuel,
    fuelCost: hasFuel && priceOk ? Math.round(litersKnown * fuelPrice) : null,
    co2Kg: summary.co2Kg
  };

  const canProject = activeDays >= MIN_ACTIVE_DAYS_TO_PROJECT;
  const factor = canProject ? operatingDays / activeDays : null;
  const projection = canProject ? {
    factor,
    basis: { runs: measured.runs, activeDays, operatingDays },
    km: Math.round(measured.km * factor),
    hours: round(measured.hours * factor, 1),
    liters: hasFuel ? Math.round(litersKnown * factor) : null,
    fuelCost: measured.fuelCost === null ? null : Math.round(measured.fuelCost * factor),
    co2Kg: measured.co2Kg === null ? null : Math.round(measured.co2Kg * factor)
  } : null;

  const nameById = new Map((routes ?? []).map((r) => [r.id, r.name]));
  const groups = new Map();
  for (const row of rows) {
    const key = row.run.route_id ?? 'sin-ruta';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const perRoute = [...groups.entries()].map(([routeId, list]) => {
    const liters = list.reduce((s, r) => s + (r.liters ?? 0), 0);
    const known = list.some((r) => r.liters !== null);
    return {
      routeId,
      name: nameById.get(routeId) ?? 'Ruta sin nombre',
      runs: list.length,
      km: round(list.reduce((s, r) => s + (r.distanceKm ?? 0), 0), 1),
      hours: round(list.reduce((s, r) => s + (r.durationMin ?? 0), 0) / 60, 1),
      liters: known ? round(liters, 1) : null,
      fuelCost: known && priceOk ? Math.round(liters * fuelPrice) : null,
      source: sourceOf(list)
    };
  }).sort((a, b) => b.km - a.km);

  // Potencial: por ruta con corridas en el periodo y ≥3 paradas, ahorro por corrida × corridas al mes.
  let potential = null;
  if (canProject) {
    let savedKmMonth = 0; let routesCompared = 0; let manualKm = 0;
    for (const item of perRoute) {
      const cmp = compareManualVsOptimizedRoute(routeStops[item.routeId] ?? []);
      if (!cmp.comparable) continue;
      routesCompared += 1;
      savedKmMonth += (cmp.savedMeters / 1000) * item.runs * factor;
      manualKm += (cmp.manualDistanceMeters / 1000) * item.runs * factor;
    }
    if (routesCompared > 0) {
      // Rendimiento real de la flota en el periodo: km con rendimiento configurado ÷ litros estimados.
      const kmPerLiter = hasFuel && kmWithFuel > 0 ? kmWithFuel / litersKnown : null;
      const liters = kmPerLiter ? savedKmMonth / kmPerLiter : null;
      potential = {
        routesCompared,
        km: round(savedKmMonth, 1),
        percent: manualKm ? round((savedKmMonth / manualKm) * 100, 1) : 0,
        liters: liters === null ? null : round(liters, 1),
        fuelCost: liters !== null && priceOk ? Math.round(liters * fuelPrice) : null,
        co2Kg: liters === null ? null : round(co2KgForLiters(liters, 'diesel') ?? 0, 1),
        kmPerLiter: kmPerLiter === null ? null : round(kmPerLiter, 2)
      };
    }
  }

  return { periodDays, measured, series, projection, potential, perRoute, fuelPrice: priceOk ? fuelPrice : null };
}

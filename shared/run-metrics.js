// SW-090: métricas por corrida. Puro (sin red ni DOM). Consumo: Real (litros del conductor) →
// Estimado (km ÷ rendimiento del camión) → Sin datos (nunca una cifra genérica).
import { co2KgForLiters } from './emission-factors.js';

export const TIME_ZONE = 'America/Santo_Domingo';
export const PERIODS = [
  { days: 1, label: 'Hoy' },
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: 'Trimestre' }
];

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const localDay = (date) => dayFmt.format(new Date(date));
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function computeRunMetrics(run, { vehicle = null, fuelLogs = [] } = {}) {
  const meters = Number(run?.distance_meters);
  const distanceKm = Number.isFinite(meters) && meters > 0 ? round(meters / 1000, 2) : null;
  const start = run?.started_at ? new Date(run.started_at).getTime() : NaN;
  const end = run?.completed_at ? new Date(run.completed_at).getTime() : NaN;
  const durationMin = Number.isFinite(start) && Number.isFinite(end) && end > start ? round((end - start) / 60000, 1) : null;
  const avgSpeedKmh = distanceKm !== null && durationMin !== null ? round(distanceKm / (durationMin / 60), 1) : null;

  const realLiters = fuelLogs
    .filter((f) => f.route_run_id === run?.id && Number(f.liters) > 0)
    .reduce((sum, f) => sum + Number(f.liters), 0);
  const efficiency = Number(vehicle?.fuel_efficiency_km_per_l);
  let source = 'sin_datos';
  let liters = null;
  if (realLiters > 0) {
    source = 'real';
    liters = round(realLiters);
  } else if (distanceKm !== null && Number.isFinite(efficiency) && efficiency > 0) {
    source = 'estimado';
    liters = round(distanceKm / efficiency);
  }
  const co2Kg = liters === null ? null : co2KgForLiters(liters, vehicle?.fuel_type);
  return { runId: run?.id ?? null, vehicleId: run?.vehicle_id ?? null, distanceKm, durationMin, avgSpeedKmh, source, liters, co2Kg, fuelType: vehicle?.fuel_type ?? null };
}

const sumOrNull = (values) => {
  const v = values.filter((x) => x !== null);
  return v.length ? round(v.reduce((a, b) => a + b, 0)) : null;
};

export function summarizeMetrics(runs, vehicles, fuelLogs) {
  const byId = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const valid = (runs ?? []).filter((r) => r.status === 'completed' && !r.is_test);
  const rows = valid.map((r) => ({ run: r, ...computeRunMetrics(r, { vehicle: byId.get(r.vehicle_id) ?? null, fuelLogs: fuelLogs ?? [] }) }));
  const used = new Set(rows.map((r) => r.vehicleId).filter(Boolean));
  const withData = new Set(rows.filter((r) => r.source !== 'sin_datos').map((r) => r.vehicleId).filter(Boolean));
  return {
    runCount: rows.length,
    totalKm: round(rows.reduce((s, r) => s + (r.distanceKm ?? 0), 0)),
    totalMinutes: round(rows.reduce((s, r) => s + (r.durationMin ?? 0), 0), 1),
    liters: sumOrNull(rows.map((r) => r.liters)),
    co2Kg: sumOrNull(rows.map((r) => r.co2Kg)),
    vehiclesWithData: withData.size,
    vehiclesTotal: used.size,
    rows
  };
}

export function filterRunsByPeriod(runs, days, now = new Date()) {
  const first = addDays(localDay(now), -(days - 1));
  return (runs ?? []).filter((r) => r.started_at && localDay(r.started_at) >= first && localDay(r.started_at) <= localDay(now));
}

export function dailySeries(runs, vehicles, fuelLogs, days, now = new Date()) {
  const today = localDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push({ day: addDays(today, -i), runCount: 0, km: 0, minutes: 0, liters: null, co2Kg: null });
  const idx = new Map(out.map((d) => [d.day, d]));
  const s = summarizeMetrics(runs, vehicles, fuelLogs);
  for (const r of s.rows) {
    const d = idx.get(localDay(r.run.started_at));
    if (!d) continue;
    d.runCount += 1;
    d.km = round(d.km + (r.distanceKm ?? 0));
    d.minutes = round(d.minutes + (r.durationMin ?? 0), 1);
    if (r.liters !== null) d.liters = round((d.liters ?? 0) + r.liters);
    if (r.co2Kg !== null) d.co2Kg = round((d.co2Kg ?? 0) + r.co2Kg);
  }
  return out;
}

import assert from 'node:assert/strict';
import { computeRunMetrics, summarizeMetrics, filterRunsByPeriod, dailySeries, PERIODS } from '../shared/run-metrics.js';

const T0 = '2026-10-14T13:00:00Z';
const T1 = '2026-10-14T14:30:00Z';
const run = (o = {}) => ({ id: 'r1', vehicle_id: 'v1', status: 'completed', started_at: T0, completed_at: T1, distance_meters: 12000, is_test: false, ...o });
const veh = (o = {}) => ({ id: 'v1', code: 'C-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel', ...o });

// Estimado
let m = computeRunMetrics(run(), { vehicle: veh(), fuelLogs: [] });
assert.equal(m.distanceKm, 12);
assert.equal(m.durationMin, 90);
assert.equal(m.avgSpeedKmh, 8);
assert.equal(m.source, 'estimado');
assert.equal(m.liters, 3);
assert.equal(m.co2Kg, 8.04);

// Real gana sobre estimado
m = computeRunMetrics(run(), { vehicle: veh(), fuelLogs: [{ route_run_id: 'r1', liters: 5 }, { route_run_id: 'r1', liters: 1 }, { route_run_id: 'other', liters: 99 }] });
assert.equal(m.source, 'real');
assert.equal(m.liters, 6);
assert.equal(m.co2Kg, 16.08);

// Sin datos
m = computeRunMetrics(run(), { vehicle: veh({ fuel_efficiency_km_per_l: null }), fuelLogs: [] });
assert.equal(m.source, 'sin_datos'); assert.equal(m.liters, null); assert.equal(m.co2Kg, null);
m = computeRunMetrics(run(), { vehicle: veh({ fuel_efficiency_km_per_l: 0 }), fuelLogs: [] });
assert.equal(m.source, 'sin_datos');
m = computeRunMetrics(run(), { vehicle: veh({ fuel_efficiency_km_per_l: -2 }), fuelLogs: [] });
assert.equal(m.source, 'sin_datos');
m = computeRunMetrics(run({ distance_meters: null }), { vehicle: veh(), fuelLogs: [] });
assert.equal(m.distanceKm, null); assert.equal(m.source, 'sin_datos'); assert.equal(m.avgSpeedKmh, null);
m = computeRunMetrics(run(), { vehicle: null, fuelLogs: [] });
assert.equal(m.source, 'sin_datos');
// Litros reales sin tipo de combustible: litros sí, CO2 no
m = computeRunMetrics(run(), { vehicle: veh({ fuel_type: null }), fuelLogs: [{ route_run_id: 'r1', liters: 4 }] });
assert.equal(m.source, 'real'); assert.equal(m.liters, 4); assert.equal(m.co2Kg, null);
// Sin duración
m = computeRunMetrics(run({ completed_at: null }), { vehicle: veh(), fuelLogs: [] });
assert.equal(m.durationMin, null); assert.equal(m.avgSpeedKmh, null);

// Resumen: excluye pruebas, cuenta camiones con dato
const runs = [
  run({ id: 'a', vehicle_id: 'v1' }),
  run({ id: 'b', vehicle_id: 'v2' }),
  run({ id: 'c', vehicle_id: 'v1', is_test: true }),
  run({ id: 'd', vehicle_id: 'v1', status: 'in_progress', completed_at: null })
];
const vehicles = [veh(), veh({ id: 'v2', code: 'C-02', fuel_efficiency_km_per_l: null })];
const s = summarizeMetrics(runs, vehicles, []);
assert.equal(s.runCount, 2);
assert.equal(s.totalKm, 24);
assert.equal(s.totalMinutes, 180);
assert.equal(s.liters, 3);
assert.equal(s.co2Kg, 8.04);
assert.equal(s.vehiclesWithData, 1);
assert.equal(s.vehiclesTotal, 2);
assert.equal(s.rows.length, 2);
assert.equal(summarizeMetrics([], vehicles, []).runCount, 0);
assert.equal(summarizeMetrics([], vehicles, []).co2Kg, null);

// Periodos (America/Santo_Domingo, UTC-4)
assert.deepEqual(PERIODS.map((p) => p.days), [1, 7, 14, 30, 90]);
const now = new Date('2026-10-14T20:00:00Z');
const pr = [
  run({ id: 'today', started_at: '2026-10-14T13:00:00Z' }),
  run({ id: 'edge', started_at: '2026-10-14T02:00:00Z' }), // 13-oct 22:00 local
  run({ id: 'old', started_at: '2026-09-01T13:00:00Z' })
];
assert.deepEqual(filterRunsByPeriod(pr, 1, now).map((r) => r.id), ['today']);
assert.deepEqual(filterRunsByPeriod(pr, 7, now).map((r) => r.id), ['today', 'edge']);
assert.deepEqual(filterRunsByPeriod(pr, 90, now).map((r) => r.id), ['today', 'edge', 'old']);

// Serie diaria: N puntos, días sin corridas = 0
const series = dailySeries(pr.slice(0, 2), vehicles, [], 3, now);
assert.equal(series.length, 3);
assert.deepEqual(series.map((d) => d.day), ['2026-10-12', '2026-10-13', '2026-10-14']);
assert.equal(series[2].km, 12);
assert.equal(series[1].km, 12);
assert.equal(series[0].km, 0);
console.log('run-metrics: ok');

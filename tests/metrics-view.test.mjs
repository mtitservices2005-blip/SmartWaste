import assert from 'node:assert/strict';
import { buildMetricsView, formatKm, formatDuration, formatNumber } from '../shared/metrics-view.js';

const now = new Date('2026-10-16T16:00:00Z');
const vehicles = [
  { id: 'v1', code: 'C-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' },
  { id: 'v2', code: 'C-02', fuel_efficiency_km_per_l: null, fuel_type: 'diesel' }
];
const routes = [{ id: 'ro1', name: 'Ruta Centro' }, { id: 'ro2', name: 'Ruta Norte' }];
const drivers = [{ id: 'd1', display_name: 'Carlos Peña' }, { id: 'd2', name: 'Ana Reyes' }];
const mk = (o) => ({ status: 'completed', started_at: '2026-10-15T13:00:00Z', completed_at: '2026-10-15T14:00:00Z', distance_meters: 8000, is_test: false, gps_points_count: 100, ...o });
const runs = [
  mk({ id: 'a', vehicle_id: 'v1', route_id: 'ro1', driver_id: 'd1' }),
  mk({ id: 'b', vehicle_id: 'v2', route_id: 'ro2', driver_id: 'd2' }),
  mk({ id: 'c', vehicle_id: 'v1', route_id: 'ro1', driver_id: 'd1', is_test: true }),
  mk({ id: 'old', vehicle_id: 'v1', route_id: 'ro1', driver_id: 'd1', started_at: '2026-08-01T13:00:00Z' })
];
const fuelLogs = [{ route_run_id: 'a', liters: 3 }];
const base = { runs, vehicles, routes, drivers, fuelLogs, period: 14, filters: {}, now };

let v = buildMetricsView(base);
assert.equal(v.summary.runCount, 2);
assert.equal(v.excludedTests, 1);
assert.equal(v.series.length, 14);
assert.equal(v.byVehicle.length, 2);
const c01 = v.byVehicle.find((g) => g.label === 'C-01');
assert.equal(c01.runs, 1); assert.equal(c01.source, 'real'); assert.equal(c01.liters, 3);
const c02 = v.byVehicle.find((g) => g.label === 'C-02');
assert.equal(c02.source, 'sin_datos'); assert.equal(c02.co2Kg, null); assert.equal(c02.vehicleId, 'v2');
assert.deepEqual(v.byRoute.map((g) => g.label).sort(), ['Ruta Centro', 'Ruta Norte']);
assert.deepEqual(v.byDriver.map((g) => g.label).sort(), ['Ana Reyes', 'Carlos Peña']);
assert.deepEqual(v.missingConfig.map((x) => x.label), ['C-02']);
assert.equal(v.runRows.length, 2);
assert.equal(v.runRows[0].routeName.length > 0, true);

// filtros
v = buildMetricsView({ ...base, filters: { vehicleId: 'v1' } });
assert.equal(v.summary.runCount, 1);
v = buildMetricsView({ ...base, filters: { routeId: 'ro2' } });
assert.equal(v.summary.runCount, 1);
v = buildMetricsView({ ...base, filters: { includeTests: true } });
assert.equal(v.summary.runCount, 3);
assert.equal(v.runRows.find((r) => r.id === 'c').isTest, true);
v = buildMetricsView({ ...base, period: 90 });
assert.equal(v.summary.runCount, 3);
// vacío
v = buildMetricsView({ ...base, runs: [] });
assert.equal(v.summary.runCount, 0); assert.equal(v.isEmpty, true);

// formato es-DO
assert.equal(formatKm(6.4), '6,4 km');
assert.equal(formatNumber(1234.5), '1.234,5');
assert.equal(formatDuration(41), '41 min');
assert.equal(formatDuration(1865), '31 h 05 min');
assert.equal(formatDuration(null), '—');
console.log('metrics-view: ok');

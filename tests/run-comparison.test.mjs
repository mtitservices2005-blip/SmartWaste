import assert from 'node:assert/strict';
import { buildComparison, median, pctDelta, COMPARISON_THRESHOLDS } from '../shared/run-comparison.js';

assert.deepEqual(COMPARISON_THRESHOLDS, { minBaseRuns: 3, baselineDays: 90, durationPct: 20, distancePct: 15, co2Pct: 25 });
assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
assert.equal(pctDelta(120, 100), 20); assert.equal(pctDelta(80, 100), -20); assert.equal(pctDelta(5, 0), null); assert.equal(pctDelta(5, null), null); assert.equal(pctDelta(null, 5), null);

const now = new Date('2026-10-16T16:00:00Z');
const vehicles = [
  { id: 'v1', code: 'C-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' },
  { id: 'v2', code: 'C-02', fuel_efficiency_km_per_l: 2, fuel_type: 'diesel' }
];
const routes = [{ id: 'r1', name: 'Ruta Centro' }, { id: 'r2', name: 'Ruta Norte' }];
const mk = (id, day, o = {}) => ({ id, status: 'completed', vehicle_id: 'v1', route_id: 'r1', driver_id: 'd', is_test: false, started_at: `${day}T13:00:00Z`, completed_at: `${day}T${o.end ?? '14:00'}:00Z`, distance_meters: o.m ?? 6000, ...o.extra });
const runs = [
  mk('p1', '2026-10-01'), mk('p2', '2026-10-02'), mk('p3', '2026-10-03'), // línea base: 60 min, 6 km
  mk('ok', '2026-10-14'),                                                  // igual a la base
  mk('slow', '2026-10-15', { end: '14:30' }),                              // 90 min = +50 %
  mk('short', '2026-10-16', { m: 3000 }),                                  // 3 km = -50 %
  mk('t', '2026-10-16', { end: '20:00', extra: { is_test: true } }),
  mk('n1', '2026-10-15', { extra: { route_id: 'r2', id: 'n1' } })          // Ruta Norte sin base
];
const c = buildComparison({ runs, vehicles, routes, drivers: [], fuelLogs: [], period: 7, now });

// desvíos
const byId = Object.fromEntries(c.deviations.map((d) => [d.runId, d]));
assert.deepEqual(Object.keys(byId).sort(), ['short', 'slow']);
assert.equal(byId.slow.flags.find((f) => f.metric === 'duracion').deltaPct, 50);
assert.equal(byId.slow.routeName, 'Ruta Centro'); assert.equal(byId.slow.vehicleLabel, 'C-01');
assert.equal(byId.short.flags.find((f) => f.metric === 'distancia').deltaPct, -50);
assert.equal(c.deviations[0].runId, 'short'); // más reciente primero
assert.equal(c.withoutBase, 1);               // n1: Ruta Norte sin 3 corridas previas

// periodo vs anterior (7 días: 10–16 oct vs 3–9 oct)
assert.equal(c.periodVsPrevious.current.runCount, 4);   // ok, slow, short, n1 (la de prueba no cuenta)
assert.equal(c.periodVsPrevious.current.km, 21);
assert.equal(c.periodVsPrevious.previous.runCount, 1);  // p3 (3 oct)
assert.equal(c.periodVsPrevious.previous.km, 6);
assert.equal(c.periodVsPrevious.previous.minutes, 60);
assert.equal(c.periodVsPrevious.deltas.runCount, 300);
assert.equal(c.periodVsPrevious.deltas.km, 250);
assert.equal(c.periodVsPrevious.deltas.liters, 250);    // estimado: 21/4 contra 6/4
assert.equal(c.periodVsPrevious.deltas.co2Kg, 250);

// sin periodo anterior: delta nulo, no infinito
const lone = buildComparison({ runs: [mk('x', '2026-10-15')], vehicles, routes, drivers: [], fuelLogs: [], period: 7, now });
assert.equal(lone.periodVsPrevious.deltas.km, null);
assert.equal(lone.deviations.length, 0);
assert.equal(lone.isEmpty, false);
assert.equal(buildComparison({ runs: [], vehicles, routes, drivers: [], fuelLogs: [], period: 7, now }).isEmpty, true);

// camiones en la misma ruta: C-02 rinde 2 km/L → más CO₂ por km que C-01 (4 km/L)
const two = [];
for (let i = 10; i <= 13; i += 1) {
  two.push(mk(`a${i}`, `2026-10-${i}`));
  two.push(mk(`b${i}`, `2026-10-${i}`, { end: '14:30', extra: { vehicle_id: 'v2' } }));
}
const t = buildComparison({ runs: two, vehicles, routes, drivers: [], fuelLogs: [], period: 14, now }).trucksOnRoute;
assert.equal(t.length, 1);
assert.equal(t[0].routeName, 'Ruta Centro');
assert.equal(t[0].trucks.length, 2);
const c1 = t[0].trucks.find((x) => x.label === 'C-01'); const c2 = t[0].trucks.find((x) => x.label === 'C-02');
assert.equal(c1.runs, 4); assert.equal(c1.minPerKm, 10); assert.equal(c2.minPerKm, 15);
assert.equal(c1.kmPerL, 4); assert.equal(c2.kmPerL, 2);
assert.equal(c1.co2PerKm, 0.67); assert.equal(c2.co2PerKm, 1.34);
assert.equal(t[0].bestVehicleId, 'v1'); assert.equal(t[0].bestBy, 'co2PerKm');
// un solo camión (o con menos de 2 corridas) no se compara
assert.equal(buildComparison({ runs: two.filter((r) => r.vehicle_id === 'v1'), vehicles, routes, drivers: [], fuelLogs: [], period: 14, now }).trucksOnRoute.length, 0);
assert.equal(buildComparison({ runs: [two[0], two[1]], vehicles, routes, drivers: [], fuelLogs: [], period: 14, now }).trucksOnRoute.length, 0);
console.log('run-comparison: ok');

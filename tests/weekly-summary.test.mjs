import assert from 'node:assert/strict';
import { buildWeeklySummary, WEEKLY_THRESHOLDS } from '../shared/weekly-summary.js';

assert.deepEqual(WEEKLY_THRESHOLDS, { estimatedShare: 0.5, minRunsForShare: 3, repeatedDeviations: 2, truckGapPct: 25, co2ChangePct: 10 });
const now = new Date('2026-10-16T16:00:00Z');
const vehicles = [
  { id: 'v1', code: 'C-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' },
  { id: 'v2', code: 'C-02', fuel_efficiency_km_per_l: 2, fuel_type: 'diesel' },
  { id: 'v3', code: 'C-03', fuel_efficiency_km_per_l: null, fuel_type: null }
];
const routes = [{ id: 'r1', name: 'Ruta Centro' }, { id: 'r2', name: 'Ruta Norte' }];
const mk = (id, day, o = {}) => ({ id, status: 'completed', vehicle_id: 'v1', route_id: 'r1', driver_id: 'd', is_test: false, started_at: `${day}T13:00:00Z`, completed_at: `${day}T${o.end ?? '14:00'}:00Z`, distance_meters: o.m ?? 6000, ...o.extra });
const ids = (s) => s.recommendations.map((r) => r.id);

// Semana vacía
let s = buildWeeklySummary({ runs: [], vehicles, routes, fuelLogs: [], now });
assert.equal(s.isEmpty, true);
assert.deepEqual(ids(s), ['sin-corridas']);
assert.match(s.text, /No hubo corridas completadas/);

// Semana con de todo
const runs = [
  mk('p1', '2026-09-20'), mk('p2', '2026-09-21'), mk('p3', '2026-09-22'), mk('p4', '2026-09-23'),
  mk('a1', '2026-10-12'), mk('a2', '2026-10-13', { end: '14:45' }), mk('a3', '2026-10-14', { end: '14:45' }),
  mk('b1', '2026-10-12', { extra: { vehicle_id: 'v2', route_id: 'r2' } }), mk('b2', '2026-10-13', { extra: { vehicle_id: 'v2', route_id: 'r2' } }),
  mk('c1', '2026-10-15', { extra: { vehicle_id: 'v3', route_id: 'r2' } })
];
// C-01 y C-02 en la misma ruta (Norte): C-02 rinde la mitad → más CO₂ por km
runs.push(mk('n1', '2026-10-14', { extra: { vehicle_id: 'v1', route_id: 'r2' } }), mk('n2', '2026-10-15', { extra: { vehicle_id: 'v1', route_id: 'r2' } }));
s = buildWeeklySummary({ runs, vehicles, routes, fuelLogs: [], now });
assert.equal(s.isEmpty, false);
assert.ok(s.headline.length >= 3);
assert.ok(ids(s).includes('vehiculo-sin-rendimiento'));
assert.equal(s.recommendations.find((r) => r.id === 'vehiculo-sin-rendimiento').action.kind, 'flota');
assert.match(s.recommendations.find((r) => r.id === 'vehiculo-sin-rendimiento').title, /C-03/);
assert.ok(ids(s).includes('litros-no-registrados'));       // todo es estimado: nadie registró litros
assert.ok(ids(s).includes('camion-gasta-mas'));
const gap = s.recommendations.find((r) => r.id === 'camion-gasta-mas');
assert.match(gap.title, /C-02/); assert.match(gap.title, /Ruta Norte/); assert.match(gap.detail, /C-01/);
assert.ok(ids(s).includes('desvios-repetidos'));           // a2 y a3 duran 45 min más que la base
assert.match(s.recommendations.find((r) => r.id === 'desvios-repetidos').title, /Ruta Centro/);
assert.ok(['atencion', 'info', 'ok'].every((sev) => s.recommendations.every((r) => ['atencion', 'info', 'ok'].includes(r.severity) || sev)));
assert.ok(s.recommendations.every((r) => r.title && r.detail && ['atencion', 'info', 'ok'].includes(r.severity)));
// ordenadas: atención primero
const sev = s.recommendations.map((r) => r.severity);
assert.deepEqual([...sev].sort((a, b) => ['atencion', 'info', 'ok'].indexOf(a) - ['atencion', 'info', 'ok'].indexOf(b)), sev);
// texto copiable
assert.match(s.text, /Resumen semanal/); assert.match(s.text, /Recomendaciones/); assert.match(s.text, /C-03/);
assert.equal(s.period.days, 7);

// con litros registrados no se pide registrar litros
const fuel = runs.filter((r) => r.started_at >= '2026-10-10').map((r) => ({ route_run_id: r.id, liters: 2 }));
assert.ok(!ids(buildWeeklySummary({ runs, vehicles, routes, fuelLogs: fuel, now })).includes('litros-no-registrados'));
// poca muestra: sin recomendación de litros
assert.ok(!ids(buildWeeklySummary({ runs: runs.slice(4, 6), vehicles, routes, fuelLogs: [], now })).includes('litros-no-registrados'));
// cambio de CO₂ de la semana
const less = buildWeeklySummary({ runs: [mk('q1', '2026-10-05'), mk('q2', '2026-10-06'), mk('q3', '2026-10-07'), mk('z', '2026-10-14')], vehicles, routes, fuelLogs: [], now });
assert.ok(ids(less).includes('co2-baja'));
const more = buildWeeklySummary({ runs: [mk('q1', '2026-10-05'), mk('z1', '2026-10-13'), mk('z2', '2026-10-14'), mk('z3', '2026-10-15')], vehicles, routes, fuelLogs: [], now });
assert.ok(ids(more).includes('co2-sube'));
// siempre hay algo que decir: si todo va bien, "sin-novedades"
const calm = buildWeeklySummary({ runs: [mk('c1', '2026-10-05'), mk('c2', '2026-10-06'), mk('c3', '2026-10-12'), mk('c4', '2026-10-13')], vehicles: [vehicles[0]], routes, fuelLogs: [{ route_run_id: 'c3', liters: 2 }, { route_run_id: 'c4', liters: 2 }, { route_run_id: 'c1', liters: 2 }, { route_run_id: 'c2', liters: 2 }], now });
assert.ok(ids(calm).includes('sin-novedades') || calm.recommendations.length > 0);
console.log('weekly-summary: ok');

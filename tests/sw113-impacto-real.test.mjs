// SW-113: Impacto y Ahorros calculado con corridas reales (medido, proyectado, potencial).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRealImpact } from '../shared/impact-real.js';
import { renderImpactReal } from '../frontend/components/impact-real-screen.js';
import { formatNumber } from '../shared/metrics-view.js';

const now = new Date('2026-11-06T16:00:00Z');
const vehicles = [{ id: 'v1', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' }];
const routes = [{ id: 'r1', name: 'Ruta Centro' }];
const params = { fuelPrice: 80, fuelEfficiency: 4, operatingDays: 20 };
const run = (id, day, km, extra = {}) => ({ id, route_id: 'r1', vehicle_id: 'v1', status: 'completed', is_test: false, distance_meters: km * 1000, started_at: `2026-11-${day}T12:00:00Z`, completed_at: `2026-11-${day}T14:00:00Z`, ...extra });
const fmt = { number: formatNumber };

// Sin corridas: todo en cero y sin proyección ni potencial.
let m = buildRealImpact({ runs: [], vehicles, routes, costParameters: params, periodDays: 30, now });
assert.equal(m.measured.runs, 0);
assert.equal(m.projection, null);
assert.equal(m.potential, null);
assert.match(renderImpactReal({ model: m, period: 30, fmt }), /Aún no hay corridas completadas/);

// Corridas de prueba, incompletas o fuera del periodo no cuentan.
m = buildRealImpact({ runs: [run('a', '05', 10, { is_test: true }), run('b', '05', 10, { status: 'in_progress' }), { ...run('c', '05', 10), started_at: '2026-08-01T12:00:00Z' }], vehicles, routes, costParameters: params, periodDays: 30, now });
assert.equal(m.measured.runs, 0);

// Dos días con corridas: se mide pero no se proyecta (mínimo 3 días).
const two = [run('a', '04', 10), run('b', '05', 20)];
m = buildRealImpact({ runs: two, vehicles, routes, costParameters: params, periodDays: 30, now });
assert.equal(m.measured.runs, 2);
assert.equal(m.measured.km, 30);
assert.equal(m.measured.hours, 4);
assert.equal(m.measured.liters, 7.5);      // 30 km ÷ 4 km/L, estimado
assert.equal(m.measured.fuelCost, 600);    // 7.5 L × 80
assert.equal(m.measured.co2Kg, 20.1);      // 7.5 × 2.68
assert.equal(m.projection, null);
assert.match(renderImpactReal({ model: m, period: 30, fmt }), /Aún no hay datos suficientes para proyectar/);

// Tres días: proyección = promedio por día con corridas × días operativos.
const three = [run('a', '03', 10), run('b', '04', 20), run('c', '05', 30)];
m = buildRealImpact({ runs: three, vehicles, routes, costParameters: params, periodDays: 30, now });
assert.equal(m.measured.activeDays, 3);
assert.equal(m.projection.km, 400);        // 60 km × 20/3
assert.equal(m.projection.fuelCost, Math.round(m.measured.fuelCost * 20 / 3));

// SW-114: lo que anota el conductor no cambia el gasto (solo sirve de control).
m = buildRealImpact({ runs: three, vehicles, routes, fuelLogs: [{ route_run_id: 'a', liters: 5 }], costParameters: params, periodDays: 30, now });
assert.equal(m.measured.liters, 15);        // 60 km ÷ 4 km/L, solo por rendimiento del camión
assert.equal(m.measured.loggedLiters, 5);
assert.equal(m.perRoute[0].source, 'estimado');

// Sin rendimiento ni litros: combustible y costo quedan en null (nunca una cifra inventada).
m = buildRealImpact({ runs: three, vehicles: [{ id: 'v1' }], routes, costParameters: params, periodDays: 30, now });
assert.equal(m.measured.liters, null);
assert.equal(m.measured.fuelCost, null);
assert.equal(m.measured.runsWithoutFuel, 3);
assert.equal(m.projection.fuelCost, null);

// Potencial: solo con rutas de 3+ paradas; parada desordenada → ahorro positivo.
const stops = [[18.0, -71.0], [18.02, -71.0], [18.0, -71.01], [18.02, -71.01]].map(([latitude, longitude]) => ({ latitude, longitude }));
m = buildRealImpact({ runs: three, vehicles, routes, routeStops: { r1: stops }, costParameters: params, periodDays: 30, now });
assert.ok(m.potential && m.potential.km > 0 && m.potential.liters > 0 && m.potential.routesCompared === 1);
assert.equal(m.potential.kmPerLiter, 4); // rendimiento real de los camiones, no un número de referencia
m = buildRealImpact({ runs: three, vehicles, routes, routeStops: { r1: stops.slice(0, 2) }, costParameters: params, periodDays: 30, now });
assert.equal(m.potential, null);

// La pantalla rotula cada bloque y el cableado en app.js existe.
const html = renderImpactReal({ model: buildRealImpact({ runs: three, vehicles, routes, routeStops: { r1: stops }, costParameters: params, periodDays: 30, now }), period: 30, fmt, priceConfigured: false });
for (const word of ['gal', 'Medido', 'Proyectado', 'Potencial', 'Detalle por ruta', 'data-impact-period="30"', 'precio del combustible es un valor de referencia', 'contra el método anterior']) assert.ok(html.includes(word), word);
const src = readFileSync('frontend/app.js', 'utf8');
assert.match(src, /if \(id === 'impacto'\) \{ if \(HIDE_DEMO\) loadImpactReal\(\)/);
assert.match(src, /buildRealImpact\(\{ runs: d\.runs/);
console.log('sw113-impacto-real ok');

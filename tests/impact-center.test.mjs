import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateImpactMetrics, defaultImpactAssumptions, IMPACT_DEMO_NOTICE, IMPACT_SCENARIO_NOTICE, metricReadiness } from '../shared/impact-center.js';
import { trucks } from '../shared/demo-data.js';

const metrics = calculateImpactMetrics(defaultImpactAssumptions);
assert.equal(metrics.fleet.total, metrics.fleet.active + metrics.fleet.stopped + metrics.fleet.delayed + metrics.fleet.offline + metrics.fleet.maintenance + metrics.fleet.completed);
assert.equal(metrics.routes.planned, metrics.routes.assigned);
assert.equal(metrics.efficiency.avoidedKm, Number((defaultImpactAssumptions.baseDistanceKm - defaultImpactAssumptions.currentDistanceKm).toFixed(1)));
assert.equal(metrics.economics.annualProjectionDemo, Number((metrics.economics.monthlyPotentialAvoided * 12).toFixed(2)));
assert.ok(metrics.beforeAfter.every((row) => Number.isFinite(row.absolute) && Number.isFinite(row.variation)));
assert.ok(metrics.beforeAfter.filter((row) => row.unit === '%').every((row) => row.points !== null));
assert.ok(metricReadiness.REAL_READY.includes('routes'));
assert.ok(metricReadiness.DEMO_ONLY.includes('impacto económico estimado'));
assert.ok(metricReadiness.BLOCKED.includes('GPS físico verificado'));

const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.equal(IMPACT_DEMO_NOTICE, 'Datos simulados para demostración · no representan resultados reales del ayuntamiento');
assert.equal(IMPACT_SCENARIO_NOTICE, 'Escenario simulado para demostración');
assert.ok(app.includes('IMPACT_DEMO_NOTICE'));
assert.ok(app.includes('IMPACT_SCENARIO_NOTICE'));
assert.ok(html.includes('Impacto y Ahorros'));
assert.ok(app.includes('tile.openstreetmap.org'));
assert.ok(app.includes('Mapa externo no disponible'));
assert.ok(app.includes('simulationNotice')); // imported from demo data and rendered in map controls
assert.equal(new Set(trucks.map((truck) => truck.id)).size, trucks.length);

// Uso estimado del camión (paradas × minutos/parada + distancia/velocidad) — pedido explícito del
// Project Owner de priorizar estadísticas de uso sobre ahorro. Es una fórmula, no una medición real.
assert.ok(metrics.usage, 'calculateImpactMetrics debe incluir metrics.usage');
assert.equal(metrics.usage.byRoute.length, metrics.routes.planned);
const expectedTotalMinutes = metrics.usage.byRoute.reduce((sum, r) => sum + r.totalMinutes, 0);
assert.ok(Math.abs(metrics.usage.totalMinutes - expectedTotalMinutes) < 0.15, 'totalMinutes debe ser la suma de cada ruta');
assert.equal(metrics.usage.totalHours, Number((metrics.usage.totalMinutes / 60).toFixed(2)));
metrics.usage.byRoute.forEach((r) => {
  const expectedStopMinutes = Number((r.stops * metrics.usage.minutesPerStop).toFixed(1));
  assert.equal(r.stopMinutes, expectedStopMinutes, `stopMinutes de ${r.name} debe ser paradas × minutesPerStop`);
  assert.ok(r.totalMinutes >= r.stopMinutes, 'totalMinutes nunca debe ser menor que el tiempo de recolección solo');
});
const usageByVehicleTotal = metrics.usage.byVehicle.reduce((sum, v) => sum + v.totalMinutes, 0);
assert.ok(Math.abs(usageByVehicleTotal - metrics.usage.totalMinutes) < 0.2, 'la suma por vehículo debe cuadrar con el total');
// Supuestos configurables: minutesPerStop más alto debe subir el uso estimado, nunca bajarlo.
const higherUsage = calculateImpactMetrics({ ...defaultImpactAssumptions, minutesPerStop: defaultImpactAssumptions.minutesPerStop * 2 });
assert.ok(higherUsage.usage.totalMinutes > metrics.usage.totalMinutes, 'duplicar minutesPerStop debe aumentar el uso total estimado');

// Codex review PR #54 (P2): filtrar por vehículo debía acotar Uso a las rutas de ese vehículo, no
// seguir reportando la flota completa. truck-05 (offline, sin ruta) debe dar uso cero.
const unassignedVehicleMetrics = calculateImpactMetrics(defaultImpactAssumptions, { vehicle: 'truck-05' });
assert.equal(unassignedVehicleMetrics.usage.byRoute.length, 0, 'un vehículo sin ruta asignada no debe aportar rutas al uso filtrado');
assert.equal(unassignedVehicleMetrics.usage.totalMinutes, 0);
const assignedVehicleMetrics = calculateImpactMetrics(defaultImpactAssumptions, { vehicle: 'truck-01' });
assert.equal(assignedVehicleMetrics.usage.byRoute.length, 1, 'un vehículo con una ruta asignada debe aportar exactamente esa ruta al uso filtrado');
assert.ok(assignedVehicleMetrics.usage.totalMinutes < metrics.usage.totalMinutes, 'el uso filtrado por un vehículo debe ser menor que el total de la flota');

console.log('impact-center ok');

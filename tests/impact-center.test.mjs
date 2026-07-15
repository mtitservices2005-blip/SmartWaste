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
console.log('impact-center ok');

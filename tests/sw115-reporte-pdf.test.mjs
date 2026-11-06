// SW-115: reportes imprimibles de Métricas y de Impacto y Ahorros + botón "Descargar reporte PDF".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMetricsView } from '../shared/metrics-view.js';
import { buildRealImpact } from '../shared/impact-real.js';
import { renderMetricsReport, renderImpactReport, periodText, longDate } from '../shared/report-html.js';
import { renderMetricsPage } from '../frontend/components/metrics-screens.js';
import { renderImpactReal } from '../frontend/components/impact-real-screen.js';
import { printReport } from '../frontend/report-print.js';
import { formatNumber, formatKm, formatDuration } from '../shared/metrics-view.js';

const now = new Date('2026-11-06T16:00:00Z');
const vehicles = [{ id: 'v1', code: 'SW-LS-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' }, { id: 'v2', code: 'SW-LS-02' }];
const routes = [{ id: 'r1', name: 'Ruta <Centro>' }];
const mk = (id, day, km, extra = {}) => ({ id, route_id: 'r1', vehicle_id: 'v1', driver_id: null, status: 'completed', is_test: false, distance_meters: km * 1000, started_at: `2026-11-${day}T12:00:00Z`, completed_at: `2026-11-${day}T14:00:00Z`, scheduled_start_at: `2026-11-${day}T11:55:00Z`, ...extra });
const runs = [mk('a', '03', 10), mk('b', '04', 20), mk('c', '05', 30), mk('d', '05', 12, { vehicle_id: 'v2' }), mk('t', '05', 99, { is_test: true })];
const fuelLogs = [{ route_run_id: 'a', liters: 5 }];

assert.equal(longDate(now), '6 de noviembre de 2026');
assert.equal(periodText(30, now), '8 de octubre de 2026 al 6 de noviembre de 2026');

// Métricas
const view = buildMetricsView({ runs, vehicles, routes, drivers: [], fuelLogs, period: 30, now });
const html = renderMetricsReport({ view, period: 30, municipalityName: 'Laguna Salada', rawRuns: runs, now });
assert.match(html, /^<!doctype html>/);
assert.match(html, /<title>SmartWaste-Reporte-Metricas-2026-11-06<\/title>/);
for (const w of ['Ayuntamiento de Laguna Salada', 'Reporte de Métricas operativas', 'Por ruta', 'Por camión', 'Galones', 'Puntualidad de salida', '100%', 'Calidad de los datos', 'Control:', 'sin rendimiento']) assert.ok(html.includes(w), w);
assert.ok(html.includes('Ruta &lt;Centro&gt;') && !html.includes('Ruta <Centro>'), 'escapa los nombres');
assert.ok(!/ L<|litros/i.test(html.replace(/Control[^<]*/g, '')), 'sin litros a la vista');
assert.ok(!html.includes('99,0') && view.summary.runCount === 4, 'la corrida de prueba no cuenta');

// Impacto
const model = buildRealImpact({ runs, vehicles, routes, fuelLogs, costParameters: { fuelPrice: 80, operatingDays: 20 }, periodDays: 30, now });
const ih = renderImpactReport({ model, period: 30, municipalityName: 'Laguna Salada', priceConfigured: false, now });
for (const w of ['Reporte de Impacto y Ahorros', 'Medido', 'Proyectado', 'Potencial', 'Costo por ruta', 'valor de referencia', 'por galón', 'contra el método anterior']) assert.ok(ih.includes(w), w);
assert.match(ih, /<title>SmartWaste-Reporte-Impacto-y-Ahorros-2026-11-06<\/title>/);
// Sin datos suficientes: sin proyección, sin números inventados
const empty = buildRealImpact({ runs: [], vehicles, routes, costParameters: {}, periodDays: 30, now });
const eh = renderImpactReport({ model: empty, period: 30, now });
assert.ok(eh.includes('Aún no hay datos suficientes para proyectar') && eh.includes('Pendiente de datos'));

// Botones: solo con datos
const fmt = { number: formatNumber, km: formatKm, duration: formatDuration };
assert.ok(renderMetricsPage({ view, period: 30, tab: 'camiones', filters: {}, options: { routes: [], vehicles: [], drivers: [] }, fmt }).includes('data-report-download="metricas"'));
const noRuns = buildMetricsView({ runs: [], vehicles, period: 30, now });
assert.ok(!renderMetricsPage({ view: noRuns, period: 30, tab: 'camiones', filters: {}, options: { routes: [], vehicles: [], drivers: [] }, fmt }).includes('data-report-download'));
assert.ok(renderImpactReal({ model, period: 30, fmt: { number: formatNumber } }).includes('data-report-download="impacto"'));
assert.ok(!renderImpactReal({ model: empty, period: 30, fmt: { number: formatNumber } }).includes('data-report-download'));

// Impresión: marco oculto con srcdoc, se elimina al terminar
const added = [];
const frame = { style: {}, setAttribute() {}, remove() { frame.removed = true; } };
printReport('<p>x</p>', { doc: { createElement: () => frame, body: { appendChild: (el) => added.push(el) } } });
assert.equal(added[0], frame); assert.equal(frame.srcdoc, '<p>x</p>');

// Cableado
const src = readFileSync('frontend/app.js', 'utf8');
assert.match(src, /dl\.dataset\.reportDownload/);
assert.match(src, /renderMetricsReport\(\{ view, period: metrics\.period/);
assert.match(src, /renderImpactReport\(\{ model, period: impactReal\.period/);
console.log('sw115-reporte-pdf ok');

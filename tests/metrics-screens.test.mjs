import assert from 'node:assert/strict';
import { renderMetricsPage, renderBarChart, sourceBadge } from '../frontend/components/metrics-screens.js';
import { buildMetricsView, formatNumber, formatKm, formatDuration } from '../shared/metrics-view.js';

const fmt = { number: formatNumber, km: formatKm, duration: formatDuration };
const now = new Date('2026-10-16T16:00:00Z');
const vehicles = [{ id: 'v1', code: 'C-<01>', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' }, { id: 'v2', code: 'C-02' }];
const mk = (o) => ({ status: 'completed', started_at: '2026-10-15T13:00:00Z', completed_at: '2026-10-15T14:00:00Z', distance_meters: 8000, route_id: 'r', driver_id: 'd', is_test: false, ...o });
const view = buildMetricsView({ runs: [mk({ id: 'a', vehicle_id: 'v1' }), mk({ id: 'b', vehicle_id: 'v2' }), mk({ id: 't', vehicle_id: 'v1', is_test: true })], vehicles, routes: [{ id: 'r', name: 'Ruta Centro' }], drivers: [{ id: 'd', display_name: 'Carlos' }], fuelLogs: [], period: 14, now });
const opts = { routes: [{ id: 'r', name: 'Ruta Centro' }], vehicles: [{ id: 'v1', label: 'C-<01>' }], drivers: [{ id: 'd', name: 'Carlos' }] };
const page = (extra = {}) => renderMetricsPage({ view, period: 14, tab: 'camiones', filters: {}, options: opts, fmt, demo: true, municipalityName: 'Laguna Salada', ...extra });

let h = page();
assert.match(h, /<h2>Métricas<\/h2>/);
assert.match(h, /Datos demo · no producción/);
for (const p of ['Hoy', '7 días', '14 días', '30 días', 'Trimestre']) assert.match(h, new RegExp(`>${p}<`));
assert.match(h, /data-metrics-period="14"[^>]*aria-pressed="true"/);
for (const l of ['Corridas completadas', 'Distancia medida', 'Tiempo en ruta', 'Consumo', 'Huella de carbono']) assert.match(h, new RegExp(l));
assert.match(h, /1 de 2 camiones con dato/);
assert.match(h, /C-02 no tiene rendimiento configurado/);
assert.match(h, /Configurarlo en Flotilla/);
assert.match(h, /Kilómetros por día/); assert.match(h, /CO₂ estimado por día/);
assert.match(h, /id="metricsRoute"/); assert.match(h, /id="metricsVehicle"/); assert.match(h, /id="metricsDriver"/);
assert.match(h, /Incluir corridas de prueba/); assert.match(h, /\(1 excluida\)/);
for (const t of ['Por camión', 'Por ruta', 'Por conductor', 'Corridas']) assert.match(h, new RegExp(`>${t}<`));
assert.ok(h.includes('C-&lt;01&gt;') && !h.includes('C-<01>'), 'escapa texto');
assert.match(h, /Sin datos/); assert.match(h, /Estimado/);
assert.match(h, /Configurar<\/a>/);

h = page({ tab: 'corridas', selectedRunId: 'a' });
assert.match(h, /Marcar como corrida de prueba/); assert.match(h, /data-metrics-run="a"/);
assert.match(h, /Las corridas de prueba se guardan, pero no suman en las métricas\./);
assert.match(page({ tab: 'corridas', selectedRunId: 'a', trace: [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }] }), /<polyline/);
const viewT = buildMetricsView({ runs: [mk({ id: 'a', vehicle_id: 'v1' }), mk({ id: 't', vehicle_id: 'v1', is_test: true })], vehicles, routes: [{ id: 'r', name: 'Ruta Centro' }], drivers: [{ id: 'd', display_name: 'Carlos' }], fuelLogs: [], period: 14, filters: { includeTests: true }, now });
h = page({ view: viewT, tab: 'corridas', filters: { includeTests: true }, selectedRunId: 't' });
assert.match(h, /Prueba/); assert.match(h, /Quitar la marca de prueba/);
assert.match(page({ demo: false }), /^(?:(?!Datos demo).)*$/s);

// vacío
const empty = buildMetricsView({ runs: [], vehicles, period: 14, now });
assert.match(renderMetricsPage({ view: empty, period: 14, tab: 'camiones', filters: {}, options: opts, fmt }), /Todavía no hay corridas completadas/);

// gráfica
const c = renderBarChart({ values: [0, 5, 12.5], labels: ['14', '15', '16'], unit: 'km', name: 'Kilómetros por día', tips: ['14 oct · sin corridas', '15 oct · 5 km', '16 oct · 12,5 km'], color: 'var(--color-primary)' });
assert.match(c, /role="img"/); assert.match(c, /aria-label="Kilómetros por día/); assert.match(c, /data-tip="15 oct · 5 km"/);
assert.match(c, /<path d="M/); assert.match(c, />12,5</); // etiqueta del máximo y del último
assert.match(sourceBadge('real'), /Real/); assert.match(sourceBadge('estimado'), /Estimado/); assert.match(sourceBadge('sin_datos'), /Sin datos/);
console.log('metrics-screens: ok');

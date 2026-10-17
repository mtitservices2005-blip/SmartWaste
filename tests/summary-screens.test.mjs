import assert from 'node:assert/strict';
import { renderWeeklySummary } from '../frontend/components/summary-screens.js';
import { renderMetricsPage } from '../frontend/components/metrics-screens.js';
import { buildMetricsView, formatNumber, formatKm, formatDuration } from '../shared/metrics-view.js';

const fmt = { number: formatNumber, km: formatKm, duration: formatDuration };
const weekly = {
  isEmpty: false, period: { days: 7, from: '2026-10-10', to: '2026-10-16' },
  headline: ['8 corridas completadas, 48 km medidos y 9 h 30 min en ruta.', 'Consumo: 13,5 L en 2 de 3 camiones con dato.', 'Huella de carbono estimada: 36,18 kg CO₂.'],
  recommendations: [
    { id: 'vehiculo-sin-rendimiento', severity: 'atencion', title: 'Configura el rendimiento de C-<03>', detail: 'Queda fuera del consumo.', action: { kind: 'flota' } },
    { id: 'camion-gasta-mas', severity: 'atencion', title: 'C-02 emite 100 % más CO₂ por km', detail: 'Revisar.', action: { kind: 'comparar' } },
    { id: 'litros-no-registrados', severity: 'info', title: 'Pide registrar litros', detail: '7 de 8 estimadas.' },
    { id: 'co2-baja', severity: 'ok', title: 'La huella bajó', detail: 'Buen avance.' }
  ],
  text: 'Resumen semanal de SmartWaste'
};
const h = renderWeeklySummary({ weekly });
assert.match(h, /Resumen de la semana/);
assert.match(h, /10 oct.*16 oct/s);
for (const t of weekly.headline) assert.ok(h.includes(t.replace('₂', '₂')));
assert.match(h, /Recomendaciones/);
assert.match(h, /sw-summary__rec--atencion/); assert.match(h, /sw-summary__rec--info/); assert.match(h, /sw-summary__rec--ok/);
assert.match(h, / Atención</); assert.match(h, / Información</); assert.match(h, / Bien</);
assert.ok(h.includes('C-&lt;03&gt;') && !h.includes('C-<03>'), 'escapa texto');
assert.match(h, /data-metrics-config/); assert.match(h, /data-metrics-tab="comparar"/);
assert.match(h, /data-metrics-copy/); assert.match(h, /Copiar resumen/);
assert.match(h, /independiente del periodo/i);
const empty = renderWeeklySummary({ weekly: { isEmpty: true, period: { days: 7, from: null, to: null }, headline: ['No hubo corridas completadas en los últimos 7 días.'], recommendations: [{ id: 'sin-corridas', severity: 'info', title: 'No hubo corridas', detail: 'Revisa.' }], text: 'x' } });
assert.match(empty, /No hubo corridas/);

const now = new Date('2026-10-16T16:00:00Z');
const view = buildMetricsView({ runs: [{ id: 'a', status: 'completed', vehicle_id: 'v1', route_id: 'r', is_test: false, started_at: '2026-10-15T13:00:00Z', completed_at: '2026-10-15T14:00:00Z', distance_meters: 6000 }], vehicles: [{ id: 'v1', code: 'C-01' }], routes: [{ id: 'r', name: 'R' }], drivers: [], fuelLogs: [], period: 14, now });
const page = renderMetricsPage({ view, period: 14, tab: 'resumen', filters: {}, options: { routes: [], vehicles: [], drivers: [] }, fmt, weekly });
assert.match(page, /data-metrics-tab="resumen"[^>]*aria-pressed="true"/); assert.match(page, />Resumen</); assert.match(page, /Resumen de la semana/);
console.log('summary-screens: ok');

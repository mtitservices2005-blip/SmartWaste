import assert from 'node:assert/strict';
import { renderComparison } from '../frontend/components/comparison-screens.js';
import { renderMetricsPage } from '../frontend/components/metrics-screens.js';
import { buildMetricsView, formatNumber, formatKm, formatDuration } from '../shared/metrics-view.js';

const fmt = { number: formatNumber, km: formatKm, duration: formatDuration };
const comparison = {
  isEmpty: false, withoutBase: 1,
  periodVsPrevious: {
    current: { runCount: 12, km: 80.5, minutes: 720, liters: 30, co2Kg: 80.4 },
    previous: { runCount: 10, km: 70, minutes: 600, liters: 35, co2Kg: 93.8 },
    deltas: { runCount: 20, km: 15, minutes: 20, liters: -14.3, co2Kg: -14.3 }
  },
  deviations: [{ runId: 'r<1>', startedAt: '2026-10-15T13:00:00Z', routeName: 'Ruta <Centro>', vehicleLabel: 'C-01', flags: [{ metric: 'duracion', value: 90, baseline: 60, deltaPct: 50 }, { metric: 'distancia', value: 3, baseline: 6, deltaPct: -50 }] }],
  trucksOnRoute: [{ routeId: 'r', routeName: 'Ruta Centro', bestVehicleId: 'v1', bestBy: 'co2PerKm', trucks: [{ vehicleId: 'v1', label: 'C-01', runs: 4, minPerKm: 10, kmPerL: 4, co2PerKm: 0.67 }, { vehicleId: 'v2', label: 'C-02', runs: 4, minPerKm: 15, kmPerL: null, co2PerKm: null }] }]
};
const h = renderComparison({ comparison, fmt });
assert.match(h, /Este periodo contra el anterior/);
for (const l of ['Corridas', 'Distancia', 'Tiempo en ruta', 'Consumo', 'Huella de carbono']) assert.match(h, new RegExp(l));
assert.match(h, /\+20 %/); assert.match(h, /−14,3 %/);
assert.match(h, /sw-compare__delta--good/); assert.match(h, /sw-compare__delta--bad/);
assert.match(h, /Desvíos/); assert.match(h, /Duración \+50 %/); assert.match(h, /Distancia −50 %/);
assert.match(h, /1 h 30 min.*1 h 00 min/s);
assert.ok(h.includes('Ruta &lt;Centro&gt;') && !h.includes('<Centro>'), 'escapa texto');
assert.match(h, /data-metrics-goto-run="r&lt;1&gt;"/);
assert.match(h, /1 ruta sin corridas previas suficientes/);
assert.match(h, /mínimo 3 corridas/);
assert.match(h, /Camiones en la misma ruta/); assert.match(h, /Ruta Centro/);
assert.match(h, /sw-compare__best/); assert.match(h, /Sin datos/);
const none = renderComparison({ comparison: { ...comparison, deviations: [], trucksOnRoute: [], withoutBase: 0 }, fmt });
assert.match(none, /Ninguna corrida se desvió/); assert.match(none, /Todavía no hay dos camiones/);
assert.match(renderComparison({ comparison: { ...comparison, isEmpty: true }, fmt }), /Todavía no hay corridas/);

// pestaña dentro de Métricas
const now = new Date('2026-10-16T16:00:00Z');
const mk = (id, day) => ({ id, status: 'completed', vehicle_id: 'v1', route_id: 'r', driver_id: 'd', is_test: false, started_at: `${day}T13:00:00Z`, completed_at: `${day}T14:00:00Z`, distance_meters: 6000 });
const view = buildMetricsView({ runs: [mk('a', '2026-10-15')], vehicles: [{ id: 'v1', code: 'C-01', fuel_efficiency_km_per_l: 4, fuel_type: 'diesel' }], routes: [{ id: 'r', name: 'Ruta' }], drivers: [], fuelLogs: [], period: 14, now });
assert.ok(view.comparison);
const page = renderMetricsPage({ view, period: 14, tab: 'comparar', filters: {}, options: { routes: [], vehicles: [], drivers: [] }, fmt });
assert.match(page, /data-metrics-tab="comparar"[^>]*aria-pressed="true"/); assert.match(page, />Comparar</);
assert.match(page, /Este periodo contra el anterior/);
console.log('comparison-screens: ok');

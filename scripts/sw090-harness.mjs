// SW-090: genera páginas de evidencia con los componentes REALES y datos de ejemplo (sin red), para fotografiarlas
// junto a la maqueta aprobada. Uso: node scripts/sw090-harness.mjs <carpeta-salida>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderRail } from '../frontend/components/rail.js';
import { renderMetricsPage } from '../frontend/components/metrics-screens.js';
import { renderFleetTabs, renderVehiclesTable, renderVehicleForm } from '../frontend/components/fleet-screens.js';
import { buildMetricsView, formatNumber, formatKm, formatDuration } from '../shared/metrics-view.js';
import { buildVehicleRows } from '../shared/fleet-list.js';

const out = process.argv[2] ?? 'docs/evidence/SW-090';
mkdirSync(out, { recursive: true });
const css = ['tokens', 'components', 'theme-mando', 'shell'].map((f) => readFileSync(`frontend/styles/${f}.css`, 'utf8')).join('\n')
  + ['../styles', 'legacy-theme', 'driver', 'login', 'routes', 'fleet', 'metrics'].map((f) => readFileSync(`frontend/styles/${f}.css`.replace('styles/../styles', 'styles'), 'utf8')).join('\n');

const now = new Date('2026-10-16T16:00:00Z');
const vehicles = [
  { id: 'v1', code: 'SW-LS-01', plate: 'DEMO-LS-001', max_stops: 20, state: 'active', fuel_efficiency_km_per_l: 2.2, fuel_type: 'diesel' },
  { id: 'v2', code: 'SW-LS-02', plate: 'DEMO-LS-002', max_stops: 20, state: 'active', fuel_efficiency_km_per_l: 2.5, fuel_type: 'diesel' },
  { id: 'v3', code: 'SW-LS-03', plate: 'DEMO-LS-003', max_stops: 20, state: 'stopped', fuel_efficiency_km_per_l: null, fuel_type: null }
];
const routes = [{ id: 'r1', name: 'Ruta Centro' }, { id: 'r2', name: 'Ruta Norte' }, { id: 'r3', name: 'Ruta Mercado' }];
const drivers = [{ id: 'd1', display_name: 'Carlos Peña' }, { id: 'd2', display_name: 'Ana Reyes' }, { id: 'd3', display_name: 'Luis Mejía' }];
const runs = []; const fuelLogs = [];
let n = 0;
for (let i = 27; i >= 0; i -= 1) {
  const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
  [['v1', 'r1', 'd1', '10:00', 6.4], ['v2', 'r2', 'd2', '11:15', 5.1], [i % 2 ? 'v1' : 'v3', 'r3', i % 2 ? 'd1' : 'd3', '11:20', 4.2]].forEach(([v, r, d, t, km], k) => {
    if ((i + k) % 5 === 4) return;
    n += 1;
    const jitter = 1 + (((i * 7 + k * 3) % 5) - 2) / 20;
    const id = `run${n}`;
    runs.push({ id, status: 'completed', vehicle_id: v, route_id: r, driver_id: d, started_at: `${day}T${t}:00Z`, completed_at: `${day}T${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:${t.slice(3)}:00Z`, distance_meters: Math.round(km * jitter * 1000), gps_points_count: 400 + n, is_test: false });
    if (v === 'v1' && i < 9) fuelLogs.push({ route_run_id: id, liters: Math.round((km * jitter / 2.2) * 10) / 10 });
  });
}
// SW-091: dos corridas que se salen de lo habitual para mostrar los desvíos.
const centro = runs.filter((r) => r.route_id === 'r1');
const slowRun = centro[centro.length - 1]; slowRun.completed_at = new Date(new Date(slowRun.started_at).getTime() + 95 * 60000).toISOString();
const shortRun = centro[centro.length - 3]; shortRun.distance_meters = Math.round(shortRun.distance_meters * 0.45);
runs.push({ ...runs[runs.length - 1], id: 'test1', is_test: true, distance_meters: 300 });
const fmt = { number: formatNumber, km: formatKm, duration: formatDuration };
const view = (filters = {}) => buildMetricsView({ runs, vehicles, routes, drivers, fuelLogs, period: 14, filters, now });
const options = { routes, vehicles: vehicles.map((v) => ({ id: v.id, label: v.code })), drivers: drivers.map((d) => ({ id: d.id, name: d.display_name })) };
const trace = Array.from({ length: 30 }, (_, i) => ({ latitude: 19.88 + i * 0.0004 + Math.sin(i / 3) * 0.0003, longitude: -71.7 + i * 0.0007 }));
const page = (hash, inner) => `<!doctype html><html lang="es" data-theme="oscuro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SW-090 evidencia</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><style>${css}</style>
<script>var t=new URLSearchParams(location.search).get('t');document.documentElement.dataset.theme=t==='claro'?'claro':'oscuro';</script></head>
<body>${renderRail({ hash })}<main id="app"><section id="operaciones" class="section"><div class="ops-panel card" data-ops-view="x">${inner}</div></section></main></body></html>`;
const pageA = renderMetricsPage({ view: view(), period: 14, tab: 'camiones', filters: {}, options, fmt, demo: true, municipalityName: 'Laguna Salada' });
const pageB = renderMetricsPage({ view: view({ includeTests: true }), period: 14, tab: 'corridas', filters: { includeTests: true }, options, selectedRunId: runs.find((r) => r.id !== 'test1' && r.vehicle_id === 'v1' && fuelLogs.some((f) => f.route_run_id === r.id))?.id, trace, fmt, demo: true, municipalityName: 'Laguna Salada' });
const pageD = renderMetricsPage({ view: view(), period: 14, tab: 'comparar', filters: {}, options, fmt, demo: true, municipalityName: 'Laguna Salada' });
const rows = buildVehicleRows(vehicles.map((v) => ({ id: v.id, unit: v.code, plate: v.plate, max_stops: v.max_stops, state: v.state, fuel_efficiency_km_per_l: v.fuel_efficiency_km_per_l, fuel_type: v.fuel_type })));
const pageC = `<div class="sw-rutas__head"><div><h2>Flotilla</h2><p class="sw-rutas__sub">3 camiones registrados · datos de ejemplo</p><p class="demo sw-rutas__demo">Datos demo · no producción</p></div></div>${renderFleetTabs({ tab: 'camiones' })}<div class="sw-rutas__body"><div class="sw-rutas__main">${renderVehiclesTable({ rows, selectedId: 'v3' })}</div><aside class="sw-rutas__side"><div id="fleetManagement">${renderVehicleForm({ vehicle: rows[2] })}</div></aside></div>`;
writeFileSync(`${out}/harness-a.html`, page('#operaciones/estadisticas', pageA));
writeFileSync(`${out}/harness-b.html`, page('#operaciones/estadisticas', pageB));
writeFileSync(`${out}/harness-d.html`, page('#operaciones/estadisticas', pageD));
writeFileSync(`${out}/harness-c.html`, page('#operaciones/flota', pageC));
console.log('ok', runs.length, 'corridas');

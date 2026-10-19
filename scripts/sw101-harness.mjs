// SW-101: maqueta de Ciudadanía a pantalla completa con los componentes REALES y datos de ejemplo (sin red).
// Uso: node scripts/sw101-harness.mjs <carpeta-salida>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderRail } from '../frontend/components/rail.js';
import { renderLiveHeader, renderLiveVehicleList, renderLiveEmpty, renderLiveMarker, renderLiveIconPicker, renderRouteCalendar, renderNextDeparture } from '../frontend/components/live-map.js';
import { describeVehicleStatus } from '../shared/live-fleet.js';
import { normalizeRouteSchedule, buildWeekCalendar, describeNextDeparture } from '../shared/route-calendar.js';
import { sectors, notifications } from '../shared/demo-data.js';

const out = process.argv[2] ?? 'docs/evidence/SW-101';
mkdirSync(out, { recursive: true });
const css = ['tokens', 'components', 'theme-mando', 'shell'].map((f) => readFileSync(new URL(`../frontend/styles/${f}.css`, import.meta.url), 'utf8')).join('\n')
  + ['../styles', 'legacy-theme', 'live'].map((f) => readFileSync(new URL(`../frontend/styles/${f}.css`.replace('styles/../styles', 'styles'), import.meta.url), 'utf8')).join('\n');

const schedule = normalizeRouteSchedule([
  { name: 'Ruta Centro', days_of_week: [1, 4], start_time: '08:00' },
  { name: 'Ruta Duarte', days_of_week: [2, 5], start_time: '07:00' },
  { name: 'Ruta Los Maestros', days_of_week: [3, 6], start_time: '07:30' },
  { name: 'Ruta Mercado', days_of_week: [4], start_time: '14:00' },
  { name: 'Ruta Salida a Mao', days_of_week: [6], start_time: '09:00' }
]);
const MON_10AM = Date.parse('2026-10-19T14:00:00Z');
const MON_9PM = Date.parse('2026-10-20T01:00:00Z');

const mk = (o) => { const v = { routeName: 'Ruta Centro', heading: 0, stoppedSinceMs: null, ...o }; v.statusText = describeVehicleStatus(v, MON_10AM); return v; };
const live = [mk({ code: 'SW-LS-01', status: 'en_ruta', ageSeconds: 6, capturedAtMs: MON_10AM - 6e3 }), mk({ code: 'SW-LS-02', routeName: 'Ruta Duarte', status: 'detenido', ageSeconds: 20, capturedAtMs: MON_10AM - 20e3, stoppedSinceMs: MON_10AM - 7 * 60e3 })];

const svgMap = (vehicles) => {
  const pts = Array.from({ length: 24 }, (_, i) => [30 + i * 14, 160 + Math.sin(i / 3) * 40 - i * 3]);
  const dots = vehicles.map((v, i) => { const p = pts[8 + i * 7]; return `<foreignObject x="${p[0] - 17}" y="${p[1] - 17}" width="34" height="34">${renderLiveMarker({ icon: 'compactador', status: v.status })}</foreignObject>`; }).join('');
  return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa de ejemplo"><rect width="400" height="260" fill="var(--color-background-alt)"/><polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--color-muted)" stroke-width="3" stroke-dasharray="6 5"/>${dots}</svg>`;
};

const info = `<div><h3>Consulta de recogida</h3><select id="citizenSector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><p>${sectors[0].pickupDay} · Estado: ${sectors[0].status}</p></div><div><h3>Avisos municipales</h3>${notifications.map((n) => `<div class="row">🔔 ${n}</div>`).join('')}</div>`;

function view({ vehicles, now }) {
  const calendar = renderRouteCalendar({ days: buildWeekCalendar(schedule, now) });
  const next = vehicles.length ? '' : renderNextDeparture(describeNextDeparture(schedule, now));
  const panel = renderLiveIconPicker({ selected: 'compactador' }) + next + (vehicles.length ? renderLiveVehicleList({ vehicles, selectedCode: vehicles[0].code }) : renderLiveEmpty());
  return `<section id="ciudadania" class="section card sw-citizen"><div class="sw-citizen__head"><h2>Camiones en vivo · Laguna Salada</h2><span class="demo">Actualizado hace 6 s</span></div>
    <div class="sw-citizen__stage"><div class="live-map">${svgMap(vehicles)}</div><div class="live-panel">${panel}</div></div>
    <div><h3>Calendario de rutas</h3>${calendar}</div>
    <div class="sw-citizen__info">${info}</div></section>`;
}

const page = (name, inner) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SW-101 ${name}</title><style>${css}</style><script>var t=new URLSearchParams(location.search).get('t');document.documentElement.dataset.theme=t==='claro'?'claro':'oscuro';</script></head><body>${renderRail({ hash: '#ciudadania' })}<main id="app">${inner}</main></body></html>`;
writeFileSync(`${out}/harness-con-camiones.html`, page('con camiones', view({ vehicles: live, now: MON_10AM })));
writeFileSync(`${out}/harness-sin-camiones.html`, page('sin camiones', view({ vehicles: [], now: MON_9PM })));
console.log('ok 2 escenarios');

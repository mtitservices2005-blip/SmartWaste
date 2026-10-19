// SW-097: maqueta estática con los componentes REALES y datos de ejemplo (sin red). El mapa es un recuadro SVG.
// Uso: node scripts/sw097-harness.mjs <carpeta-salida>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderLiveHeader, renderLiveVehicleList, renderLiveEmpty, renderLiveError, renderLiveNoMunicipality, renderLiveMarker, renderLiveIconPicker } from '../frontend/components/live-map.js';
import { describeVehicleStatus } from '../shared/live-fleet.js';

const out = process.argv[2] ?? 'docs/evidence/SW-097';
mkdirSync(out, { recursive: true });
const css = ['tokens', 'theme-mando', 'live'].map((f) => readFileSync(new URL(`../frontend/styles/${f}.css`, import.meta.url), 'utf8')).join('\n');

const NOW = Date.parse('2026-10-18T15:00:00Z');
const base = { routeName: 'Ruta Norte', heading: 40, runStartedAtMs: NOW - 3600e3, stoppedSinceMs: null };
const mk = (o) => { const v = { ...base, ...o }; v.statusText = describeVehicleStatus(v, NOW); return v; };
const enRuta = mk({ code: 'SW-LS-01', status: 'en_ruta', ageSeconds: 6, capturedAtMs: NOW - 6e3 });
const detenido = mk({ code: 'SW-LS-02', routeName: 'Ruta Centro', status: 'detenido', ageSeconds: 20, capturedAtMs: NOW - 20e3, stoppedSinceMs: NOW - 7 * 60e3 });
const sinSenal = mk({ code: 'SW-LS-03', routeName: 'Ruta Mercado', status: 'sin_senal', ageSeconds: 600, capturedAtMs: NOW - 600e3 });

const svgMap = (vehicles, icon) => {
  const pts = Array.from({ length: 24 }, (_, i) => [30 + i * 14, 160 + Math.sin(i / 3) * 40 - i * 3]);
  const path = pts.map((p) => p.join(',')).join(' ');
  const dots = vehicles.map((v, i) => { const p = pts[Math.min(pts.length - 1, 8 + i * 6)]; return `<foreignObject x="${p[0] - 17}" y="${p[1] - 17}" width="34" height="34">${renderLiveMarker({ icon, status: v.status })}</foreignObject>`; }).join('');
  return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa de ejemplo"><rect width="400" height="260" fill="var(--color-background-alt)"/><polyline points="${path}" fill="none" stroke="var(--color-muted)" stroke-width="3" stroke-dasharray="6 5"/>${dots}</svg>`;
};

const ICONS = { 'en-ruta': 'compactador', detenido: 'volquete', 'sin-senal': 'camioneta', error: 'punto' };
const scenarios = {
  'en-ruta': { vehicles: [enRuta], selected: 'SW-LS-01', updated: 'hace 6 s' },
  'detenido': { vehicles: [detenido, enRuta], selected: 'SW-LS-02', updated: 'hace 6 s' },
  'sin-senal': { vehicles: [sinSenal, enRuta], selected: 'SW-LS-03', updated: 'hace 12 s' },
  'vacio': { vehicles: [], empty: true, updated: 'hace 3 s' },
  'error': { vehicles: [enRuta, detenido], selected: 'SW-LS-01', updated: 'hace 1 min', error: true },
  'sin-municipio': { noMunicipality: true }
};

for (const [name, s] of Object.entries(scenarios)) {
  let panel;
  if (s.noMunicipality) panel = renderLiveNoMunicipality();
  else if (s.empty) panel = renderLiveEmpty();
  else panel = renderLiveIconPicker({ selected: ICONS[name] ?? 'compactador' }) + (s.error ? renderLiveError({ hasData: true }) : '') + renderLiveVehicleList({ vehicles: s.vehicles, selectedCode: s.selected });
  const header = renderLiveHeader({ municipalityName: s.noMunicipality ? '' : 'Laguna Salada', updatedAgoText: s.updated });
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SW-097 ${name}</title><style>${css}</style><script>var t=new URLSearchParams(location.search).get('t');document.documentElement.dataset.theme=t==='claro'?'claro':'oscuro';</script></head><body class="live-page"><div class="live-shell">${header}<div class="live-body"><div class="live-map">${svgMap(s.vehicles ?? [], ICONS[name] ?? 'compactador')}</div><div class="live-panel">${panel}</div></div></div></body></html>`;
  writeFileSync(`${out}/harness-${name}.html`, html);
}
console.log('ok', Object.keys(scenarios).length, 'escenarios');

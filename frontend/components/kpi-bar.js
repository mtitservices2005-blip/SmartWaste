// SW-084: barra de indicadores y chip "en vivo" del centro de control. HTML puro.
// Un dato que no existe llega como "—" desde shared/ops-kpis.js y aquí se explica, nunca se inventa.
import { escapeHtml } from './button.js';

const DEMO_TEXT = 'Datos demo · no producción';

export function renderKpiBar(kpis = {}) {
  const dash = (v) => v === '—' || v === undefined || v === null;
  const card = (label, value, hint = '') => `<div class="sw-kpi"><span class="sw-kpi__label">${escapeHtml(label)}</span><span class="sw-kpi__value">${escapeHtml(value ?? '—')}</span>${hint ? `<span class="sw-kpi__hint">${escapeHtml(hint)}</span>` : ''}</div>`;
  return `<div class="sw-kpis" id="swKpis" role="group" aria-label="Indicadores de hoy">`
    + card('En ruta', String(kpis.enRuta ?? 0), kpis.alerts > 0 ? `${kpis.alerts} sin señal` : '')
    + card('Cobertura hoy', kpis.coverage)
    + card('Distancia de rutas', kpis.distance)
    + card('Combustible', kpis.fuel, dash(kpis.fuel) ? 'sin registros' : '')
    + `</div>`;
}

export function renderLiveChip({ freshness = 'SIN DATOS', demo = false } = {}) {
  if (demo) return `<span class="sw-chip sw-chip--demo" id="swLive" role="status">${DEMO_TEXT}</span>`;
  const stale = !freshness.startsWith('EN VIVO');
  return `<span class="sw-chip ${stale ? 'sw-chip--stale' : 'sw-chip--live'}" id="swLive" role="status">${escapeHtml(freshness)}</span>`;
}

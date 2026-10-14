// SW-086: pantallas de Rutas del diseño Mando. HTML puro (sin DOM ni red): la tabla, los filtros, los
// días de la semana, el historial de corridas y la vista previa de la ruta nueva.
import { escapeHtml } from './button.js';
import { emptyState } from './empty-state.js';

const COLUMNS = ['Ruta', 'Camión', 'Conductor', 'Paradas', 'Largo', 'Estado'];

export function renderRoutesTable({ rows = [], selectedId = null } = {}) {
  if (!rows.length) return emptyState({ title: 'Todavía no hay rutas', message: 'Crea la primera con “+ Nueva ruta”.' });
  const head = COLUMNS.map((c) => `<th scope="col">${c}</th>`).join('');
  const body = rows.map((r) => {
    const cls = ['sw-routes__row', r.id === selectedId ? 'selected' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}" data-route="${escapeHtml(r.id)}" tabindex="0">`
      + `<td class="sw-routes__name">${escapeHtml(r.name)}</td>`
      + `<td>${escapeHtml(r.unit)}</td><td>${escapeHtml(r.driverName)}</td>`
      + `<td class="sw-routes__num">${escapeHtml(r.stopsCount)}</td><td class="sw-routes__num">${escapeHtml(r.lengthText)}</td>`
      + `<td><span class="sw-routes__state sw-routes__state--${escapeHtml(r.stateKey)}">${escapeHtml(r.stateLabel)}</span></td></tr>`;
  }).join('');
  return `<div class="sw-routes__scroll"><table class="sw-routes__table"><caption class="sw-visually-hidden">Rutas</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Los componentes no importan de shared/ (ver tests/components-imports.test.mjs): app.js pasa filtros y días.
export function renderFilterChips({ filters = [], filter = 'todas', counts = {} } = {}) {
  return `<div class="sw-routes__filters" role="group" aria-label="Filtrar rutas">${filters.map((f) => `<button type="button" class="sw-chip" data-route-filter="${f.key}" aria-pressed="${f.key === filter}">${f.label} · ${counts[f.key] ?? 0}</button>`).join('')}</div>`;
}

export function renderDayChips({ chips: dayChips = [], selected = [] } = {}) {
  const on = new Set((Array.isArray(selected) ? selected : []).map(Number));
  const chips = dayChips.map((d) => `<button type="button" class="sw-chip sw-chip--day" data-day="${d.value}" aria-pressed="${on.has(d.value)}" aria-label="${escapeHtml(d.name ?? d.label)}">${d.label}</button>`).join('');
  return `<div class="sw-routes__days" role="group" aria-label="Días de la semana">${chips}</div><p class="sw-routes__hint">${on.size ? '' : 'Sin días marcados: corre todos los días.'}</p>`;
}

export function renderHistory({ entries = [], count = 0, avgDurationText = '—', avgDistanceText = '—' } = {}) {
  if (!count) return '<p class="sw-routes__hint">Aún no se ha corrido esta ruta.</p>';
  const items = entries.map((e) => `<li><span>${escapeHtml(e.dateText)}</span><span>${escapeHtml(e.durationText)}</span><span>${escapeHtml(e.distanceText)}</span><span>${escapeHtml(e.driverName)}</span></li>`).join('');
  return `<p class="sw-routes__avg">Promedio de ${count} ${count === 1 ? 'corrida' : 'corridas'}: <strong>${escapeHtml(avgDurationText)}</strong> · <strong>${escapeHtml(avgDistanceText)}</strong></p><ul class="sw-routes__history">${items}</ul>`;
}

export function renderDraftPreview({ pointsText, distanceText, stopsCount, timeText } = {}) {
  return `<div class="sw-newroute__preview"><div class="sw-newroute__preview-head"><strong>Vista previa del viaje</strong><span>${escapeHtml(pointsText)}</span></div><dl><div><dt>Distancia</dt><dd>${escapeHtml(distanceText)}</dd></div><div><dt>Tiempo</dt><dd>${escapeHtml(timeText)}</dd></div><div><dt>Paradas</dt><dd>${escapeHtml(stopsCount)}</dd></div></dl></div>`;
}

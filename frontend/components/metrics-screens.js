// SW-090: pantalla Métricas del diseño Mando (filtros, indicadores, gráficas SVG, tablas y detalle de corrida).
// HTML puro (sin DOM ni red). No importa de ../shared: app.js le pasa `fmt` (formato es-DO) y el modelo de vista.
import { escapeHtml } from './button.js';
import { emptyState } from './empty-state.js';

const PERIODS = [{ days: 1, label: 'Hoy' }, { days: 7, label: '7 días' }, { days: 14, label: '14 días' }, { days: 30, label: '30 días' }, { days: 90, label: 'Trimestre' }];
const TABS = [{ key: 'camiones', label: 'Por camión' }, { key: 'rutas', label: 'Por ruta' }, { key: 'conductores', label: 'Por conductor' }, { key: 'corridas', label: 'Corridas' }];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SOURCES = { real: ['●', 'Real', 'real'], estimado: ['≈', 'Estimado', 'est'], sin_datos: ['–', 'Sin datos', 'none'] };
const muted = (t = '—') => `<span class="sw-metrics__muted">${t}</span>`;

export function sourceBadge(source) {
  const [icon, label, cls] = SOURCES[source] ?? SOURCES.sin_datos;
  return `<span class="sw-metrics__src sw-metrics__src--${cls}"><span aria-hidden="true">${icon}</span> ${label}</span>`;
}

const dayLabel = (day) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const dateTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return parts.replace('.', '');
};

function niceMax(max) {
  if (!(max > 0)) return 4;
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (max <= m * exp) return m * exp;
  return 10 * exp;
}
function roundedBar(x, y, w, h, r = 4) {
  if (h <= 0.5) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x.toFixed(1)},${(y + h).toFixed(1)} V${(y + rr).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)} H${(x + w - rr).toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)} V${(y + h).toFixed(1)} Z`;
}

// Gráfica de barras: base en cero, un eje, etiquetas solo en el máximo y el último valor, tooltip por barra (data-tip).
export function renderBarChart({ values, labels, tips, unit, name, color, fmtNumber = (n) => String(n).replace('.', ',') }) {
  const W = 560; const H = 230; const L = 40; const R = 10; const T = 20; const B = 30;
  const pw = W - L - R; const ph = H - T - B; const n = values.length; const band = pw / Math.max(n, 1); const bw = band * 0.58;
  const ymax = niceMax(Math.max(0, ...values));
  const max = Math.max(...values);
  const step = Math.ceil(n / 14);
  const out = [`<svg class="sw-metrics__chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(name)}, últimos ${n} ${n === 1 ? 'día' : 'días'}">`];
  for (let i = 0; i <= 3; i += 1) {
    const t = (ymax * i) / 3; const y = T + ph - (ph * t) / ymax;
    out.push(`<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="sw-metrics__grid${i === 0 ? ' sw-metrics__grid--base' : ''}"/>`);
    out.push(`<text x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="sw-metrics__tick">${fmtNumber(Number(t.toFixed(1)))}</text>`);
  }
  let labeled = false;
  values.forEach((v, i) => {
    const cx = L + band * i + band / 2; const x = cx - bw / 2; const h = (ph * v) / ymax; const y = T + ph - h;
    const path = roundedBar(x, y, bw, h);
    if (path) out.push(`<path d="${path}" fill="${color}"/>`);
    if (i % step === 0 || i === n - 1) out.push(`<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" class="sw-metrics__tick">${escapeHtml(labels[i])}</text>`);
    if (v > 0 && ((v === max && !labeled) || i === n - 1)) { if (v === max) labeled = true; out.push(`<text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="sw-metrics__val">${fmtNumber(v)}</text>`); }
    out.push(`<rect x="${(L + band * i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${(ph + B - 6).toFixed(1)}" fill="transparent" class="sw-metrics__hit" data-tip="${escapeHtml(tips[i])}"/>`);
  });
  out.push(`<text x="${L}" y="11" class="sw-metrics__axis">${escapeHtml(unit)}</text></svg>`);
  return out.join('');
}

function kpi(label, value, hint) {
  return `<div class="sw-kpi"><span class="sw-kpi__label">${escapeHtml(label)}</span><span class="sw-kpi__value">${value}</span><span class="sw-kpi__hint">${escapeHtml(hint)}</span></div>`;
}
const select = (id, label, allLabel, items, current) => `<label class="sw-metrics__sel" for="${id}"><span>${label}</span><select id="${id}"><option value="">${allLabel}</option>${items.map((i) => `<option value="${escapeHtml(i.id)}"${i.id === current ? ' selected' : ''}>${escapeHtml(i.label)}</option>`).join('')}</select></label>`;

function renderFilters({ period, filters, options, view }) {
  const chips = PERIODS.map((p) => `<button type="button" class="sw-chip" data-metrics-period="${p.days}" aria-pressed="${p.days === period}">${p.label}</button>`).join('');
  const ex = view.excludedTests;
  const hint = ex ? ` <small>(${ex} ${ex === 1 ? 'excluida' : 'excluidas'})</small>` : '';
  return `<div class="sw-metrics__filters"><div class="sw-routes__filters" role="group" aria-label="Periodo">${chips}</div>
    <div class="sw-metrics__selects">${select('metricsRoute', 'Ruta', 'Todas', options.routes.map((r) => ({ id: r.id, label: r.name })), filters.routeId)}${select('metricsVehicle', 'Camión', 'Todos', options.vehicles, filters.vehicleId)}${select('metricsDriver', 'Conductor', 'Todos', options.drivers.map((d) => ({ id: d.id, label: d.name })), filters.driverId)}
    <label class="sw-metrics__check"><input type="checkbox" id="metricsIncludeTests"${filters.includeTests ? ' checked' : ''}> Incluir corridas de prueba${hint}</label></div></div>`;
}

function renderKpis(view, fmt, period) {
  const s = view.summary;
  const cover = `${s.vehiclesWithData} de ${s.vehiclesTotal} camiones con dato`;
  const periodText = period === 1 ? 'hoy' : `en ${period} días`;
  return `<div class="sw-metrics__kpis">${kpi('Corridas completadas', String(s.runCount), periodText)}${kpi('Distancia medida', fmt.km(s.totalKm), 'GPS del teléfono')}${kpi('Tiempo en ruta', fmt.duration(s.totalMinutes), 'suma de corridas')}${kpi('Consumo', s.liters === null ? 'Sin datos' : `${fmt.number(s.liters, 2)} L`, s.liters === null ? 'falta rendimiento o litros' : cover)}${kpi('Huella de carbono', s.co2Kg === null ? 'Sin datos' : `${fmt.number(s.co2Kg, 2)} kg`, s.co2Kg === null ? 'falta rendimiento y combustible' : `CO₂ estimado · ${cover}`)}</div>`;
}

function renderNotice(view) {
  const miss = view.missingConfig;
  if (!miss.length) return '';
  const names = miss.map((m) => escapeHtml(m.label)).join(', ');
  const text = miss.length === 1 ? `${names} no tiene rendimiento configurado: su consumo y su CO₂ no se incluyen en estos totales.` : `${names} no tienen rendimiento configurado: su consumo y su CO₂ no se incluyen en estos totales.`;
  return `<p class="sw-metrics__notice" role="note"><span aria-hidden="true">⚠</span> ${text} <a class="sw-metrics__link" href="#operaciones/flota" data-metrics-config>Configurarlo en Flotilla</a></p>`;
}

function renderCharts(view, fmt) {
  const days = view.series.map((d) => d.day);
  const labels = days.map((d) => String(Number(d.slice(8, 10))));
  const km = view.series.map((d) => d.km);
  const co2 = view.series.map((d) => d.co2Kg ?? 0);
  const tips = (vals, unit, raw) => days.map((d, i) => (raw[i] === null || raw[i] === 0 ? `${dayLabel(d)} · sin ${unit === 'km' ? 'corridas' : 'datos'}` : `${dayLabel(d)} · ${fmt.number(vals[i], 2)} ${unit}`));
  const fn = (n) => fmt.number(n, 1);
  return `<div class="sw-metrics__charts"><section class="sw-rutas__card"><h3>Kilómetros por día</h3>${renderBarChart({ values: km, labels, tips: tips(km, 'km', km), unit: 'km', name: 'Kilómetros por día', color: 'var(--color-primary)', fmtNumber: fn })}</section><section class="sw-rutas__card"><h3>CO₂ estimado por día</h3>${renderBarChart({ values: co2, labels, tips: tips(co2, 'kg CO₂', view.series.map((d) => d.co2Kg)), unit: 'kg CO₂', name: 'CO₂ estimado por día', color: 'var(--color-info)', fmtNumber: fn })}</section></div>`;
}

function renderTabs(tab) {
  return `<div class="sw-fleet-tabs" role="group" aria-label="Agrupar por">${TABS.map((t) => `<button type="button" class="sw-fleet-tab" data-metrics-tab="${t.key}" aria-pressed="${t.key === tab}">${t.label}</button>`).join('')}</div>`;
}

const tbl = (caption, heads, body) => `<div class="sw-routes__scroll"><table class="sw-routes__table sw-fleet-table sw-metrics__table"><caption class="sw-visually-hidden">${caption}</caption><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;

function renderGroupTable(groups, label, fmt) {
  const body = groups.map((g) => {
    const none = g.source === 'sin_datos';
    const cfg = none && g.vehicleId ? ` <a class="sw-metrics__link" href="#operaciones/flota" data-metrics-config>Configurar</a>` : '';
    return `<tr><td class="sw-routes__name">${escapeHtml(g.label)}</td><td class="sw-routes__num">${g.runs}</td><td class="sw-routes__num">${fmt.km(g.km)}</td><td class="sw-routes__num">${fmt.duration(g.minutes)}</td><td class="sw-routes__num">${none ? muted() : `${fmt.number(g.liters, 2)} L`}</td><td>${sourceBadge(g.source)}${cfg}</td><td class="sw-routes__num">${none || g.co2Kg === null ? muted() : fmt.number(g.co2Kg, 2)}</td><td class="sw-routes__num">${g.co2PerKm === null ? muted() : fmt.number(g.co2PerKm, 2)}</td></tr>`;
  }).join('');
  return tbl(`Métricas ${label}`, [label, 'Corridas', 'Distancia', 'Tiempo', 'Consumo', 'Fuente del dato', 'CO₂ (kg)', 'kg CO₂ / km'], body);
}

function miniMap(trace) {
  if (!Array.isArray(trace) || trace.length < 2) return `<div class="sw-metrics__nomap">Esta corrida no tiene recorrido GPS guardado.</div>`;
  const lats = trace.map((p) => Number(p.latitude)); const lngs = trace.map((p) => Number(p.longitude));
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const span = Math.max(maxLat - minLat, maxLng - minLng, 1e-5);
  const pad = 30; const size = 400 - pad * 2;
  const pts = trace.map((p) => `${(pad + ((Number(p.longitude) - minLng) / span) * size).toFixed(1)},${(300 - pad - ((Number(p.latitude) - minLat) / span) * size).toFixed(1)}`);
  const [sx, sy] = pts[0].split(','); const [ex, ey] = pts[pts.length - 1].split(',');
  return `<svg class="sw-metrics__map" viewBox="0 0 400 300" role="img" aria-label="Recorrido medido de la corrida"><rect width="400" height="300" class="sw-metrics__map-bg"/><polyline points="${pts.join(' ')}" class="sw-metrics__trace"/><circle cx="${sx}" cy="${sy}" r="6" class="sw-metrics__pt"/><circle cx="${ex}" cy="${ey}" r="6" class="sw-metrics__pt sw-metrics__pt--end"/></svg>`;
}

function renderRuns({ view, selectedRunId, trace, fmt }) {
  const rows = view.runRows;
  const sel = rows.find((r) => r.id === selectedRunId) ?? rows[0];
  const body = rows.map((r) => `<tr class="sw-routes__row${r.id === sel?.id ? ' selected' : ''}" data-metrics-run="${escapeHtml(r.id)}" tabindex="0" aria-selected="${r.id === sel?.id}"><td class="sw-routes__num">${dateTime(r.startedAt)}</td><td class="sw-routes__name">${escapeHtml(r.routeName)}</td><td>${escapeHtml(r.vehicleLabel)}</td><td class="sw-routes__num">${fmt.km(r.distanceKm)}</td><td class="sw-routes__num">${fmt.duration(r.durationMin)}</td><td class="sw-routes__num">${r.co2Kg === null ? muted() : fmt.number(r.co2Kg, 2)}</td><td>${r.isTest ? '<span class="sw-metrics__test">Prueba</span>' : sourceBadge(r.source)}</td></tr>`).join('');
  const meta = (a, b) => `<div class="sw-metrics__meta"><span>${a}</span><b>${b}</b></div>`;
  let detail = '';
  if (sel) {
    const fuelLine = sel.liters === null ? muted('Sin datos') : `${fmt.number(sel.liters, 2)} L ${sourceBadge(sel.source)}`;
    const factor = sel.fuelType === 'gasolina' ? '2,31 kg por litro de gasolina' : '2,68 kg por litro de diésel';
    const hint = sel.source === 'real' ? `Litros registrados por el conductor al terminar la ruta. CO₂ = litros × ${factor}.` : sel.source === 'estimado' ? `Litros estimados: km medidos ÷ rendimiento configurado. CO₂ = litros × ${factor}.` : 'Sin litros registrados ni rendimiento configurado: no se calcula consumo ni CO₂.';
    detail = `<div class="sw-rutas__mini">${miniMap(trace)}</div><div class="sw-rutas__card"><h3>${escapeHtml(sel.routeName)} · ${dateTime(sel.startedAt)}</h3><p class="sw-rutas__sub">${escapeHtml(sel.driverName)} · ${escapeHtml(sel.vehicleLabel)}</p>
      <div class="sw-metrics__metagrid">${meta('Distancia', fmt.km(sel.distanceKm))}${meta('Duración', fmt.duration(sel.durationMin))}${meta('Puntos GPS', sel.gpsPoints ?? '—')}${meta('Combustible', fuelLine)}${meta('Huella de carbono', sel.co2Kg === null ? '—' : `${fmt.number(sel.co2Kg, 2)} kg CO₂`)}${meta('kg CO₂ / km', sel.co2PerKm === null ? '—' : fmt.number(sel.co2PerKm, 2))}</div>
      <p class="sw-routes__hint">${hint}</p>
      <button type="button" class="sw-rutas__btn" data-metrics-test="${escapeHtml(sel.id)}" data-metrics-test-value="${sel.isTest ? 'false' : 'true'}">${sel.isTest ? 'Quitar la marca de prueba' : 'Marcar como corrida de prueba'}</button>
      <p class="sw-routes__hint">Las corridas de prueba se guardan, pero no suman en las métricas.</p><p id="metricsRunStatus" class="sw-newroute__status" role="status"></p></div>`;
  }
  return `<div class="sw-rutas__body">${tbl('Corridas completadas', ['Inicio', 'Ruta', 'Camión', 'Distancia', 'Duración', 'CO₂ (kg)', 'Fuente'], body)}<aside class="sw-rutas__side">${detail}</aside></div>`;
}

export function renderMetricsPage({ view, period = 14, tab = 'camiones', filters = {}, options = { routes: [], vehicles: [], drivers: [] }, selectedRunId = null, trace = null, fmt, demo = false, municipalityName = '' } = {}) {
  const sub = municipalityName ? `Corridas completadas en ${escapeHtml(municipalityName)}${demo ? ' · datos de ejemplo' : ''}` : 'Corridas completadas';
  const head = `<div class="sw-rutas__head"><div><h2>Métricas</h2><p class="sw-rutas__sub">${sub}</p>${demo ? '<p class="sw-rutas__demo">Datos demo · no producción</p>' : ''}</div></div>`;
  const top = `${head}${renderFilters({ period, filters, options, view })}`;
  if (view.isEmpty) {
    return `${top}${emptyState({ title: 'Todavía no hay corridas completadas', message: 'Cuando un conductor termine una ruta con el teléfono, sus kilómetros, tiempo y huella de carbono aparecen aquí.' })}`;
  }
  const detail = tab === 'corridas' ? renderRuns({ view, selectedRunId, trace, fmt })
    : renderGroupTable(tab === 'rutas' ? view.byRoute : tab === 'conductores' ? view.byDriver : view.byVehicle, tab === 'rutas' ? 'Ruta' : tab === 'conductores' ? 'Conductor' : 'Unidad', fmt);
  return `${top}${renderKpis(view, fmt, period)}${renderNotice(view)}${renderCharts(view, fmt)}${renderTabs(tab)}${detail}`;
}

// SW-115: reportes imprimibles (PDF) de Métricas y de Impacto y Ahorros. Puro: devuelve un documento HTML completo
// que la app abre en un marco oculto y manda a imprimir ("Guardar como PDF"). Carta, con encabezado y firmas.
// Combustible en galones americanos (el modelo trabaja en litros).
import { formatNumber, formatKm, formatDuration } from './metrics-view.js';
import { reportIdentity } from './municipality-profile.js';

const GAL = 3.785411784;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TZ = 'America/Santo_Domingo';
const parts = (date) => { const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date)).split('-').map(Number); return { y, m, d }; };
export const longDate = (date) => { const p = parts(date); return `${p.d} de ${MONTHS[p.m - 1]} de ${p.y}`; };
export function periodText(days, now = new Date()) {
  const end = new Date(now); const start = new Date(now.getTime() - (days - 1) * 86400000);
  return days === 1 ? longDate(end) : `${longDate(start)} al ${longDate(end)}`;
}
const n = (v, d = 1) => formatNumber(v, d);
const gal = (liters, d = 1) => (liters === null || liters === undefined ? '—' : n(liters / GAL, d));
const time = (iso) => (iso ? new Intl.DateTimeFormat('es-DO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—');
const shortDay = (iso) => { const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1].slice(0, 3)}`; };

export const REPORT_CSS = `
@page{size:Letter;margin:.55in .6in .75in;@bottom-left{content:"SmartWaste · MT IT Services";font:7.6pt Inter,system-ui,Arial,sans-serif;color:#5a6a62}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:7.6pt Inter,system-ui,Arial,sans-serif;color:#5a6a62}}
:root{--ink:#14201b;--muted:#5a6a62;--line:#d9e2dd;--soft:#f3f7f5;--green:#0f7b4f;--green-d:#0b5c3b;--blue:#1f5f99;--amber:#a86a00;--ok-bg:#dff3e8;--blue-bg:#e3eef8;--amber-bg:#fbf1dc}
*{box-sizing:border-box}
body{margin:0;font:9.6pt/1.45 Inter,system-ui,"Segoe UI",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
header.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid var(--green);padding-bottom:12px;margin-bottom:16px}
.brand{display:flex;gap:12px;align-items:center}
.mark{width:40px;height:40px;border-radius:9px;background:var(--green);color:#fff;font-weight:800;font-size:15pt;display:grid;place-items:center}
.brand small{display:block;color:var(--muted);font-size:8pt;letter-spacing:.08em;text-transform:uppercase}.brand b{font-size:11pt}
.meta{text-align:right;color:var(--muted);font-size:8.4pt;line-height:1.5}.meta b{color:var(--ink)}
h1{font-size:20pt;line-height:1.15;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 14px;font-size:10pt;max-width:6.2in}
h2{font-size:11.5pt;margin:18px 0 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;break-after:avoid}
.pill{font-size:7.4pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:99px;padding:2px 9px}
.p-med{background:var(--ok-bg);color:var(--green-d)}.p-proy{background:var(--blue-bg);color:var(--blue)}.p-pot{background:var(--amber-bg);color:var(--amber)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kpis.four{grid-template-columns:repeat(4,1fr)}
.kpi{border:1px solid var(--line);border-radius:8px;padding:9px 11px;background:var(--soft);break-inside:avoid}
.kpi .l{font-size:7.8pt;color:var(--muted)}.kpi .v{font-size:17pt;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.kpi .v small{font-size:8.5pt;color:var(--muted);font-weight:500}.kpi .n{font-size:7.6pt;color:var(--muted)}
.hero{display:grid;grid-template-columns:1.25fr 1fr;gap:12px;margin-bottom:6px;break-inside:avoid}
.big{background:var(--green);color:#fff;border-radius:10px;padding:14px 16px}.big.amber{background:var(--amber)}
.big .l{font-size:8.4pt;opacity:.9}.big .v{font-size:26pt;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}.big .n{font-size:8.4pt;opacity:.9}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:8.8pt}
th{font-size:7.6pt;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:5px 8px;border-bottom:1.5px solid var(--ink)}
td{padding:5px 8px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}tr{break-inside:avoid}
tfoot td{font-weight:700;border-top:1.5px solid var(--ink);border-bottom:0}
.tag{font-size:7.4pt;border-radius:5px;padding:1px 6px;background:var(--ok-bg);color:var(--green-d)}.tag.none{background:var(--soft);color:var(--muted);border:1px solid var(--line)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.box{border:1px solid var(--line);border-radius:8px;padding:11px 13px;break-inside:avoid}.box h3{font-size:9.4pt;margin:0 0 6px}
.note{font-size:8.2pt;color:var(--muted);margin:6px 0 0}
.callout{border-left:3px solid var(--amber);background:var(--amber-bg);border-radius:0 8px 8px 0;padding:8px 12px;font-size:8.8pt;margin:10px 0;break-inside:avoid}
.callout.blue{border-color:var(--blue);background:var(--blue-bg)}
.pend{border:1px dashed var(--line);border-radius:8px;padding:9px 12px;color:var(--muted);font-size:8.8pt;margin-top:8px;break-inside:avoid}.pend b{color:var(--ink)}
ul{margin:4px 0 0;padding-left:16px}li{margin-bottom:3px}
.sign{display:grid;grid-template-columns:repeat(auto-fit,minmax(1.6in,1fr));gap:40px;margin-top:34px;break-inside:avoid}.sign div{border-top:1px solid var(--ink);padding-top:4px;font-size:8.2pt;color:var(--muted)}.sign b{display:block;color:var(--ink);font-size:9pt}
.logo{width:40px;height:40px;object-fit:contain}.contact{margin-top:22px;border-top:1px solid var(--line);padding-top:6px;font-size:8pt;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 14px}
`;

function frame({ title, subtitle, tag, municipality, profile, period, now, body, name, defaultSigners = [] }) {
  const id = reportIdentity(profile, municipality);
  const mark = id.logo ? `<img class="logo" alt="" src="${esc(id.logo)}">` : '<div class="mark">SW</div>';
  const signers = id.signers.length ? id.signers.map((s) => `<div><b>${esc(s.name)}</b>${esc(s.role)}</div>`).join('') : defaultSigners.map((l) => `<div>${esc(l)}</div>`).join('');
  const contact = id.contact.length ? `<div class="contact">${id.contact.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(name)}</title><style>${REPORT_CSS}</style></head><body>
<header class="top"><div class="brand">${mark}<div><small>SmartWaste · Gestión de residuos</small><b>${esc(id.name)}</b></div></div>
<div class="meta">Periodo: <b>${esc(period)}</b><br>Emitido: <b>${esc(longDate(now))}</b><br>Reporte: <b>${esc(tag)}</b></div></header>
<h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${body}<div class="sign">${signers}</div>${contact}</body></html>`;
}
const kpi = (l, v, u = '', note = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}${u ? ` <small>${u}</small>` : ''}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
const fileName = (prefix, now) => { const p = parts(now); return `SmartWaste-${prefix}-${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

function bars(series, w = 560, h = 80) {
  const vals = series.map((d) => d.km); const mx = Math.max(...vals, 0) || 1; const bw = (w - 10) / vals.length;
  let out = `<svg viewBox="0 0 ${w} ${h + 16}" width="100%" role="img" aria-label="Kilómetros por día">`;
  for (const g of [0, .5, 1]) { const y = h - g * (h - 8); out += `<line x1="0" x2="${w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#d9e2dd" stroke-width=".6"/>`; }
  vals.forEach((v, i) => { const bh = v ? (h - 8) * v / mx : 2; out += `<rect x="${(5 + i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${v ? '#0f7b4f' : '#d9e2dd'}"/>`; });
  out += `<text x="0" y="${h + 12}" font-size="7" fill="#5a6a62">${esc(shortDay(`${series[0].day}T12:00:00Z`))}</text><text x="${w}" y="${h + 12}" font-size="7" fill="#5a6a62" text-anchor="end">${esc(shortDay(`${series[series.length - 1].day}T12:00:00Z`))}</text></svg>`;
  return out;
}

// ---------------- Métricas ----------------
export function renderMetricsReport({ view, period = 14, municipalityName = '', profile = null, rawRuns = [], now = new Date() } = {}) {
  const s = view.summary; const hours = s.totalMinutes / 60;
  const avgSpeed = hours > 0 ? s.totalKm / hours : null;
  const cover = `${view.byVehicle.filter((g) => g.source !== 'sin_datos').length} de ${view.byVehicle.length} camiones con rendimiento`;
  const kpis = `<div class="kpis">${kpi('Corridas completadas', s.runCount, '', `${view.series.filter((d) => d.runCount).length} días con actividad`)}${kpi('Distancia recorrida', n(s.totalKm, 1), 'km', 'medida por GPS')}${kpi('Tiempo en operación', n(hours, 1), 'h', 'inicio a fin de corrida')}${kpi('Velocidad media', avgSpeed === null ? '—' : n(avgSpeed, 1), 'km/h', 'incluye paradas de recogida')}${kpi('Combustible estimado', s.liters === null ? '—' : gal(s.liters), s.liters === null ? '' : 'gal', s.liters === null ? 'falta el rendimiento de los camiones' : 'km ÷ rendimiento del camión')}${kpi('CO₂ estimado', s.co2Kg === null ? '—' : n(s.co2Kg, 0), s.co2Kg === null ? '' : 'kg', cover)}</div>`;
  const chart = view.series.some((d) => d.km) ? `<h2>Kilómetros por día</h2><div class="box">${bars(view.series)}<p class="note">Los días sin barra no tuvieron corridas completadas.</p></div>` : '';
  const groupRows = (groups, withEff) => groups.map((g) => {
    const eff = withEff && g.liters ? n((g.km / g.liters) * GAL, 1) : '—';
    return `<tr><td>${esc(g.label)}</td><td>${g.runs}</td><td>${n(g.km, 1)}</td><td>${n(g.minutes / 60, 1)}</td><td>${g.km > 0 ? n(g.km / (g.minutes / 60 || NaN), 1) : '—'}</td><td>${gal(g.liters)}</td>${withEff ? `<td>${eff}</td>` : ''}<td><span class="tag${g.source === 'sin_datos' ? ' none' : ''}">${g.source === 'sin_datos' ? 'sin rendimiento' : 'por rendimiento'}</span></td></tr>`;
  }).join('');
  const table = (title, groups, label, withEff) => groups.length ? `<h2>${title}</h2><table><thead><tr><th>${label}</th><th>Corridas</th><th>Km</th><th>Horas</th><th>Km/h</th><th>Galones</th>${withEff ? '<th>Km/gal</th>' : ''}<th>Fuente</th></tr></thead><tbody>${groupRows(groups, withEff)}</tbody><tfoot><tr><td>Total</td><td>${s.runCount}</td><td>${n(s.totalKm, 1)}</td><td>${n(hours, 1)}</td><td>${avgSpeed === null ? '—' : n(avgSpeed, 1)}</td><td>${s.liters === null ? '—' : gal(s.liters)}</td>${withEff ? '<td></td>' : ''}<td></td></tr></tfoot></table>` : '';
  const recent = view.runRows.slice(0, 10).map((r) => `<tr><td>${esc(shortDay(r.startedAt))}</td><td>${esc(r.routeName)}</td><td>${esc(r.vehicleLabel)}</td><td>${esc(time(r.startedAt))}</td><td>${r.durationMin === null ? '—' : esc(formatDuration(r.durationMin))}</td><td>${r.distanceKm === null ? '—' : n(r.distanceKm, 1)}</td><td>${gal(r.liters)}</td></tr>`).join('');
  // Puntualidad de salida: solo con corridas que tienen horario programado.
  const byId = new Map(rawRuns.map((r) => [r.id, r]));
  const timed = view.runRows.map((r) => byId.get(r.id)).filter((r) => r?.scheduled_start_at && r?.started_at);
  const onTime = timed.filter((r) => new Date(r.started_at) - new Date(r.scheduled_start_at) <= 10 * 60000).length;
  const punctuality = timed.length ? `<div class="box"><h3>Puntualidad de salida</h3><div class="kpi" style="border:0;background:none;padding:0"><div class="v">${Math.round((onTime / timed.length) * 100)}% <small>a tiempo</small></div></div><p class="note">${onTime} de ${timed.length} corridas con horario programado salieron dentro de 10 minutos.</p></div>` : '';
  const missing = view.missingConfig.length ? `<li>Sin rendimiento configurado: ${esc(view.missingConfig.map((m) => m.label).join(', '))}. Esos camiones no suman combustible ni CO₂.</li>` : '';
  const logged = s.loggedLiters ? `<li>Control: los conductores anotaron ${gal(s.loggedLiters)} gal cargados frente a ${s.liters ? gal(s.liters) : '—'} gal estimados${s.liters ? ` (${s.loggedLiters >= s.liters ? '+' : '−'}${n(Math.abs((s.loggedLiters - s.liters) / s.liters) * 100, 0)}%)` : ''}. No entra en el cálculo.</li>` : '';
  const quality = `<h2>Calidad de los datos</h2><div class="box"><ul><li>${s.runCount} corridas completadas incluidas. Las corridas marcadas como prueba no se cuentan${view.excludedTests ? ` (${view.excludedTests} excluidas)` : ''}.</li><li>Combustible: siempre estimado con km medidos ÷ rendimiento configurado de cada camión.</li><li>Distancia: se mide en metros con el GPS del teléfono y se descarta el movimiento menor al error del GPS, para que un camión detenido no sume kilómetros.</li>${missing}${logged}</ul></div>`;
  const body = `<h2 style="margin-top:0">Resumen del periodo</h2>${kpis}${chart}${table('Por ruta', view.byRoute, 'Ruta', false)}${table('Por camión', view.byVehicle, 'Camión', true)}${recent ? `<h2>Corridas más recientes</h2><table><thead><tr><th>Fecha</th><th>Ruta</th><th>Camión</th><th>Inicio</th><th>Duración</th><th>Km</th><th>Galones</th></tr></thead><tbody>${recent}</tbody></table>` : ''}${punctuality ? `<div style="margin-top:12px">${punctuality}</div>` : ''}${quality}`;
  return frame({ title: 'Reporte de Métricas operativas', subtitle: 'Qué pasó en la calle: cada corrida, camión y ruta, medido con el GPS del teléfono. Sirve para supervisar la operación y corregirla.', tag: 'Métricas', municipality: municipalityName, profile, period: periodText(period, now), now, body, name: fileName('Reporte-Metricas', now), defaultSigners: ['Supervisor de operaciones', 'Director de higiene municipal'] });
}

// ---------------- Impacto y Ahorros ----------------
export function renderImpactReport({ model, period = 30, municipalityName = '', profile = null, priceConfigured = false, now = new Date() } = {}) {
  const m = model.measured; const p = model.projection; const q = model.potential; const price = model.fuelPrice;
  const money = (v) => (v === null || v === undefined ? '—' : `RD$ ${formatNumber(v, 0)}`);
  const perGal = price ? `RD$ ${formatNumber(price * GAL, 0)} por galón` : '';
  const hero = `<div class="hero"><div class="big"><div class="l">Costo de combustible del periodo (medido)</div><div class="v">${money(m.fuelCost)}</div><div class="n">${m.liters === null ? 'falta el rendimiento de los camiones' : `${gal(m.liters)} galones × ${perGal} · ${m.runs} corridas`}</div></div>
  <div class="big amber"><div class="l">Ahorro potencial al mes (estimado)</div><div class="v">${q && q.fuelCost !== null ? money(q.fuelCost) : '—'}</div><div class="n">${q ? `reordenando paradas · ${n(q.km, 1)} km menos` : 'pendiente de datos'}</div></div></div>`;
  const measured = `<h2>Lo que ya ocurrió <span class="pill p-med">Medido</span></h2><div class="kpis four">${kpi('Distancia', n(m.km, 1), 'km')}${kpi('Combustible estimado', m.liters === null ? '—' : gal(m.liters), m.liters === null ? '' : 'gal')}${kpi('Costo', m.fuelCost === null ? '—' : formatNumber(m.fuelCost, 0), m.fuelCost === null ? '' : 'RD$')}${kpi('CO₂ emitido', m.co2Kg === null ? '—' : n(m.co2Kg, 0), m.co2Kg === null ? '' : 'kg')}</div><p class="note">Base: ${m.runs} corridas en ${m.activeDays} días con actividad. Combustible: km medidos ÷ rendimiento configurado de cada camión.${m.loggedLiters ? ` Control: los conductores anotaron ${gal(m.loggedLiters)} gal cargados; no entra en el costo.` : ''}${m.runsWithoutFuel ? ` ${m.runsWithoutFuel} corridas son de camiones sin rendimiento configurado.` : ''}</p>`;
  const projected = `<h2>Proyección mensual <span class="pill p-proy">Proyectado</span></h2>${p ? `<div class="kpis four">${kpi('Distancia al mes', n(p.km, 0), 'km')}${kpi('Combustible al mes', p.liters === null ? '—' : gal(p.liters, 0), p.liters === null ? '' : 'gal')}${kpi('Costo al mes', p.fuelCost === null ? '—' : formatNumber(p.fuelCost, 0), p.fuelCost === null ? '' : 'RD$')}${kpi('CO₂ al mes', p.co2Kg === null ? '—' : n(p.co2Kg, 0), p.co2Kg === null ? '' : 'kg')}</div><p class="note">Promedio de los ${p.basis.activeDays} días con corridas × ${p.basis.operatingDays} días operativos al mes. Se recalcula con cada corrida completada.</p>` : `<div class="pend"><b>Aún no hay datos suficientes para proyectar.</b> Se activa con 3 días con corridas completadas en el periodo. Hoy hay ${m.activeDays}.</div>`}`;
  const potential = `<h2>Ahorro que se puede lograr <span class="pill p-pot">Potencial</span></h2>${q ? `<div class="kpis four">${kpi('Distancia evitable', n(q.km, 1), 'km/mes', `${n(q.percent, 1)}% del recorrido`)}${kpi('Combustible', q.liters === null ? '—' : gal(q.liters), q.liters === null ? '' : 'gal/mes', q.kmPerLiter ? `a ${n(q.kmPerLiter * GAL, 1)} km por galón` : '')}${kpi('Ahorro', q.fuelCost === null ? '—' : formatNumber(q.fuelCost, 0), q.fuelCost === null ? '' : 'RD$/mes')}${kpi('CO₂ evitado', q.co2Kg === null ? '—' : n(q.co2Kg, 1), q.co2Kg === null ? '' : 'kg/mes')}</div><p class="note">Diferencia entre el orden actual de paradas y el orden óptimo en ${q.routesCompared} ${q.routesCompared === 1 ? 'ruta' : 'rutas'} con 3 paradas o más. Es una estimación para decidir si conviene reordenar, no un ahorro ya logrado.</p>` : `<div class="pend"><b>Pendiente de datos.</b> Para comparar el orden real contra el óptimo se necesitan al menos 3 días de corridas y rutas con 3 paradas o más.</div>`}<div class="pend"><b>Ahorro contra el método anterior: pendiente.</b> Se activa cuando el ayuntamiento registre cuántos km y horas diarias hacían antes de SmartWaste.</div>`;
  const routeRows = model.perRoute.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.runs}</td><td>${n(r.km, 1)}</td><td>${gal(r.liters)}</td><td>${r.fuelCost === null ? '—' : formatNumber(r.fuelCost, 0)}</td><td>${r.fuelCost !== null && r.km > 0 ? n(r.fuelCost / r.km, 1) : '—'}</td></tr>`).join('');
  const totalPerKm = m.fuelCost !== null && m.km > 0 ? n(m.fuelCost / m.km, 1) : '—';
  const routes = model.perRoute.length ? `<h2>Costo por ruta</h2><table><thead><tr><th>Ruta</th><th>Corridas</th><th>Km</th><th>Galones</th><th>Costo RD$</th><th>RD$ por km</th></tr></thead><tbody>${routeRows}</tbody><tfoot><tr><td>Total</td><td>${m.runs}</td><td>${n(m.km, 1)}</td><td>${m.liters === null ? '—' : gal(m.liters)}</td><td>${m.fuelCost === null ? '—' : formatNumber(m.fuelCost, 0)}</td><td>${totalPerKm}</td></tr></tfoot></table>` : '';
  const compare = p ? `<h2>Del periodo a la proyección</h2><table><thead><tr><th>Concepto</th><th>Medido (${period} días)</th><th>Proyectado (mes)</th><th>Potencial (ahorro al mes)</th></tr></thead><tbody><tr><td>Distancia</td><td>${n(m.km, 0)} km</td><td>${n(p.km, 0)} km</td><td>${q ? `${n(q.km, 1)} km` : '—'}</td></tr><tr><td>Combustible</td><td>${m.liters === null ? '—' : `${gal(m.liters)} gal`}</td><td>${p.liters === null ? '—' : `${gal(p.liters, 0)} gal`}</td><td>${q && q.liters !== null ? `${gal(q.liters)} gal` : '—'}</td></tr><tr><td>Costo</td><td>${money(m.fuelCost)}</td><td>${money(p.fuelCost)}</td><td>${money(q?.fuelCost ?? null)}</td></tr><tr><td>CO₂</td><td>${m.co2Kg === null ? '—' : `${n(m.co2Kg, 0)} kg`}</td><td>${p.co2Kg === null ? '—' : `${n(p.co2Kg, 0)} kg`}</td><td>${q && q.co2Kg !== null ? `${n(q.co2Kg, 1)} kg` : '—'}</td></tr></tbody></table>` : '';
  const how = `<h2>Cómo leer este reporte</h2><div class="cols"><div class="box"><h3>Qué es cada bloque</h3><ul><li><b>Medido:</b> lo que ya ocurrió, corrida por corrida.</li><li><b>Proyectado:</b> lo que ocurrirá en un mes típico si se mantiene el ritmo.</li><li><b>Potencial:</b> lo que se podría ahorrar con rutas mejor ordenadas.</li></ul></div><div class="box"><h3>Qué cuenta y qué no</h3><ul><li>Solo corridas completadas y reales; las de prueba no cuentan.</li><li>Lo que no se puede calcular se muestra como pendiente, nunca como un número inventado.</li><li>El combustible se estima con el rendimiento de cada camión (km por galón); el precio por galón se configura en Parámetros de costo.</li></ul></div></div>${priceConfigured ? '' : '<div class="callout">El precio del combustible usado es un valor de referencia. Configúralo en Parámetros de costo para que los pesos sean exactos.</div>'}`;
  const body = `${hero}${measured}${projected}${potential}${routes}${compare}${how}`;
  return frame({ title: 'Reporte de Impacto y Ahorros', subtitle: 'Cuánto cuesta, cuánto contamina y cuánto se puede ahorrar. Convierte las corridas en cifras para decidir presupuesto, combustible y cambios de ruta.', tag: 'Impacto y Ahorros', municipality: municipalityName, profile, period: periodText(period, now), now, body, name: fileName('Reporte-Impacto-y-Ahorros', now), defaultSigners: ['Alcalde o administrador municipal', 'Director financiero'] });
}

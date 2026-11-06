// SW-113: pantalla Impacto y Ahorros (solo datos reales). HTML puro; app.js le pasa el modelo de shared/impact-real.js y `fmt`.
import { escapeHtml } from './button.js';

const PERIODS = [{ days: 7, label: '7 días' }, { days: 14, label: '14 días' }, { days: 30, label: '30 días' }, { days: 90, label: 'Trimestre' }];
const SRC = { estimado: 'por rendimiento', parcial: 'parcial', sin_datos: 'sin rendimiento' };
const GAL = 3.785411784; // el combustible se muestra en galones americanos; el modelo trabaja en litros
const NIL = '<span class="sw-metrics__muted">—</span>';

const card = (label, value, unit = '', note = '') => `<div class="sw-impact__kpi"><span class="sw-impact__label">${label}</span><b>${value}${unit ? ` <small>${unit}</small>` : ''}</b>${note ? `<span class="sw-impact__note">${note}</span>` : ''}</div>`;
const block = (title, pill, cls, body) => `<section class="sw-impact__block"><div class="sw-impact__head"><h3>${title}</h3><span class="sw-impact__pill sw-impact__pill--${cls}">${pill}</span></div>${body}</section>`;
const pending = (title, text, needs) => `<div class="sw-impact__empty"><b>${title}</b> ${text}<div class="sw-impact__needs">${needs.map((n) => `<span>${n}</span>`).join('')}</div></div>`;

function spark(series, fmt) {
  const max = Math.max(...series.map((d) => d.km), 0);
  if (!max) return '';
  const bars = series.map((d) => `<i class="${d.km ? '' : 'is-empty'}" style="height:${d.km ? Math.max(12, (d.km / max) * 100) : 6}%" title="${d.day}: ${fmt.number(d.km, 1)} km"></i>`).join('');
  return `<div class="sw-impact__spark" role="img" aria-label="Kilómetros por día en los últimos ${series.length} días">${bars}</div><p class="sw-impact__basis">Kilómetros por día en los últimos ${series.length} días. Los días sin barra no tuvieron corridas completadas.</p>`;
}

export function renderImpactReal({ model, period = 30, fmt, priceConfigured = false }) {
  const m = model.measured; const n = fmt.number;
  const g = (liters) => (liters === null || liters === undefined ? null : liters / GAL);
  const chips = PERIODS.map((p) => `<button type="button" class="sw-chip" data-impact-period="${p.days}" aria-pressed="${p.days === period}">${p.label}</button>`).join('');
  const price = model.fuelPrice;
  const priceNote = priceConfigured ? '' : '<p class="sw-metrics__notice">El precio del combustible es un valor de referencia. Configúralo en Configuración · Parámetros de costo para que los pesos sean exactos.</p>';
  const head = `<div class="sw-impact__top"><div><p class="eyebrow">Impacto y Ahorros</p><h2>Lo que dicen las corridas</h2></div><div class="sw-impact__actions"><div class="sw-metrics__chips" role="group" aria-label="Periodo">${chips}</div>${m.runs ? '<button type="button" class="sw-rutas__btn" data-report-download="impacto">Descargar reporte PDF</button>' : ''}</div></div>`;
  const basis = `<p class="sw-impact__state">Base de cálculo: ${m.runs} ${m.runs === 1 ? 'corrida' : 'corridas'} en ${m.activeDays} ${m.activeDays === 1 ? 'día' : 'días'} con actividad.</p>`;
  if (!m.runs) {
    return `${head}${basis}${pending('Aún no hay corridas completadas en este periodo.', 'Cuando un conductor termine una corrida real, aquí aparecerán la distancia, el combustible, el costo y el CO₂.', ['Corridas completadas', 'Que no estén marcadas como prueba'])}`;
  }
  const measured = block('Lo que ya ocurrió', 'Medido', 'med',
    `<div class="sw-impact__grid">${[
      card('Corridas completadas', m.runs, '', `${m.activeDays} días con actividad`),
      card('Distancia recorrida', n(m.km, 1), 'km', 'medida por GPS'),
      card('Horas de operación', n(m.hours, 1), 'h', 'de inicio a fin de corrida'),
      card('Combustible estimado', m.liters === null ? NIL : n(g(m.liters), 1), m.liters === null ? '' : 'gal', m.liters === null ? 'falta el rendimiento de los camiones' : 'km ÷ rendimiento de cada camión'),
      card('Costo de combustible', m.fuelCost === null ? NIL : `RD$ ${n(m.fuelCost, 0)}`, '', m.fuelCost === null ? 'pendiente de datos' : `galones × RD$ ${n(price * GAL, 0)} por galón`),
      card('CO₂ emitido', m.co2Kg === null ? NIL : n(m.co2Kg, 0), m.co2Kg === null ? '' : 'kg', 'según el tipo de combustible')
    ].join('')}</div>${spark(model.series, fmt)}${m.runsWithoutFuel ? `<p class="sw-impact__basis">${m.runsWithoutFuel} ${m.runsWithoutFuel === 1 ? 'corrida es de un camión' : 'corridas son de camiones'} sin rendimiento configurado; no suman al combustible. Configúralo en Flota.</p>` : ''}${m.loggedLiters ? `<p class="sw-impact__basis">Control: los conductores anotaron ${n(g(m.loggedLiters), 1)} gal cargados${m.liters ? ` frente a ${n(g(m.liters), 1)} gal estimados (${(m.loggedLiters - m.liters) >= 0 ? '+' : '−'}${n(Math.abs((m.loggedLiters - m.liters) / m.liters) * 100, 0)}%)` : ''}. No entra en el costo.</p>` : ''}`);

  const p = model.projection;
  const projected = block('Proyección mensual', 'Proyectado', 'proy', p
    ? `<div class="sw-impact__grid">${[
      card('Distancia al mes', n(p.km, 0), 'km'), card('Horas al mes', n(p.hours, 1), 'h'),
      card('Combustible al mes', p.liters === null ? NIL : n(g(p.liters), 0), p.liters === null ? '' : 'gal'),
      card('Costo al mes', p.fuelCost === null ? NIL : `RD$ ${n(p.fuelCost, 0)}`),
      card('CO₂ al mes', p.co2Kg === null ? NIL : n(p.co2Kg, 0), p.co2Kg === null ? '' : 'kg')
    ].join('')}</div><p class="sw-impact__basis">Promedio de ${p.basis.activeDays} días con corridas × ${p.basis.operatingDays} días operativos al mes. Se recalcula con cada corrida completada.</p>`
    : pending('Aún no hay datos suficientes para proyectar.', `Se activa con 3 días con corridas completadas en el periodo. Hoy hay ${m.activeDays}.`, ['Corridas reales, no de prueba', 'Mínimo 3 días con actividad']));

  const q = model.potential;
  const potential = block('Ahorro que se puede lograr', 'Potencial', 'pot', (q
    ? `<div class="sw-impact__grid">${[
      card('Distancia evitable', n(q.km, 1), 'km al mes', `${n(q.percent, 1)}% del recorrido de ${q.routesCompared} ${q.routesCompared === 1 ? 'ruta' : 'rutas'}`),
      card('Combustible', q.liters === null ? NIL : n(g(q.liters), 1), q.liters === null ? '' : 'gal al mes', q.kmPerLiter ? `a ${n(q.kmPerLiter * GAL, 1)} km por galón` : 'falta el rendimiento de los camiones'),
      card('Ahorro en combustible', q.fuelCost === null ? NIL : `RD$ ${n(q.fuelCost, 0)}`, 'al mes'),
      card('CO₂ evitado', q.co2Kg === null ? NIL : n(q.co2Kg, 1), q.co2Kg === null ? '' : 'kg al mes')
    ].join('')}</div><p class="sw-impact__basis">Diferencia entre el orden actual de paradas y el orden óptimo, en rutas con 3 paradas o más. Es una estimación para decidir si conviene reordenar, no un ahorro ya logrado.</p>`
    : pending('Pendiente de datos.', 'Para comparar el orden real contra el óptimo se necesitan al menos 3 días de corridas y rutas con 3 paradas o más.', ['Paradas con coordenadas', 'Corridas completadas']))
    + pending('Ahorro contra el método anterior:', 'pendiente. Se activa cuando el ayuntamiento registre sus km y horas diarias de antes de SmartWaste.', ['Km diarios antes', 'Horas diarias antes']));

  const rows = model.perRoute.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${r.runs}</td><td>${n(r.km, 1)}</td><td>${n(r.hours, 1)}</td><td>${r.liters === null ? NIL : n(g(r.liters), 1)}</td><td>${r.fuelCost === null ? NIL : n(r.fuelCost, 0)}</td><td><span class="sw-impact__src">${SRC[r.source] ?? SRC.sin_datos}</span></td></tr>`).join('');
  const routes = `<section class="sw-impact__block"><div class="sw-impact__head"><h3>Detalle por ruta</h3><span class="sw-metrics__muted">${model.perRoute.length} ${model.perRoute.length === 1 ? 'ruta con corridas' : 'rutas con corridas'}</span></div><div class="sw-impact__scroll"><table class="sw-impact__table"><thead><tr><th>Ruta</th><th>Corridas</th><th>Km</th><th>Horas</th><th>Galones</th><th>Costo RD$</th><th>Consumo</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  const notes = `<section class="sw-impact__block"><h3>Cómo se calcula</h3><ul class="sw-impact__notes"><li><b>Medido:</b> suma de corridas completadas del periodo. Combustible estimado: km medidos ÷ rendimiento configurado de cada camión. Lo que el conductor anota al cargar solo sirve de control.</li><li><b>Proyectado:</b> promedio por día con corridas × días operativos al mes. Solo aparece con 3 o más días con corridas.</li><li><b>Potencial:</b> compara el orden real de paradas con el óptimo y lo convierte a galones, pesos y CO₂.</li><li><b>Sin cifras inventadas:</b> lo que falta se muestra como pendiente. Las corridas marcadas como prueba no cuentan.</li></ul></section>`;
  return `${head}${priceNote}${basis}${measured}${projected}${potential}${routes}${notes}`;
}

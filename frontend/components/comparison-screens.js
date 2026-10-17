// SW-091: pestaña "Comparar" de Métricas: periodo contra periodo anterior, desvíos y camiones en la misma ruta.
// HTML puro. No importa de ../shared: recibe el modelo (buildComparison) y `fmt` desde Métricas.
import { escapeHtml } from './button.js';
import { emptyState } from './empty-state.js';

const METRIC_LABELS = { duracion: 'Duración', distancia: 'Distancia', co2: 'CO₂' };
const muted = (t = '—') => `<span class="sw-metrics__muted">${t}</span>`;
const pct = (n) => (n === null || n === undefined ? null : `${n > 0 ? '+' : n < 0 ? '−' : ''}${String(Math.abs(n)).replace('.', ',')} %`);
const dateTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('.', '');
};

// Para tiempo, consumo y CO₂ bajar es mejor; para corridas y distancia el cambio es neutro.
function delta(value, betterWhenLower) {
  const text = pct(value);
  if (text === null) return muted('sin periodo anterior');
  const tone = !betterWhenLower || value === 0 ? 'neutral' : value < 0 ? 'good' : 'bad';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '■';
  return `<span class="sw-compare__delta sw-compare__delta--${tone}"><span aria-hidden="true">${arrow}</span> ${text}</span>`;
}

function renderPeriod(cmp, fmt) {
  const { current: c, previous: p, deltas: d } = cmp.periodVsPrevious;
  const num = (v, digits = 2, unit = '') => (v === null || v === undefined ? muted('Sin datos') : `${fmt.number(v, digits)}${unit}`);
  const rows = [
    ['Corridas', String(c.runCount), String(p.runCount), d.runCount, false],
    ['Distancia', fmt.km(c.km), fmt.km(p.km), d.km, false],
    ['Tiempo en ruta', fmt.duration(c.minutes), fmt.duration(p.minutes), d.minutes, true],
    ['Consumo', num(c.liters, 2, ' L'), num(p.liters, 2, ' L'), d.liters, true],
    ['Huella de carbono', num(c.co2Kg, 2, ' kg'), num(p.co2Kg, 2, ' kg'), d.co2Kg, true]
  ].map(([l, cur, prev, dl, lower]) => `<tr><td class="sw-routes__name">${l}</td><td class="sw-routes__num">${cur}</td><td class="sw-routes__num">${prev}</td><td>${delta(dl, lower)}</td></tr>`).join('');
  return `<section class="sw-rutas__card"><h3>Este periodo contra el anterior</h3><div class="sw-routes__scroll"><table class="sw-routes__table sw-fleet-table sw-metrics__table"><caption class="sw-visually-hidden">Periodo contra periodo anterior</caption><thead><tr><th scope="col">Indicador</th><th scope="col">Este periodo</th><th scope="col">Periodo anterior</th><th scope="col">Cambio</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderDeviations(cmp, fmt) {
  const unit = (metric, v) => (metric === 'duracion' ? fmt.duration(v) : metric === 'distancia' ? fmt.km(v) : `${fmt.number(v, 2)} kg`);
  const body = cmp.deviations.map((dv) => {
    const chips = dv.flags.map((f) => `<span class="sw-compare__flag"><b>${METRIC_LABELS[f.metric]} ${pct(f.deltaPct)}</b> <small>${unit(f.metric, f.value)} contra ${unit(f.metric, f.baseline)} típicos</small></span>`).join(' ');
    return `<tr><td class="sw-routes__num">${dateTime(dv.startedAt)}</td><td class="sw-routes__name">${escapeHtml(dv.routeName)}</td><td>${escapeHtml(dv.vehicleLabel)}</td><td class="sw-compare__flags">${chips}</td><td><button type="button" class="sw-rutas__btn" data-metrics-goto-run="${escapeHtml(dv.runId)}">Ver corrida</button></td></tr>`;
  }).join('');
  const table = cmp.deviations.length
    ? `<div class="sw-routes__scroll"><table class="sw-routes__table sw-fleet-table sw-metrics__table"><caption class="sw-visually-hidden">Desvíos</caption><thead><tr><th scope="col">Inicio</th><th scope="col">Ruta</th><th scope="col">Camión</th><th scope="col">Qué se desvió</th><th scope="col"><span class="sw-visually-hidden">Acción</span></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="sw-routes__hint">Ninguna corrida se desvió de lo habitual en este periodo.</p>`;
  const base = cmp.withoutBase ? ` ${cmp.withoutBase} ${cmp.withoutBase === 1 ? 'ruta sin corridas previas suficientes' : 'rutas sin corridas previas suficientes'} para comparar.` : '';
  return `<section class="sw-rutas__card"><h3>Desvíos</h3>${table}<p class="sw-routes__hint">Cada corrida se compara con la mediana de las corridas anteriores de su ruta (mínimo 3 corridas, hasta 90 días atrás). Se marca si la duración sube más de 20 %, la distancia cambia más de 15 % o el CO₂ sube más de 25 %.${base}</p></section>`;
}

function renderTrucks(cmp) {
  const cell = (v, d = 2) => (v === null ? muted('Sin datos') : String(v).replace('.', ','));
  const groups = cmp.trucksOnRoute.map((g) => {
    const rows = g.trucks.map((t) => {
      const best = t.vehicleId === g.bestVehicleId ? ' <span class="sw-compare__best">Mejor</span>' : '';
      return `<tr><td class="sw-routes__name">${escapeHtml(t.label)}${best}</td><td class="sw-routes__num">${t.runs}</td><td class="sw-routes__num">${cell(t.minPerKm)}</td><td class="sw-routes__num">${cell(t.kmPerL)}</td><td class="sw-routes__num">${cell(t.co2PerKm)}</td></tr>`;
    }).join('');
    const why = g.bestBy === 'co2PerKm' ? 'menor CO₂ por km' : g.bestBy === 'minPerKm' ? 'menos minutos por km' : '';
    return `<div class="sw-compare__route"><h4>${escapeHtml(g.routeName)}${why ? ` <small>· mejor por ${why}</small>` : ''}</h4><div class="sw-routes__scroll"><table class="sw-routes__table sw-fleet-table sw-metrics__table"><caption class="sw-visually-hidden">Camiones en ${escapeHtml(g.routeName)}</caption><thead><tr><th scope="col">Camión</th><th scope="col">Corridas</th><th scope="col">min / km</th><th scope="col">km / L</th><th scope="col">kg CO₂ / km</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  const inner = groups || `<p class="sw-routes__hint">Todavía no hay dos camiones con al menos 2 corridas en la misma ruta.</p>`;
  return `<section class="sw-rutas__card"><h3>Camiones en la misma ruta</h3>${inner}</section>`;
}

export function renderComparison({ comparison, fmt }) {
  if (comparison.isEmpty) return emptyState({ title: 'Todavía no hay corridas para comparar', message: 'Cuando haya corridas completadas en este periodo, aquí se comparan contra el periodo anterior y contra lo habitual de cada ruta.' });
  return `<div class="sw-compare">${renderPeriod(comparison, fmt)}${renderDeviations(comparison, fmt)}${renderTrucks(comparison)}</div>`;
}

// SW-092: pestaña "Resumen" de Métricas: resumen de los últimos 7 días y recomendaciones. HTML puro.
import { escapeHtml } from './button.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SEVERITY = { atencion: ['▲', 'Atención'], info: ['●', 'Información'], ok: ['✔', 'Bien'] };
const day = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : '—');

function action(a) {
  if (!a) return '';
  if (a.kind === 'flota') return '<a class="sw-rutas__btn" href="#operaciones/flota" data-metrics-config>Ir a Flotilla</a>';
  if (a.kind === 'comparar') return '<button type="button" class="sw-rutas__btn" data-metrics-tab="comparar">Ver comparación</button>';
  return '';
}

export function renderWeeklySummary({ weekly }) {
  const range = weekly.period?.from ? `${day(weekly.period.from)} – ${day(weekly.period.to)}` : 'últimos 7 días';
  const lines = weekly.headline.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  const recs = weekly.recommendations.map((r) => {
    const [icon, label] = SEVERITY[r.severity] ?? SEVERITY.info;
    return `<li class="sw-summary__rec sw-summary__rec--${r.severity}"><span class="sw-summary__sev"><span aria-hidden="true">${icon}</span> ${label}</span><div class="sw-summary__body"><b>${escapeHtml(r.title)}</b><p>${escapeHtml(r.detail)}</p></div>${action(r.action)}</li>`;
  }).join('');
  return `<div class="sw-summary"><section class="sw-rutas__card"><div class="sw-summary__head"><h3>Resumen de la semana <small>· ${range}</small></h3><button type="button" class="sw-rutas__btn" data-metrics-copy>Copiar resumen</button></div><ul class="sw-summary__lines">${lines}</ul><p class="sw-routes__hint">El resumen siempre cubre los últimos 7 días, independiente del periodo que elegiste arriba.</p><p id="metricsCopyStatus" class="sw-newroute__status" role="status"></p></section>
  <section class="sw-rutas__card"><h3>Recomendaciones</h3><ul class="sw-summary__recs">${recs}</ul><p class="sw-routes__hint">Son avisos automáticos a partir de las corridas guardadas: indican qué revisar, no la causa.</p></section></div>`;
}

// SW-093: versión compacta para la pantalla de inicio: resumen de 7 días y las 3 recomendaciones más urgentes.
export function renderHomeWeekly({ weekly }) {
  if (!weekly) return `<section class="sw-summary sw-summary--home"><h3>Esta semana</h3><p class="demo">Cuando haya corridas reales completadas, aquí verás el resumen de la semana y qué conviene revisar.</p></section>`;
  const range = weekly.period?.from ? `${day(weekly.period.from)} – ${day(weekly.period.to)}` : 'últimos 7 días';
  const lines = weekly.headline.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  const top = weekly.recommendations.slice(0, 3);
  const more = weekly.recommendations.length - top.length;
  const recs = top.map((r) => {
    const [icon, label] = SEVERITY[r.severity] ?? SEVERITY.info;
    return `<li class="sw-summary__rec sw-summary__rec--${r.severity}"><span class="sw-summary__sev"><span aria-hidden="true">${icon}</span> ${label}</span><div class="sw-summary__body"><b>${escapeHtml(r.title)}</b></div></li>`;
  }).join('');
  const moreText = more > 0 ? `<p class="sw-routes__hint">y ${more} ${more === 1 ? 'recomendación más' : 'recomendaciones más'}.</p>` : '';
  return `<section class="sw-summary sw-summary--home"><h3>Esta semana <small>· ${range}</small></h3><ul class="sw-summary__lines">${lines}</ul>${top.length ? `<ul class="sw-summary__recs">${recs}</ul>${moreText}` : ''}<a class="sw-rutas__btn" href="#operaciones/estadisticas" data-metrics-open-summary>Ver el resumen completo</a></section>`;
}

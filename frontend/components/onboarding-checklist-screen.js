// SW-121: tarjeta "Primeros pasos" en Resumen. Recibe el modelo ya calculado; solo pinta.
import { escapeHtml as e } from './button.js';

export function renderChecklist(model) {
  if (!model || model.complete) return '';
  const rows = model.items.map((i) => `<li class="steps-item${i.done ? ' is-done' : ''}${i.id === model.nextId ? ' is-next' : ''}"><span class="steps-mark" aria-hidden="true">${i.done ? '✓' : ''}</span><div class="steps-text"><b>${e(i.label)}</b><span class="steps-state">${i.done ? ' · Listo' : ''}</span>${i.done ? '' : `<p>${e(i.hint)}</p>`}</div>${i.done ? '' : `<a class="${i.id === model.nextId ? 'btn-primary' : 'btn-secondary'}" href="${e(i.href)}">${e(i.action)}</a>`}</li>`).join('');
  return `<section class="steps-card" aria-labelledby="stepsTitle"><div class="steps-head"><h2 id="stepsTitle">Primeros pasos</h2><span>${model.doneCount} de ${model.total}</span></div><div class="steps-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${model.total}" aria-valuenow="${model.doneCount}" aria-label="Pasos completados"><i style="width:${model.percent}%"></i></div><ol class="steps-list">${rows}</ol></section>`;
}

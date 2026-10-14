// SW-082: tabla accesible. Columnas con html:true aceptan HTML ya generado por otros componentes.
import { escapeHtml } from './button.js';

export function dataTable({ caption, columns = [], rows = [], emptyText = 'No hay datos todavía' } = {}) {
  const head = columns.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td>${c.html ? (r[c.key] ?? '') : escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length || 1}" class="sw-table__empty">${escapeHtml(emptyText)}</td></tr>`;
  return `<table class="sw-table"><caption class="sw-visually-hidden">${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

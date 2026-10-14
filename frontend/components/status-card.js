// SW-082: tarjeta de indicador con insignia opcional.
import { escapeHtml } from './button.js';
import { badge } from './badge.js';

export function statusCard({ title, value, status, note } = {}) {
  return `<section class="sw-status-card"><h3 class="sw-status-card__title">${escapeHtml(title)}</h3><p class="sw-status-card__value">${escapeHtml(value)}</p>${status ? badge({ status }) : ''}${note ? `<p class="sw-status-card__note">${escapeHtml(note)}</p>` : ''}</section>`;
}

// SW-082: estado vacío: qué pasa y qué hacer.
import { escapeHtml, button } from './button.js';

export function emptyState({ title, message, actionLabel, actionId } = {}) {
  if (!title) throw new Error('emptyState: falta title');
  return `<div class="sw-empty"><h3 class="sw-empty__title">${escapeHtml(title)}</h3>${message ? `<p class="sw-empty__message">${escapeHtml(message)}</p>` : ''}${actionLabel ? button({ label: actionLabel, id: actionId }) : ''}</div>`;
}

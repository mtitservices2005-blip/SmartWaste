// SW-082: insignia de estado. Siempre icono + texto + color (nunca solo color).
import { escapeHtml } from './button.js';

export const STATUS_META = {
  'en-ruta': { icon: '▶', text: 'En ruta' },
  'detenido': { icon: '⏸', text: 'Detenido' },
  'sin-senal': { icon: '⚠', text: 'Sin señal' },
  'disponible': { icon: '✔', text: 'Disponible' },
  'fuera-servicio': { icon: '✖', text: 'Fuera de servicio' }
};

export function badge({ status, label } = {}) {
  const meta = STATUS_META[status];
  if (!meta) throw new Error(`badge: estado desconocido "${status}"`);
  return `<span class="sw-badge sw-badge--${status}"><span class="sw-badge__icon" aria-hidden="true">${meta.icon}</span><span class="sw-badge__text">${escapeHtml(label || meta.text)}</span></span>`;
}

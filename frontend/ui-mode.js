// SW-082: modo de interfaz. Con hideDemo (despliegue real) se ocultan los avisos de demostración;
// sin configuración todo queda como antes (la demo aprobada no se rompe).
import { escapeHtml } from './components/button.js';

export function isDemoUi(config) {
  return !config?.hideDemo;
}

export function demoOnly(text, config) {
  return isDemoUi(config) ? text : '';
}

export function demoLine(text, config, extraClass = '') {
  if (!isDemoUi(config)) return '';
  return `<p class="demo${extraClass ? ` ${extraClass}` : ''}">${escapeHtml(text)}</p>`;
}

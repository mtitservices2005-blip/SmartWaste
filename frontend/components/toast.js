// SW-082: avisos breves. "error" usa role=alert; el resto role=status.
import { escapeHtml } from './button.js';

const TONES = ['success', 'error', 'info', 'warning'];

export function toastHtml({ message, tone = 'info' } = {}) {
  if (!TONES.includes(tone)) throw new Error(`toast: tono desconocido "${tone}"`);
  const role = tone === 'error' ? 'alert' : 'status';
  return `<div class="sw-toast sw-toast--${tone}" role="${role}">${escapeHtml(message)}</div>`;
}

export function toast({ message, tone = 'info', duration = 4000 } = {}, { document: doc = globalThis.document } = {}) {
  if (!doc) return null;
  let host = doc.getElementById?.('sw-toast-host');
  if (!host) {
    host = doc.createElement('div');
    host.id = 'sw-toast-host';
    host.className = 'sw-toast-host';
    doc.body.appendChild(host);
  }
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = toastHtml({ message, tone });
  const el = wrapper.firstElementChild;
  host.appendChild(el);
  if (duration > 0 && typeof setTimeout === 'function') setTimeout(() => el.remove(), duration);
  return el;
}

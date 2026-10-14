// SW-082: campo de formulario con etiqueta visible, ayuda enlazada y error anunciable (CA-082-3).
import { escapeHtml } from './button.js';

export function field({ id, label, hint, error, value = '', type = 'text', required = false, options = [], inputmode } = {}) {
  if (!id) throw new Error('field: falta id');
  if (!label) throw new Error('field: falta label (el placeholder no reemplaza a la etiqueta)');
  const e = escapeHtml;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  const attrs = `id="${e(id)}" name="${e(id)}"${required ? ' required' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}`;
  let control;
  if (type === 'select') {
    const opts = options.map((o) => `<option value="${e(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${e(o.label)}</option>`).join('');
    control = `<select class="sw-field__control" ${attrs}>${opts}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="sw-field__control" ${attrs}>${e(value)}</textarea>`;
  } else {
    control = `<input class="sw-field__control" type="${e(type)}" ${attrs} value="${e(value)}"${inputmode ? ` inputmode="${e(inputmode)}"` : ''}>`;
  }
  return `<div class="sw-field"><label class="sw-field__label" for="${e(id)}">${e(label)}${required ? ' <span class="sw-field__req" aria-hidden="true">*</span>' : ''}</label>${control}${hint ? `<p class="sw-field__hint" id="${e(id)}-hint">${e(hint)}</p>` : ''}${error ? `<p class="sw-field__error" id="${e(id)}-error" role="alert">${e(error)}</p>` : ''}</div>`;
}

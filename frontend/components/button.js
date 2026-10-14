// SW-082: botón base. Devuelve HTML; el texto siempre se escapa.
export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const VARIANTS = ['primary', 'secondary', 'danger', 'ghost'];

export function button({ label, variant = 'primary', id, type = 'button', disabled = false } = {}) {
  if (!label) throw new Error('button: falta label (un botón sin texto es inaccesible)');
  if (!VARIANTS.includes(variant)) throw new Error(`button: variante desconocida "${variant}" (usa ${VARIANTS.join(', ')})`);
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  const dis = disabled ? ' disabled' : '';
  return `<button type="${escapeHtml(type)}"${idAttr} class="sw-btn sw-btn--${variant}"${dis}>${escapeHtml(label)}</button>`;
}

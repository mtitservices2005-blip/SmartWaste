// SW-082: esqueleto de carga.
export function skeleton({ lines = 3 } = {}) {
  const items = Array.from({ length: lines }, () => '<span class="sw-skeleton__line"></span>').join('');
  return `<div class="sw-skeleton" aria-busy="true" aria-live="polite"><span class="sw-visually-hidden">Cargando…</span>${items}</div>`;
}

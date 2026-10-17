// SW-084: riel de navegación lateral Mando. Devuelve HTML (como el resto de components/*) y conserva
// los enlaces por hash que ya usan app.js (showSection) y auth-gate.js (ocultar por rol): cada
// destino sigue siendo un <a href="#seccion"> o <a href="#operaciones/vista">.
import { escapeHtml } from './button.js';

const svg = (d) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  mapa: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  rutas: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/>',
  flota: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  incidencias: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  estadisticas: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  mas: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  tema: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'
};

export const OPS_ITEMS = [
  { href: '#operaciones/mapa', label: 'Mapa en vivo', icon: 'mapa' },
  { href: '#operaciones/rutas', label: 'Rutas', icon: 'rutas' },
  { href: '#operaciones/flota', label: 'Flotilla', icon: 'flota' },
  { href: '#operaciones/incidencias', label: 'Incidencias', icon: 'incidencias' },
  { href: '#operaciones/estadisticas', label: 'Métricas', icon: 'estadisticas' }
];
export const MORE_ITEMS = [
  { href: '#resumen', label: 'Resumen' },
  { href: '#supervisor', label: 'Supervisor' },
  { href: '#conductor', label: 'Conductor' },
  { href: '#ciudadania', label: 'Ciudadanía' },
  { href: '#impacto', label: 'Impacto y Ahorros' },
  { href: '#configuracion', label: 'Configuración' },
  { href: '#master', label: 'Master Admin' }
];

// Elemento activo según el hash. Mismas reglas que app.js: sin hash válido → Resumen; #operaciones
// sin sub-vista válida → mapa.
export function activeHref(hash = '') {
  const [id, view] = String(hash).replace(/^#/, '').split('/');
  if (id === 'operaciones') {
    const match = OPS_ITEMS.find((i) => i.href === `#operaciones/${view}`);
    return match ? match.href : '#operaciones/mapa';
  }
  const more = MORE_ITEMS.find((i) => i.href === `#${id}`);
  return more ? more.href : '#resumen';
}

export function renderRail({ hash = '', hideDemo = false } = {}) {
  const active = activeHref(hash);
  const cur = (href) => (href === active ? ' aria-current="page"' : '');
  const opsLinks = OPS_ITEMS.map((i) => `<a class="sw-rail__link" href="${i.href}" aria-label="${escapeHtml(i.label)}" title="${escapeHtml(i.label)}"${cur(i.href)}>${svg(ICONS[i.icon])}</a>`).join('');
  const moreLinks = MORE_ITEMS.map((i) => `<a class="sw-rail__morelink" href="${i.href}"${cur(i.href)}>${escapeHtml(i.label)}</a>`).join('');
  const demo = hideDemo ? '' : '<span class="sw-rail__demo" title="Datos demo · no producción">DEMO</span>';
  return `<header class="topbar sw-rail" id="swRail">`
    + `<a class="sw-rail__brand" href="#operaciones/mapa" aria-label="SmartWaste, centro de control">SW</a>${demo}`
    + `<nav class="sw-rail__nav" aria-label="Navegación principal">${opsLinks}`
    + `<button type="button" class="sw-rail__link" id="swMoreBtn" aria-expanded="false" aria-controls="swMore" aria-label="Más secciones" title="Más secciones">${svg(ICONS.mas)}</button></nav>`
    + `<div class="sw-rail__more" id="swMore" hidden>${moreLinks}</div>`
    + `<div class="sw-rail__foot"><button type="button" class="sw-rail__link" id="swThemeBtn" aria-label="Cambiar tema" title="Cambiar tema">${svg(ICONS.tema)}</button></div>`
    + `</header>`;
}

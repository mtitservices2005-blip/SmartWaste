// SW-097: piezas HTML del mapa público en vivo. Texto siempre escapado; sin imports externos.
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderLiveHeader({ municipalityName, updatedAgoText } = {}) {
  return `<header class="live-header"><h1 class="live-header__title">Camiones en vivo${municipalityName ? ` · ${esc(municipalityName)}` : ''}</h1>${updatedAgoText ? `<p class="live-header__updated" aria-live="polite">Actualizado ${esc(updatedAgoText)}</p>` : ''}</header>`;
}

export function renderLiveVehicleList({ vehicles = [], selectedCode = null } = {}) {
  const items = vehicles.map((v) => {
    const stale = v.status === 'sin_senal' ? ' is-stale' : '';
    const current = v.code === selectedCode ? ' aria-current="true"' : '';
    return `<li><button type="button" class="live-card live-card--${esc(v.status)}${stale}" data-live-vehicle="${esc(v.code)}"${current}><span class="live-card__code">${esc(v.code)}</span><span class="live-card__route">${esc(v.routeName)}</span><span class="live-card__status">${esc(v.statusText)}</span></button></li>`;
  }).join('');
  return `<ul class="live-list">${items}</ul>`;
}

export function renderLiveEmpty() {
  return '<div class="live-notice live-notice--empty"><p>Hoy aún no hay camiones en ruta</p><p class="live-notice__hint">Cuando un camión salga a recorrer, lo verás aquí.</p></div>';
}

export function renderLiveError({ hasData } = {}) {
  return `<div class="live-notice live-notice--error" role="status"><p>No pudimos actualizar. Reintentando…</p>${hasData ? '<p class="live-notice__hint">Mostramos la última posición conocida.</p>' : ''}</div>`;
}

export function renderLiveNoMunicipality() {
  return '<div class="live-notice live-notice--empty"><p>Falta indicar el municipio</p><p class="live-notice__hint">Abre el enlace que te dio tu ayuntamiento para ver los camiones de tu municipio.</p></div>';
}

// Íconos de camión que el ciudadano puede elegir (solo en su pantalla). Cada uno se dibuja en 24×24.
export const LIVE_ICONS = [
  { id: 'punto', label: 'Punto', body: '<circle cx="12" cy="12" r="5" fill="currentColor"/>' },
  { id: 'compactador', label: 'Compactador', body: '<path fill="currentColor" d="M2 8h11v7H2zM14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2" fill="currentColor"/><circle cx="17" cy="17" r="2" fill="currentColor"/>' },
  { id: 'volquete', label: 'Volquete', body: '<path fill="currentColor" d="M2 7l11 1-1 7H2zM14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2" fill="currentColor"/><circle cx="17" cy="17" r="2" fill="currentColor"/>' },
  { id: 'camioneta', label: 'Camioneta', body: '<path fill="currentColor" d="M2 11h8l2-3h5l3 4v3H2z"/><circle cx="7" cy="16" r="2" fill="currentColor"/><circle cx="17" cy="16" r="2" fill="currentColor"/>' }
];
const iconOf = (id) => LIVE_ICONS.find((i) => i.id === id) ?? LIVE_ICONS[1];

export function renderLiveIconSvg(iconId) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${iconOf(iconId).body}</svg>`;
}

export function renderLiveMarker({ icon, status } = {}) {
  return `<span class="live-marker live-marker--${esc(status ?? 'en_ruta')}">${renderLiveIconSvg(icon)}</span>`;
}

export function renderLiveIconPicker({ selected } = {}) {
  const current = iconOf(selected).id;
  const opts = LIVE_ICONS.map((i) => `<button type="button" class="live-icon-option" data-live-icon="${i.id}" aria-pressed="${i.id === current}" title="${esc(i.label)}" aria-label="${esc(i.label)}">${renderLiveIconSvg(i.id)}</button>`).join('');
  return `<div class="live-icons" role="group" aria-label="Ícono de los camiones"><div class="live-icons__row">${opts}</div></div>`;
}

// SW-100: el Portal ciudadano abre con el mapa en vivo (iframe a /en-vivo; toma el municipio de la config del despliegue).
export function renderCitizenLiveMap({ enabled } = {}) {
  if (!enabled) {
    return '<div class="live-embed live-embed--demo"><h3>Camiones en vivo</h3><p class="demo">Disponible cuando el ayuntamiento esté conectado (modo demo: sin mapa real).</p></div>';
  }
  return '<div class="live-embed"><h3>Camiones en vivo</h3><iframe class="live-embed__frame" src="./en-vivo.html?embed=1" title="Mapa en vivo de los camiones de recogida" loading="lazy" referrerpolicy="no-referrer"></iframe></div>';
}

const timeLabel = (t) => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? 'a. m.' : 'p. m.'}`; };

// SW-101: calendario semanal de rutas (los días ya vienen calculados por shared/route-calendar.js).
export function renderRouteCalendar({ days = [] } = {}) {
  if (!days.length) return '';
  const cols = days.map((d) => {
    const items = d.routes.length
      ? d.routes.map((r) => `<li class="live-cal__route"><span class="live-cal__name">${esc(r.name)}</span>${r.time ? `<span class="live-cal__time">${esc(timeLabel(r.time))}</span>` : ''}</li>`).join('')
      : '<li class="live-cal__empty">Sin recogida</li>';
    return `<li class="live-cal__day${d.isToday ? ' is-today' : ''}"><h4 class="live-cal__label">${esc(d.label)}${d.isToday ? ' · hoy' : ''}</h4><ul class="live-cal__routes">${items}</ul></li>`;
  }).join('');
  return `<section class="live-cal" aria-label="Calendario de rutas"><ol class="live-cal__grid">${cols}</ol></section>`;
}

export function renderNextDeparture(text) {
  return text ? `<p class="live-next">${esc(text)}</p>` : '';
}

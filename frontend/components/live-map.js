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

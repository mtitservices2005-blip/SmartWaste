// SW-127: bandeja "Basura acumulada" (Operaciones) y ajustes de la integración con Saibot (Configuración).
// Solo pintan el modelo que reciben; las acciones son data-attributes que app.js delega. Todo texto externo se escapa.
import { escapeHtml as e } from './button.js';

const STATUS = { new: 'Nuevo', assigned: 'Asignado', collected: 'Atendido', rejected: 'No procede' };
const SYNC = { pending: 'Aviso a Saibot pendiente', sent: 'Saibot avisado', failed: 'Falló el aviso a Saibot' };
const FILTERS = [['open', 'Por atender'], ['closed', 'Cerrados'], ['all', 'Todos']];

const isHttps = (url) => typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url);

function age(iso, now) {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min < 2 ? 'hace un momento' : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function card(r, selectedId, now) {
  const sync = r.status === 'collected' || r.status === 'rejected' ? SYNC[r.saibot_sync] ?? '' : '';
  return `<li><button type="button" class="sw-waste__item sw-waste__item--${e(r.status)}" data-waste-select="${e(r.id)}" aria-current="${r.id === selectedId}">
    <span class="sw-waste__row"><span class="sw-waste__folio">${e(r.external_id)}</span><span class="sw-waste__folio">${e(age(r.reported_at, now))}</span></span>
    <span class="sw-waste__title">${e(r.description)}</span>
    ${r.reference ? `<span class="sw-waste__folio">${e(r.reference)}</span>` : ''}
    <span class="sw-waste__row"><span class="sw-waste__pill sw-waste__pill--${e(r.status)}">${e(STATUS[r.status] ?? r.status)}</span>${sync ? `<span class="sw-waste__pill sw-waste__pill--sync-${e(r.saibot_sync)}">${e(sync)}</span>` : ''}</span>
  </button></li>`;
}

function detail(r, { busyId, now }) {
  if (!r) return '<p class="demo">Elige un reporte de la lista o del plano para ver el detalle.</p>';
  const open = r.status === 'new' || r.status === 'assigned';
  const hasPos = Number.isFinite(r.latitude) && Number.isFinite(r.longitude);
  const link = hasPos ? `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}` : '';
  const photos = (r.photo_urls ?? []).filter(isHttps);
  const busy = busyId === r.id;
  return `<div class="sw-waste__dhead"><h3>${e(r.description)}</h3><span class="sw-waste__pill sw-waste__pill--${e(r.status)}">${e(STATUS[r.status] ?? r.status)}</span></div>
    <dl class="sw-waste__dl"><dt>Folio de Saibot</dt><dd>${e(r.external_id)}</dd><dt>Reportado</dt><dd>${e(age(r.reported_at, now))}</dd>
      ${r.reference ? `<dt>Referencia</dt><dd>${e(r.reference)}</dd>` : ''}
      ${hasPos ? `<dt>Ubicación</dt><dd>${e(r.latitude.toFixed(5))}, ${e(r.longitude.toFixed(5))} · <a href="${e(link)}" target="_blank" rel="noopener noreferrer">Ver en el mapa</a></dd>` : '<dt>Ubicación</dt><dd>Saibot no envió coordenadas.</dd>'}
      ${photos.length ? `<dt>Fotos</dt><dd>${photos.map((u, i) => `<a href="${e(u)}" target="_blank" rel="noopener noreferrer">Foto ${i + 1}</a>`).join(' · ')}</dd>` : ''}
      ${r.attended_note ? `<dt>Nota</dt><dd>${e(r.attended_note)}</dd>` : ''}
      ${!open && SYNC[r.saibot_sync] ? `<dt>Cierre en Saibot</dt><dd>${e(SYNC[r.saibot_sync])}</dd>` : ''}</dl>
    ${open ? `<label class="sw-waste__label" for="wasteNote">Nota (opcional) o motivo si no procede</label>
      <textarea id="wasteNote" class="sw-waste__note" maxlength="300" rows="2"${busy ? ' disabled' : ''}></textarea>
      <div class="sw-waste__acts"><button type="button" class="btn-primary" data-waste-act="collected" data-waste-id="${e(r.id)}"${busy ? ' disabled' : ''}>Marcar atendido</button><button type="button" class="sw-waste__btn" data-waste-act="rejected" data-waste-id="${e(r.id)}"${busy ? ' disabled' : ''}>No procede</button></div>` : ''}`;
}

export function renderWasteBoard({ reports = [], filter = 'open', selectedId = null, pins = [], error = '', status = '', busyId = null, loaded = true, counts = null, now = new Date() } = {}) {
  const c = counts ?? { open: 0, closed: 0, total: reports.length };
  const shown = filter === 'all' ? reports : filter === 'closed' ? reports.filter((r) => r.status === 'collected' || r.status === 'rejected') : reports.filter((r) => r.status === 'new' || r.status === 'assigned');
  const selected = shown.find((r) => r.id === selectedId) ?? null;
  const pinHtml = pins.filter((p) => shown.some((r) => r.id === p.id)).map((p) => {
    const r = shown.find((x) => x.id === p.id);
    return `<button type="button" class="sw-waste__pin sw-waste__pin--${e(r.status)}" style="left:${p.x.toFixed(1)}%;top:${p.y.toFixed(1)}%" data-waste-select="${e(r.id)}" aria-label="${e(r.description)}" aria-current="${r.id === selectedId}"></button>`;
  }).join('');
  const body = !loaded ? '<p class="demo">Cargando reportes…</p>'
    : shown.length ? `<ul class="sw-waste__list">${shown.map((r) => card(r, selectedId, now)).join('')}</ul>`
    : `<p class="demo">${filter === 'open' ? 'No hay reportes por atender. Cuando un ciudadano reporte basura acumulada en Saibot, aparecerá aquí.' : 'No hay reportes en esta vista.'}</p>`;
  return `<section class="sw-waste" aria-label="Basura acumulada">
    <div class="sw-waste__head"><div><h2>Basura acumulada</h2><p class="sw-rutas__sub">Reportes de ciudadanos que llegan desde Saibot. Marca cada uno como atendido cuando se recoja.</p></div>${loaded ? `<span class="sw-waste__count">${c.open} por atender</span>` : ''}</div>
    ${error ? `<p class="sw-waste__error" role="alert">${e(error)}</p>` : ''}${status ? `<p class="demo" role="status">${e(status)}</p>` : ''}
    <div class="sw-waste__chips" role="group" aria-label="Filtrar reportes">${FILTERS.map(([k, label]) => `<button type="button" class="sw-waste__chip" data-waste-filter="${k}" aria-pressed="${filter === k}">${label}</button>`).join('')}</div>
    <div class="sw-waste__grid">
      <div class="sw-waste__col">${body}</div>
      <div class="sw-waste__col">
        ${pinHtml ? `<div class="sw-waste__map" role="group" aria-label="Plano de ubicación de los reportes">${pinHtml}</div><p class="demo">Plano de posiciones relativas. Para ver la calle, abre el reporte y usa "Ver en el mapa".</p>` : ''}
        <div class="sw-waste__detail">${detail(selected, { busyId, now })}</div>
      </div>
    </div>
  </section>`;
}

export function renderSaibotIntegration({ loading = false, configured = false, enabled = true, last4 = '', lastUsedText = '', endpoint = '', newKey = '', confirmRegen = false, error = '', status = '', busy = false } = {}) {
  if (loading) return '<p class="demo">Cargando la integración…</p>';
  const keyBlock = newKey
    ? `<div class="sw-saibot__key"><strong>Clave nueva: cópiala ahora</strong><code>${e(newKey)}</code><span class="demo">No se vuelve a mostrar. Entrégala solo al equipo de Saibot.</span><div class="sw-waste__acts"><button type="button" class="sw-waste__btn" data-saibot-copy="key">Copiar clave</button></div></div>`
    : configured ? `<div class="sw-saibot__key"><strong>Clave de acceso</strong><span>Ya hay una clave activa que termina en ${e(last4)}.</span><span class="demo">Por seguridad no se puede ver otra vez; si se perdió, genera una nueva.</span></div>`
    : '<div class="sw-saibot__key"><strong>Todavía no hay clave</strong><span class="demo">Genera una clave y entrégala al equipo de Saibot para empezar a recibir reportes.</span></div>';
  const gen = confirmRegen
    ? `<div class="sw-saibot__key" role="alert"><strong>¿Generar una clave nueva?</strong><span>La clave actual dejará de funcionar al instante y Saibot no podrá enviar reportes hasta que use la nueva.</span><div class="sw-waste__acts"><button type="button" class="btn-primary" data-saibot-gen="confirm"${busy ? ' disabled' : ''}>Sí, generar</button><button type="button" class="sw-waste__btn" data-saibot-gen="cancel">Cancelar</button></div></div>`
    : `<div class="sw-waste__acts"><button type="button" class="btn-primary" data-saibot-gen="${configured ? 'ask' : 'confirm'}"${busy ? ' disabled' : ''}>${configured ? 'Generar clave nueva' : 'Generar clave'}</button></div>`;
  return `<div class="sw-saibot">
    <label class="sw-waste__label" for="saibotEndpoint">Dirección a la que Saibot envía los reportes</label>
    <input id="saibotEndpoint" class="sw-waste__input" type="text" readonly value="${e(endpoint)}">
    <div class="sw-waste__acts"><button type="button" class="sw-waste__btn" data-saibot-copy="endpoint"${endpoint ? '' : ' disabled'}>Copiar dirección</button></div>
    ${keyBlock}${gen}
    ${configured ? `<label class="sw-saibot__toggle"><input type="checkbox" data-saibot-toggle${enabled ? ' checked' : ''}${busy ? ' disabled' : ''}> Recibir reportes de Saibot</label>
      <p class="demo">${enabled ? (lastUsedText ? `Último reporte recibido ${e(lastUsedText)}.` : 'Todavía no se ha recibido ningún reporte.') : 'Recepción desactivada: Saibot recibirá un error 401 hasta que la actives.'}</p>` : ''}
    ${error ? `<p class="sw-waste__error" role="alert">${e(error)}</p>` : ''}${status ? `<p class="demo" role="status">${e(status)}</p>` : ''}
  </div>`;
}

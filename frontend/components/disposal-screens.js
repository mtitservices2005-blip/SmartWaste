// SW-130: ajustes de peso y destino (Configuración) y la pantalla de descargas (Operaciones).
// Solo pintan el modelo que reciben; las acciones son data-attributes que app.js delega. Todo texto externo se escapa.
import { escapeHtml as e } from './button.js';
// Los componentes solo importan de ./ : las etiquetas y funciones de shared/waste-disposal.js llegan en `ui` (DISPOSAL_UI).

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };

export function renderDisposalSettings({ ui, loaded = true, settings = { mode: 'off', defaultCapacityKg: null }, sites = [], error = '', status = '', busy = false } = {}) {
  if (!loaded) return '<p class="demo">Cargando…</p>';
  const { MODES, MODE_LABEL, MODE_HINT, SITE_KINDS } = ui;
  const dis = busy ? ' disabled' : '';
  return `<div class="sw-disp">
    <fieldset class="sw-disp__modes"><legend class="sw-waste__label">Cómo se registra lo que se recoge</legend>
      ${MODES.map((m) => `<label class="sw-disp__mode"><input type="radio" name="wasteMode" value="${m}" data-waste-mode${settings.mode === m ? ' checked' : ''}${dis}> <span><strong>${e(MODE_LABEL[m])}</strong><br><span class="demo">${e(MODE_HINT[m])}</span></span></label>`).join('')}
    </fieldset>
    ${settings.mode === 'estimated' ? `<label class="sw-waste__label" for="wasteCapacity">Capacidad típica de un camión lleno (kilos)</label>
      <div class="sw-waste__acts"><input id="wasteCapacity" class="sw-waste__input" type="number" min="1" max="100000" step="1" value="${settings.defaultCapacityKg ?? ''}"${dis}><button type="button" class="sw-waste__btn" data-waste-capacity-save${dis}>Guardar capacidad</button></div>
      <p class="demo">Sin este número no se puede estimar. Una referencia: un camión compactador mediano carga entre 6,000 y 10,000 kilos. Pregunta el dato real a tu equipo.</p>` : ''}
    ${settings.mode !== 'off' ? `<div class="sw-disp__sites"><h4>Sitios de destino</h4>
      ${sites.length ? `<ul class="sw-disp__list">${sites.map((s) => `<li><span><strong>${e(s.name)}</strong> · ${e(SITE_KINDS[s.kind] ?? s.kind)}${s.active ? '' : ' · <em>desactivado</em>'}</span><button type="button" class="sw-waste__btn" data-site-toggle="${e(s.id)}" data-site-active="${s.active ? '1' : '0'}"${dis}>${s.active ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul>` : '<p class="demo">Todavía no hay sitios. El destino es opcional: agrégalos si quieres saber a dónde va lo que se recoge.</p>'}
      <div class="sw-disp__add"><input id="siteName" class="sw-waste__input" type="text" maxlength="80" placeholder="Nombre del sitio (ej. Relleno de Santiago)"${dis}>
        <select id="siteKind" class="sw-waste__input"${dis}>${Object.entries(SITE_KINDS).map(([k, l]) => `<option value="${k}">${e(l)}</option>`).join('')}</select>
        <button type="button" class="btn-primary" data-site-add${dis}>Agregar sitio</button></div></div>` : ''}
    ${error ? `<p class="sw-waste__error" role="alert">${e(error)}</p>` : ''}${status ? `<p class="demo" role="status">${e(status)}</p>` : ''}
  </div>`;
}

function card(label, s, formatKg) {
  const parts = [];
  if (s.estimatedKg > 0) parts.push(`${formatKg(s.estimatedKg)} estimado`);
  if (s.scaleKg > 0) parts.push(`${formatKg(s.scaleKg)} pesado`);
  return `<div class="sw-disp__card"><span class="demo">${e(label)}</span><strong>${s.count ? e(formatKg(s.totalKg)) : '—'}</strong><span class="demo">${s.count} descarga${s.count === 1 ? '' : 's'}${s.withoutWeight ? ` · ${s.withoutWeight} sin peso` : ''}${parts.length ? ` · ${e(parts.join(' + '))}` : ''}</span></div>`;
}

export function renderDisposalBoard({ ui, loaded = true, enabled = true, mode = 'trips', settings = {}, sites = [], disposals = [], vehicles = [], week = null, month = null, voidingId = null, error = '', status = '', busy = false } = {}) {
  if (!enabled) return '<h2>Peso y destino</h2><p class="demo">Está apagado. Un administrador puede activarlo en Configuración → Operación.</p>';
  if (!loaded) return '<h2>Peso y destino</h2><p class="demo">Cargando…</p>';
  const { SOURCE_LABEL, FILL_LEVELS, formatKg, sourcesForMode } = ui;
  const dis = busy ? ' disabled' : '';
  const sources = sourcesForMode(mode, settings);
  const activeSites = sites.filter((s) => s.active);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const vehName = new Map(vehicles.map((v) => [v.id, v.label]));
  const dest = month?.byDestination ?? [];
  return `<section class="sw-disp" aria-label="Peso y destino">
    <h2>Peso y destino</h2><p class="sw-rutas__sub">Lo que se descarga, cuánto pesa y a dónde va. Cada cifra dice si fue pesada, estimada o quedó sin peso.</p>
    ${error ? `<p class="sw-waste__error" role="alert">${e(error)}</p>` : ''}${status ? `<p class="demo" role="status">${e(status)}</p>` : ''}
    <div class="sw-disp__cards">${week ? card('Últimos 7 días', week, ui.formatKg) : ''}${month ? card('Últimos 30 días', month, ui.formatKg) : ''}</div>
    ${dest.length > 1 || (dest.length === 1 && dest[0].siteId) ? `<table class="sw-disp__table"><thead><tr><th>Destino (30 días)</th><th>Descargas</th><th>Peso</th></tr></thead><tbody>${dest.map((d) => `<tr><td>${e(d.name)}</td><td>${d.count}</td><td>${e(formatKg(d.kg))}</td></tr>`).join('')}</tbody></table>` : ''}
    <form class="sw-disp__form" id="dispForm" onsubmit="return false"><h3>Registrar una descarga</h3>
      <label class="sw-waste__label" for="dispVehicle">Camión</label>
      <select id="dispVehicle" class="sw-waste__input"${dis}><option value="">Elige el camión</option>${vehicles.map((v) => `<option value="${e(v.id)}">${e(v.label)}</option>`).join('')}</select>
      ${activeSites.length ? `<label class="sw-waste__label" for="dispSite">Destino (opcional)</label><select id="dispSite" class="sw-waste__input"${dis}><option value="">Sin destino</option>${activeSites.map((s) => `<option value="${e(s.id)}"${activeSites.length === 1 ? ' selected' : ''}>${e(s.name)}</option>`).join('')}</select>` : ''}
      ${sources.length > 1 ? `<label class="sw-waste__label" for="dispSource">Peso</label><select id="dispSource" class="sw-waste__input"${dis}>${sources.map((s) => `<option value="${s}">${e(s === 'scale' ? 'Pesado en báscula' : s === 'estimated' ? 'Estimar por llenado' : 'Sin peso')}</option>`).join('')}</select>` : `<input type="hidden" id="dispSource" value="${sources[0] ?? 'none'}">`}
      <div id="dispWeightBox"${sources[0] === 'scale' ? '' : ' hidden'}><label class="sw-waste__label" for="dispWeight">Peso en kilos</label><input id="dispWeight" class="sw-waste__input" type="number" min="0" max="100000" step="0.1"${dis}>
        <label class="sw-waste__label" for="dispTicket">Número de ticket (opcional)</label><input id="dispTicket" class="sw-waste__input" type="text" maxlength="40"${dis}></div>
      <div id="dispFillBox"${sources[0] === 'estimated' ? '' : ' hidden'}><label class="sw-waste__label" for="dispFill">Qué tan lleno iba</label><select id="dispFill" class="sw-waste__input"${dis}>${FILL_LEVELS.map((f) => `<option value="${f}">${f === 100 ? 'Lleno' : `${f} %`}</option>`).join('')}</select></div>
      <label class="sw-waste__label" for="dispNote">Nota (opcional)</label><input id="dispNote" class="sw-waste__input" type="text" maxlength="300"${dis}>
      <div class="sw-waste__acts"><button type="button" class="btn-primary" data-disp-save${dis}>Registrar descarga</button></div>
    </form>
    <h3>Descargas recientes</h3>
    ${disposals.length ? `<ul class="sw-disp__list">${disposals.slice(0, 40).map((d) => `<li><span><strong>${e(d.weight_source === 'none' ? 'Sin peso' : formatKg(d.weight_kg))}</strong> <span class="sw-waste__pill sw-waste__pill--disp-${e(d.weight_source)}">${e(SOURCE_LABEL[d.weight_source] ?? d.weight_source)}</span><br><span class="demo">${e(when(d.unloaded_at))} · ${e(vehName.get(d.vehicle_id) ?? 'Camión')}${d.site_id ? ` · ${e(siteName.get(d.site_id) ?? 'Sitio')}` : ''}${d.ticket_number ? ` · ticket ${e(d.ticket_number)}` : ''}${d.note ? ` · ${e(d.note)}` : ''}</span></span>
      ${voidingId === d.id ? `<span class="sw-disp__void"><input id="dispVoidReason" class="sw-waste__input" type="text" maxlength="300" placeholder="Motivo de la anulación"><button type="button" class="btn-primary" data-disp-void-confirm="${e(d.id)}"${dis}>Anular</button><button type="button" class="sw-waste__btn" data-disp-void-cancel>Cancelar</button></span>` : `<button type="button" class="sw-waste__btn" data-disp-void="${e(d.id)}"${dis}>Anular</button>`}</li>`).join('')}</ul>` : '<p class="demo">Todavía no hay descargas registradas en los últimos 30 días.</p>'}
  </section>`;
}

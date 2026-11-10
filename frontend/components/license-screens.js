// SW-117: pantallas de la licencia por camión. HTML puro: recibe el modelo de shared/license-view.js (los componentes
// no importan de shared/) y app.js conecta los botones (data-license-*).
import { escapeHtml as esc } from './button.js';

const badge = (status, label) => `<span class="sw-license__badge sw-license__badge--${esc(status)}">${esc(label)}</span>`;
const opt = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
const eventLine = (e) => `<li><span>${esc(e.dateText)}</span><span><b>${esc(e.label)}</b>${e.detail ? ` · ${esc(e.detail)}` : ''}</span><span class="sw-license__mono">${esc(e.moneyText)}</span></li>`;

export function renderLicenseBanner(banner) {
  if (!banner) return '';
  return `<div class="sw-license__banner sw-license__banner--${esc(banner.tone)}" role="status"><b>${esc(banner.title)}</b><span>${esc(banner.body)}</span></div>`;
}

// Tarjeta "Tu suscripción" de Configuración (administrador del ayuntamiento).
export function renderLicenseCard(v) {
  if (!v) return '';
  const panel = v.panelOpen ? `<div class="sw-license__panel" data-license-panel><h4>Agregar camiones</h4><p class="demo">Pagas por camión al año. Hoy tienes ${v.limit} contratados.</p><label>Camiones a agregar <input type="number" id="licenseTrucks" data-license-trucks min="1" max="10" step="1" value="${esc(v.panelTrucks)}"></label><p class="sw-license__quote" data-license-quote>${esc(v.quote)}</p><div class="controls"><button type="button" class="btn-primary" data-license-confirm>Confirmar y aplicar</button><button type="button" data-license-cancel>Cancelar</button></div><p class="demo">El cambio se aplica al instante y MT IT Services recibe el aviso para facturarlo. Para reducir camiones, contacta a MT IT Services.</p></div>` : '';
  const history = v.events.length ? `<h4>Historial</h4><ul class="sw-license__log">${v.events.map(eventLine).join('')}</ul>` : '';
  return `<div class="sw-license" data-license-card>${renderLicenseBanner(v.banner)}<dl class="sw-license__kv"><dt>Estado</dt><dd>${badge(v.status, v.statusLabel)}</dd><dt>Vigencia hasta</dt><dd>${esc(v.validUntilText)}</dd><dt>Camiones contratados</dt><dd class="sw-license__mono">${esc(v.limit)}</dd><dt>Tarifa</dt><dd class="sw-license__mono">${esc(v.priceText)}</dd><dt>Total anual</dt><dd class="sw-license__mono">${esc(v.totalText)}</dd></dl><div class="sw-license__bar${v.atLimit ? ' is-full' : ''}" role="img" aria-label="${esc(v.used)} de ${esc(v.limit)} camiones en uso"><i style="width:${esc(v.pct)}%"></i></div><p class="sw-license__mono">${esc(v.used)} de ${esc(v.limit)} camiones en uso</p><div class="controls"><button type="button" class="btn-primary" data-license-open${v.suspended ? ' disabled' : ''}>Agregar camiones</button></div><p class="demo">${esc(v.hint)}</p>${panel}<p class="demo" data-license-message role="status">${esc(v.message)}</p>${history}</div>`;
}

// Bloque "Suscripción" de cada ayuntamiento en Master Admin.
export function renderMasterLicense(v) {
  const id = esc(v.id);
  const msg = `<p class="demo" data-license-message role="status">${esc(v.message)}</p>`;
  if (!v.hasLicense) return `<div class="sw-license" data-license-master="${id}"><p><b>Suscripción:</b> sin licencia registrada (sin límites).</p><div class="controls"><button type="button" class="btn-primary" data-license-create="${id}">Crear licencia: prueba de 60 días y 5 camiones</button></div>${msg}</div>`;
  const t = v.terms;
  const terms = `<div class="sw-license__terms" data-license-terms="${id}"><h4>Condiciones</h4><div class="sw-license__grid"><label>Camiones contratados <input name="contractedTrucks" type="number" min="0" max="1000" step="1" value="${esc(t.contractedTrucks)}"></label><label>Tarifa por camión al año <input name="price" type="number" min="0" step="0.01" value="${esc(t.price)}"></label><label>Moneda <select name="currency">${opt('USD', 'US$', t.currency)}${opt('DOP', 'RD$', t.currency)}</select></label><label>Vigencia hasta <input name="validUntil" type="date" value="${esc(t.validUntil)}"></label><label>Días de gracia <input name="graceDays" type="number" min="0" max="90" step="1" value="${esc(t.graceDays)}"></label><label>Modo de cobro <select name="billingMode">${opt('manual', 'Manual', t.billingMode)}<option value="automatic" disabled${t.billingMode === 'automatic' ? ' selected' : ''}>Automático (próximamente)</option></select></label><label class="sw-license__check"><input name="isTrial" type="checkbox"${t.isTrial ? ' checked' : ''}> En periodo de prueba</label></div><div class="controls"><button type="button" class="btn-primary" data-license-save="${id}">Guardar condiciones</button></div></div>`;
  const pay = `<div class="sw-license__pay" data-license-pay-form="${id}"><h4>Registrar pago</h4><div class="sw-license__grid"><label>Monto <input name="amount" type="number" min="0" step="0.01" inputmode="decimal"></label><label>Periodo <select name="period">${opt('mensual', 'Mensual', '')}${opt('trimestral', 'Trimestral', '')}${opt('anual', 'Anual', 'anual')}</select></label><label>Referencia <input name="reference" type="text" maxlength="80" placeholder="No. de transferencia o factura"></label></div><div class="controls"><button type="button" class="btn-primary" data-license-pay="${id}">Registrar pago y renovar</button></div><p class="demo">Extiende la vigencia según el periodo y activa la licencia.</p></div>`;
  const billing = v.toBill.length ? `<div class="sw-license__billing"><h4>Por facturar</h4><ul class="sw-license__log">${v.toBill.map((e) => `<li><span>${esc(e.dateText)}</span><span>${esc(e.detail)}</span><span class="sw-license__mono">${esc(e.moneyText)}</span><button type="button" data-license-billed="${esc(e.id)}">Marcar facturado</button></li>`).join('')}</ul></div>` : '';
  const history = v.historyCount ? `<details class="sw-license__history"><summary>Historial (${esc(v.historyCount)})</summary><ul class="sw-license__log">${v.history.map(eventLine).join('')}</ul></details>` : '';
  const suspendBtn = v.suspended ? `<button type="button" data-license-reactivate="${id}">Reactivar</button>` : `<button type="button" data-license-suspend="${id}">Suspender</button>`;
  return `<div class="sw-license" data-license-master="${id}"><p><b>Suscripción:</b> ${badge(v.status, v.statusLabel)} · vigencia hasta ${esc(v.validUntilText)}</p><p>${esc(v.usedText)} · Tarifa: ${esc(v.priceText)} · Total anual: ${esc(v.totalText)}</p>${terms}${pay}<div class="controls">${suspendBtn}</div>${billing}${msg}${history}</div>`;
}

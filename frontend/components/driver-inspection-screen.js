// SW-123: pantalla "Chequeo del camión" de la app del conductor. Solo pinta el modelo que recibe; las acciones son
// data-attributes que frontend/driver-app.js delega.
import { escapeHtml as e } from './button.js';

const SEV = { critical: 'Crítica', minor: 'Menor' };

function itemRow(item, r) {
  const st = r?.status;
  const state = st === 'fail' ? ` sw-insp__row--${r.severity === 'critical' ? 'crit' : 'minor'}` : st === 'ok' ? ' sw-insp__row--ok' : '';
  const sub = st === 'fail' ? `<small>${e(SEV[r.severity] ?? '')}${r.note ? ` · ${e(r.note)}` : ''}</small>` : '';
  return `<li class="sw-insp__row${state}"><span class="sw-insp__name">${e(item.label)}${sub}</span><span class="sw-insp__btns" role="group" aria-label="${e(item.label)}"><button type="button" class="sw-insp__b sw-insp__b--ok" data-driver-inspect-ok="${e(item.key)}" aria-pressed="${st === 'ok'}">Bien</button><button type="button" class="sw-insp__b sw-insp__b--fail" data-driver-inspect-fail="${e(item.key)}" aria-pressed="${st === 'fail'}">Falla</button></span></li>`;
}

export function renderDriverInspection({ unit = null, groups = [], results = {}, done = 0, total = 0, openDefects = [], sheet = null, errorMessage = '', busy = false } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const open = openDefects.length
    ? `<div class="sw-insp__open" role="status"><strong>Fallas abiertas de este camión</strong><ul>${openDefects.map((d) => `<li>${e(d.label)} · ${e(SEV[d.severity] ?? '')}</li>`).join('')}</ul></div>` : '';
  const list = groups.map((g) => {
    const allOk = g.items.every((i) => results[i.key]?.status === 'ok');
    return `<div class="sw-insp__group"><div class="sw-insp__ghead"><h3>${e(g.label)}</h3><button type="button" class="sw-insp__all" data-driver-inspect-group="${e(g.id)}">${allOk ? 'Todo bien ✓' : 'Todo bien'}</button></div><ul class="sw-insp__list">${g.items.map((i) => itemRow(i, results[i.key])).join('')}</ul></div>`;
  }).join('');
  const sheetHtml = sheet ? `<div class="sw-insp__sheet" role="dialog" aria-modal="true" aria-label="Falla en ${e(sheet.label)}"><h3>${e(sheet.label)}</h3>
    <div class="sw-insp__sev" role="group" aria-label="Gravedad"><button type="button" data-driver-inspect-sev="critical" aria-pressed="${sheet.severity === 'critical'}"><strong>Crítica</strong><span>No debería circular</span></button><button type="button" data-driver-inspect-sev="minor" aria-pressed="${sheet.severity === 'minor'}"><strong>Menor</strong><span>Puede salir</span></button></div>
    <label class="sw-driver__field-label" for="driverInspectNote">¿Qué pasa? (una frase)</label>
    <textarea class="sw-driver__input sw-insp__note" id="driverInspectNote" maxlength="300" rows="2">${e(sheet.note ?? '')}</textarea>
    <button type="button" class="sw-driver__cta" data-driver-inspect-save-fail${sheet.severity ? '' : ' disabled'}>Guardar falla</button>
    <button type="button" class="sw-driver__cta sw-driver__cta--ghost" data-driver-inspect-cancel-fail>Cancelar</button></div>` : '';
  const err = errorMessage ? `<p class="sw-driver__error" role="alert">${e(errorMessage)}</p>` : '';
  const ready = total > 0 && done === total;
  return `<section class="sw-driver sw-driver--inspect" aria-label="Chequeo del camión">
    <header class="sw-driver__head"><div><p class="sw-driver__date">Antes de salir · Camión ${e(unit ?? '—')}</p><h1>Chequeo del camión</h1></div></header>
    <div class="sw-insp__prog" aria-label="Avance del chequeo"><div class="sw-insp__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct}%"></i></div><span>${done} de ${total}</span></div>
    ${open}${list}${err}
    <button type="button" class="sw-driver__cta" data-driver-inspect-submit${ready && !busy ? '' : ' disabled'}>${ready ? (busy ? 'Guardando…' : 'Continuar') : `Faltan ${total - done} puntos`}</button>
    <button type="button" class="sw-driver__cta sw-driver__cta--ghost" data-driver-inspect-back>Volver</button>
    ${sheetHtml}
  </section>`;
}

// Resultado del chequeo cuando el ayuntamiento no permite salir con falla crítica.
export function renderDriverInspectionBlocked({ unit = null, critical = [], message = '' } = {}) {
  return `<section class="sw-driver sw-driver--inspect" aria-label="Chequeo con falla crítica">
    <header class="sw-driver__head"><div><p class="sw-driver__date">Camión ${e(unit ?? '—')}</p><h1>No puedes iniciar la ruta</h1></div></header>
    <div class="sw-insp__open sw-insp__open--crit" role="alert"><strong>${e(message || 'Hay una falla crítica y este ayuntamiento no permite salir.')}</strong><ul>${critical.map((c) => `<li>${e(c)}</li>`).join('')}</ul></div>
    <p class="sw-driver__sub">El chequeo quedó guardado y el administrador ya fue avisado. Cuando la falla se atienda, vuelve a hacer el chequeo.</p>
    <button type="button" class="sw-driver__cta" data-driver-inspect-back>Volver a Hoy</button>
  </section>`;
}

// SW-124: bandeja "Fallas de los camiones" (Flota). Solo pinta el modelo; las acciones son data-attributes que app.js delega.
import { escapeHtml as e } from './button.js';

const STATUS = { reported: 'Reportada', in_review: 'En revisión', fixed: 'Corregida', verified: 'Verificada' };
const SEV = { critical: 'Crítica', minor: 'Menor' };
// Acciones disponibles por estado (coinciden con las transiciones del servidor).
const ACTIONS = {
  reported: [{ to: 'in_review', label: 'Tomar en revisión' }, { to: 'fixed', label: 'Marcar corregida' }],
  in_review: [{ to: 'fixed', label: 'Marcar corregida' }, { to: 'reported', label: 'Devolver a reportada' }],
  fixed: [{ to: 'verified', label: 'Verificar y cerrar' }, { to: 'in_review', label: 'Reabrir' }],
  verified: []
};

function ago(iso, now) {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'hace menos de una hora';
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function card(d, codeOf, now, busyId) {
  const acts = ACTIONS[d.status] ?? [];
  const busy = busyId === d.id;
  return `<li class="sw-defect sw-defect--${d.severity === 'critical' ? 'crit' : 'minor'}" data-defect-card="${e(d.id)}">
    <div class="sw-defect__top"><strong>Camión ${e(codeOf.get(d.vehicle_id) ?? '—')} · ${e(d.label)}</strong><span class="sw-defect__tags"><span class="sw-defect__sev">${e(SEV[d.severity] ?? '')}</span><span class="sw-defect__st">${e(STATUS[d.status] ?? d.status)}</span></span></div>
    <p class="sw-defect__meta">Reportada ${e(ago(d.reported_at, now))}${d.note ? ` · “${e(d.note)}”` : ''}${d.resolution_note ? ` · Nota: ${e(d.resolution_note)}` : ''}</p>
    ${acts.length ? `<div class="sw-defect__acts"><input class="sw-defect__note" type="text" maxlength="300" placeholder="Nota (opcional)" aria-label="Nota para ${e(d.label)}" data-defect-note="${e(d.id)}"${busy ? ' disabled' : ''}>${acts.map((a) => `<button type="button" class="sw-defect__btn" data-defect-id="${e(d.id)}" data-defect-to="${e(a.to)}"${busy ? ' disabled' : ''}>${e(a.label)}</button>`).join('')}</div>` : ''}
  </li>`;
}

export function renderDefectsPanel({ defects = [], vehicles = [], compliance = null, error = '', status = '', busyId = null, loaded = true, now = new Date() } = {}) {
  const codeOf = new Map(vehicles.map((v) => [v.id, v.code]));
  const crit = defects.filter((d) => d.severity === 'critical').length;
  const comp = compliance && compliance.total
    ? `<p class="sw-defect__comp" role="status"><strong>${compliance.checked} de ${compliance.total}</strong> camiones con ruta hoy ya hicieron el chequeo.${compliance.leftWithout.length ? ` <span class="sw-defect__warn">Salieron sin chequeo: ${compliance.leftWithout.map(e).join(', ')}.</span>` : ''}${compliance.pending.length ? ` Pendientes: ${compliance.pending.map(e).join(', ')}.` : ''}</p>`
    : '';
  const body = !loaded ? '<p class="demo">Cargando fallas…</p>'
    : defects.length ? `<ul class="sw-defect__list">${defects.map((d) => card(d, codeOf, now, busyId)).join('')}</ul>`
    : '<p class="demo">Sin fallas abiertas. Cuando un chofer reporte una en su chequeo, aparecerá aquí.</p>';
  return `<section class="sw-defects" aria-label="Fallas de los camiones">
    <div class="sw-defects__head"><h3>Fallas de los camiones</h3>${defects.length ? `<span class="sw-defects__count">${defects.length} abiertas${crit ? ` · ${crit} crítica${crit === 1 ? '' : 's'}` : ''}</span>` : ''}</div>
    ${comp}${error ? `<p class="sw-defect__error" role="alert">${e(error)}</p>` : ''}${status ? `<p class="demo" role="status">${e(status)}</p>` : ''}${body}
  </section>`;
}

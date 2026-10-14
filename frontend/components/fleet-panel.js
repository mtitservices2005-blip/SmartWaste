// SW-084: lista de flota del centro de control. HTML puro; cada fila es un botón con data-truck,
// que es lo que app.js ya escucha para abrir el detalle del camión.
import { escapeHtml } from './button.js';
import { badge } from './badge.js';
import { emptyState } from './empty-state.js';

const STATUS_BY_STATE = {
  active: { badge: 'en-ruta', label: 'En ruta', kpi: 'en_ruta' },
  delayed: { badge: 'en-ruta', label: 'Con retraso', kpi: 'en_ruta' },
  stopped: { badge: 'detenido', label: 'Detenido', kpi: 'detenido' },
  completed: { badge: 'disponible', label: 'Completada', kpi: 'disponible' },
  offline: { badge: 'sin-senal', label: 'Sin señal', kpi: 'sin_senal' },
  maintenance: { badge: 'fuera-servicio', label: 'En mantenimiento', kpi: 'fuera_servicio' }
};

export function mapTruckStatus(state) {
  return STATUS_BY_STATE[state] ?? { badge: 'fuera-servicio', label: 'Sin estado', kpi: 'fuera_servicio' };
}

export function renderFleetList({ trucks = [], selectedId = null } = {}) {
  const count = `${trucks.length} ${trucks.length === 1 ? 'camión' : 'camiones'}`;
  const head = `<div class="sw-fleet__head"><strong>Flota</strong><span>${count}</span></div>`;
  if (!trucks.length) return `${head}${emptyState({ title: 'Todavía no hay camiones', message: 'Registra un camión en Flotilla para verlo aquí.' })}`;
  const rows = trucks.map((t) => {
    const s = mapTruckStatus(t.state);
    const cls = ['sw-truck', t.id === selectedId ? 'selected' : '', s.kpi === 'sin_senal' ? 'sw-truck--alert' : ''].filter(Boolean).join(' ');
    const route = t.routeName ? `${escapeHtml(t.routeName)} · ${Math.round(t.progress ?? 0)}%` : 'Sin ruta';
    return `<li><button type="button" class="${cls}" data-truck="${escapeHtml(t.id)}"><span class="sw-truck__top"><span class="sw-truck__unit">${escapeHtml(t.unit)}</span>${badge({ status: s.badge, label: s.label })}</span><span class="sw-truck__sub">${route}${t.updatedAt ? ` · ${escapeHtml(t.updatedAt)}` : ''}</span></button></li>`;
  }).join('');
  return `${head}<ul class="sw-fleet__list">${rows}</ul>`;
}

// SW-087: pantallas de Flotilla del diseño Mando (pestañas, tablas y paneles de alta). HTML puro (sin DOM ni red).
// Los ids de los campos y los data-fleet de los botones son los que app.js ya usa para dar de alta.
import { escapeHtml } from './button.js';
import { badge } from './badge.js';
import { emptyState } from './empty-state.js';
import { mapTruckStatus } from './fleet-panel.js';

const TABS = [{ key: 'camiones', label: 'Camiones' }, { key: 'conductores', label: 'Conductores' }];

export function renderFleetTabs({ tab = 'camiones' } = {}) {
  return `<div class="sw-fleet-tabs" role="group" aria-label="Flotilla">${TABS.map((t) => `<button type="button" class="sw-fleet-tab" data-fleet-tab="${t.key}" aria-pressed="${t.key === tab}">${t.label}</button>`).join('')}</div>`;
}

const table = (caption, heads, body) => `<div class="sw-routes__scroll"><table class="sw-routes__table sw-fleet-table"><caption class="sw-visually-hidden">${caption}</caption><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;

export function renderVehiclesTable({ rows = [], selectedId = null } = {}) {
  if (!rows.length) return emptyState({ title: 'Todavía no hay camiones', message: 'Añade el primero con el panel de la derecha.' });
  const body = rows.map((r) => {
    const s = mapTruckStatus(r.state);
    const muted = '<span class="sw-metrics__muted">Sin configurar</span>';
    const sel = r.id !== undefined && r.id === selectedId;
    return `<tr class="sw-routes__row${sel ? ' selected' : ''}" data-vehicle="${escapeHtml(r.id)}" tabindex="0" aria-selected="${sel}"><td class="sw-routes__name">${escapeHtml(r.unit)}</td><td class="sw-routes__num">${escapeHtml(r.plate)}</td><td class="sw-routes__num">${escapeHtml(r.maxStops)}</td><td class="sw-routes__num">${r.efficiency ? escapeHtml(r.efficiency) : muted}</td><td>${r.fuelType ? escapeHtml(r.fuelType) : '<span class="sw-metrics__muted">—</span>'}</td><td>${badge({ status: s.badge, label: s.label })}</td></tr>`;
  }).join('');
  return table('Camiones', ['Unidad', 'Matrícula', 'Paradas máx.', 'Rendimiento', 'Combustible', 'Estado'], body);
}

export function renderDriversTable({ rows = [] } = {}) {
  if (!rows.length) return emptyState({ title: 'Todavía no hay conductores', message: 'Añade el primero con el panel de la derecha.' });
  const body = rows.map((r) => `<tr><td class="sw-routes__name">${escapeHtml(r.name)}</td><td class="sw-routes__num">${escapeHtml(r.phone)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.unit)}</td><td><span class="sw-fleet-access sw-fleet-access--${r.hasAccess ? 'on' : 'off'}">${escapeHtml(r.accessLabel)}</span></td></tr>`).join('');
  return table('Conductores', ['Nombre', 'Teléfono', 'Correo', 'Camión', 'App'], body);
}

export function renderVehicleForm({ maxStops = 20, vehicle = null } = {}) {
  const edit = Boolean(vehicle);
  const v = vehicle ?? {};
  const fuel = v.fuelTypeKey === 'gasolina' ? 'gasolina' : 'diesel';
  const unitAttrs = edit ? ` value="${escapeHtml(v.unit)}" readonly` : ' placeholder="Ejemplo: C-06"';
  const plateAttrs = edit ? ` value="${escapeHtml(v.plate === '—' ? '' : v.plate)}"` : ' placeholder="Ejemplo: L 998877"';
  const stopsValue = edit ? (v.maxStops === '—' ? maxStops : v.maxStops) : maxStops;
  return `<section class="sw-fleet-form" aria-labelledby="fleetVehicleTitle"><h3 id="fleetVehicleTitle">${edit ? 'Editar camión' : 'Añadir camión'}</h3>
    <div class="sw-newroute__field"><label for="fleetVehicleUnit">Unidad</label><input id="fleetVehicleUnit" autocomplete="off"${unitAttrs}></div>
    <div class="sw-newroute__field"><label for="fleetVehiclePlate">Matrícula</label><input id="fleetVehiclePlate" autocomplete="off"${plateAttrs}></div>
    <div class="sw-newroute__field"><label for="fleetVehicleMaxStops">Paradas máximas por viaje</label><input id="fleetVehicleMaxStops" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(stopsValue)}"></div>
    <div class="sw-newroute__field"><label for="fleetVehicleEfficiency">Rendimiento (km por litro) <span>(opcional)</span></label><input id="fleetVehicleEfficiency" inputmode="decimal" autocomplete="off" placeholder="Ejemplo: 2,2" value="${escapeHtml(edit ? v.efficiencyValue ?? '' : '')}"></div>
    <div class="sw-newroute__field"><label for="fleetVehicleFuelType">Combustible</label><select id="fleetVehicleFuelType"><option value="diesel"${fuel === 'diesel' ? ' selected' : ''}>Diésel</option><option value="gasolina"${fuel === 'gasolina' ? ' selected' : ''}>Gasolina</option></select><small class="sw-fleet-form__hint">Si dejas el rendimiento vacío, el consumo y el CO₂ de este camión no se calculan.</small></div>
    <button type="button" class="sw-rutas__btn sw-rutas__btn--primary" data-fleet="${edit ? 'update-vehicle' : 'create-vehicle'}"${edit ? ` data-vehicle-id="${escapeHtml(v.id)}"` : ''}>Guardar camión</button>
    ${edit ? '<button type="button" class="sw-rutas__btn" data-fleet="new-vehicle">Añadir otro camión</button>' : ''}
    <p id="fleetVehicleStatus" class="sw-newroute__status" role="status"></p></section>`;
}

export function renderDriverForm() {
  return `<section class="sw-fleet-form" aria-labelledby="fleetDriverTitle"><h3 id="fleetDriverTitle">Añadir conductor</h3>
    <div class="sw-newroute__field"><label for="fleetDriverName">Nombre</label><input id="fleetDriverName" autocomplete="off" placeholder="Nombre y apellido"></div>
    <div class="sw-newroute__field"><label for="fleetDriverPhone">Teléfono</label><input id="fleetDriverPhone" type="tel" autocomplete="off" placeholder="809-555-0100"></div>
    <div class="sw-newroute__field"><label for="fleetDriverEmail">Correo <span>(opcional)</span></label><input id="fleetDriverEmail" type="email" autocomplete="off" placeholder="nombre@ejemplo.do"><small class="sw-fleet-form__hint">Con correo se crea su acceso a la app del conductor.</small></div>
    <button type="button" class="sw-rutas__btn sw-rutas__btn--primary" data-fleet="create-driver">Guardar conductor</button>
    <p id="fleetDriverStatus" class="sw-newroute__status" role="status"></p></section>`;
}

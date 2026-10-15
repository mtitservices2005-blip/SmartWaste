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

export function renderVehiclesTable({ rows = [] } = {}) {
  if (!rows.length) return emptyState({ title: 'Todavía no hay camiones', message: 'Añade el primero con el panel de la derecha.' });
  const body = rows.map((r) => {
    const s = mapTruckStatus(r.state);
    return `<tr><td class="sw-routes__name">${escapeHtml(r.unit)}</td><td class="sw-routes__num">${escapeHtml(r.plate)}</td><td class="sw-routes__num">${escapeHtml(r.maxStops)}</td><td>${badge({ status: s.badge, label: s.label })}</td></tr>`;
  }).join('');
  return table('Camiones', ['Unidad', 'Matrícula', 'Paradas máx.', 'Estado'], body);
}

export function renderDriversTable({ rows = [] } = {}) {
  if (!rows.length) return emptyState({ title: 'Todavía no hay conductores', message: 'Añade el primero con el panel de la derecha.' });
  const body = rows.map((r) => `<tr><td class="sw-routes__name">${escapeHtml(r.name)}</td><td class="sw-routes__num">${escapeHtml(r.phone)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.unit)}</td><td><span class="sw-fleet-access sw-fleet-access--${r.hasAccess ? 'on' : 'off'}">${escapeHtml(r.accessLabel)}</span></td></tr>`).join('');
  return table('Conductores', ['Nombre', 'Teléfono', 'Correo', 'Camión', 'App'], body);
}

export function renderVehicleForm({ maxStops = 20 } = {}) {
  return `<section class="sw-fleet-form" aria-labelledby="fleetVehicleTitle"><h3 id="fleetVehicleTitle">Añadir camión</h3>
    <div class="sw-newroute__field"><label for="fleetVehicleUnit">Unidad</label><input id="fleetVehicleUnit" autocomplete="off" placeholder="Ejemplo: C-06"></div>
    <div class="sw-newroute__field"><label for="fleetVehiclePlate">Matrícula</label><input id="fleetVehiclePlate" autocomplete="off" placeholder="Ejemplo: L 998877"></div>
    <div class="sw-newroute__field"><label for="fleetVehicleMaxStops">Paradas máximas por viaje</label><input id="fleetVehicleMaxStops" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(maxStops)}"></div>
    <button type="button" class="sw-rutas__btn sw-rutas__btn--primary" data-fleet="create-vehicle">Guardar camión</button>
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

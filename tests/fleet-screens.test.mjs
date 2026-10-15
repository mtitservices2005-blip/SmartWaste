// SW-087: pantallas de Flotilla (HTML puro, sin DOM).
import assert from 'node:assert/strict';
import { renderFleetTabs, renderVehiclesTable, renderDriversTable, renderVehicleForm, renderDriverForm } from '../frontend/components/fleet-screens.js';

const tabs = renderFleetTabs({ tab: 'conductores' });
assert.match(tabs, /data-fleet-tab="camiones"[^>]*aria-pressed="false"/);
assert.match(tabs, /data-fleet-tab="conductores"[^>]*aria-pressed="true"/);
assert.match(tabs, />Camiones</); assert.match(tabs, />Conductores</);

const vt = renderVehiclesTable({ rows: [
  { id: 't1', unit: 'C-<01>', plate: 'L 123456', maxStops: '20', state: 'active' },
  { id: 't2', unit: 'C-05', plate: '—', maxStops: '—', state: 'offline' }
] });
for (const h of ['Unidad', 'Matrícula', 'Paradas máx.', 'Estado']) assert.match(vt, new RegExp(`<th scope="col">${h}</th>`));
assert.ok(vt.includes('C-&lt;01&gt;') && !vt.includes('<01>'), 'escapa texto');
assert.match(vt, /sw-badge--en-ruta/); assert.match(vt, /Sin señal/);
assert.match(renderVehiclesTable({ rows: [] }), /Todavía no hay camiones/);

const dt = renderDriversTable({ rows: [
  { id: 'd1', name: 'Carlos Peña', phone: '809-555-0101', email: 'carlos@ejemplo.do', unit: 'C-01', hasAccess: true, accessLabel: 'Con acceso' },
  { id: 'd2', name: 'Pedro Díaz', phone: '—', email: '—', unit: '—', hasAccess: false, accessLabel: 'Sin acceso' }
] });
for (const h of ['Nombre', 'Teléfono', 'Correo', 'Camión', 'App']) assert.match(dt, new RegExp(`<th scope="col">${h}</th>`));
assert.match(dt, /sw-fleet-access sw-fleet-access--on[^>]*>Con acceso</);
assert.match(dt, /sw-fleet-access sw-fleet-access--off[^>]*>Sin acceso</);
assert.match(renderDriversTable({ rows: [] }), /Todavía no hay conductores/);

const vf = renderVehicleForm();
assert.match(vf, /Añadir camión/);
for (const id of ['fleetVehicleUnit', 'fleetVehiclePlate', 'fleetVehicleMaxStops']) assert.match(vf, new RegExp(`id="${id}"`));
assert.match(vf, /placeholder="Ejemplo: C-06"/); assert.match(vf, /placeholder="Ejemplo: L 998877"/);
assert.match(vf, /id="fleetVehicleMaxStops"[^>]*value="20"/);
assert.match(vf, /data-fleet="create-vehicle">Guardar camión</);
assert.match(vf, /id="fleetVehicleStatus"/);

const df = renderDriverForm();
assert.match(df, /Añadir conductor/);
for (const id of ['fleetDriverName', 'fleetDriverPhone', 'fleetDriverEmail']) assert.match(df, new RegExp(`id="${id}"`));
assert.match(df, /Correo <span>\(opcional\)<\/span>/);
assert.match(df, /Con correo se crea su acceso a la app del conductor\./);
assert.match(df, /data-fleet="create-driver">Guardar conductor</);
assert.match(df, /id="fleetDriverStatus"/);
console.log('fleet-screens ok');

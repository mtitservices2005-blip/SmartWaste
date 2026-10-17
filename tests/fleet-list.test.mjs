// SW-087: Flotilla (camiones y conductores). Lógica pura: filas de las tablas, encabezados y validación de altas.
import assert from 'node:assert/strict';
import { validateFuelConfig, buildVehicleRows, buildDriverRows, fleetHeader, validateVehicleForm, validateDriverForm, DEFAULT_MAX_STOPS } from '../shared/fleet-list.js';

const trucks = [
  { id: 't1', unit: 'C-01', plate: 'L 123456', max_stops: 20, state: 'active', driverId: 'd1' },
  { id: 't2', unit: 'C-05', plate: '', max_stops: null, state: 'offline', driverId: null },
  { id: 't3', unit: 'C-04', plate: 'L 445566', max_stops: 20, state: 'stopped' }
];
const v = buildVehicleRows(trucks);
assert.deepEqual(v[0], { id: 't1', unit: 'C-01', plate: 'L 123456', maxStops: '20', state: 'active', efficiency: null, fuelType: null, efficiencyValue: '', fuelTypeKey: 'diesel' });
// SW-090: rendimiento y combustible del camión
const vf2 = buildVehicleRows([{ id: 'x', unit: 'C-9', fuel_efficiency_km_per_l: 2.2, fuel_type: 'gasolina' }])[0];
assert.equal(vf2.efficiency, '2,2 km/L'); assert.equal(vf2.fuelType, 'Gasolina'); assert.equal(vf2.efficiencyValue, '2.2'); assert.equal(vf2.fuelTypeKey, 'gasolina');
assert.equal(v[1].plate, '—');
assert.equal(v[1].maxStops, '—');
assert.equal(buildVehicleRows(undefined).length, 0);

const drivers = [
  { id: 'd1', name: 'Carlos Peña', phone: '809-555-0101', email: 'carlos@ejemplo.do' },
  { id: 'd2', name: 'Pedro Díaz', phone: '', email: '' },
  { id: 'd3', name: 'Ana Reyes', email: '  ana@ejemplo.do ' }
];
const d = buildDriverRows(drivers, trucks);
assert.deepEqual(d[0], { id: 'd1', name: 'Carlos Peña', phone: '809-555-0101', email: 'carlos@ejemplo.do', unit: 'C-01', hasAccess: true, accessLabel: 'Con acceso' });
assert.equal(d[1].phone, '—'); assert.equal(d[1].email, '—'); assert.equal(d[1].unit, '—');
assert.equal(d[1].hasAccess, false); assert.equal(d[1].accessLabel, 'Sin acceso');
assert.equal(d[2].email, 'ana@ejemplo.do', 'recorta espacios');
assert.equal(d[2].phone, '—');

assert.equal(fleetHeader({ tab: 'camiones', count: 5, demo: true }), '5 camiones registrados · datos de ejemplo');
assert.equal(fleetHeader({ tab: 'camiones', count: 1, demo: false }), '1 camión registrado');
assert.equal(fleetHeader({ tab: 'conductores', count: 4, demo: true }), '4 conductores registrados · datos de ejemplo');
assert.equal(fleetHeader({ tab: 'conductores', count: 1, demo: false }), '1 conductor registrado');
assert.equal(fleetHeader({ tab: 'camiones', count: 0, demo: false }), 'Aún no hay camiones registrados');
assert.equal(fleetHeader({ tab: 'conductores', count: 0, demo: true }), 'Aún no hay conductores registrados');

assert.equal(DEFAULT_MAX_STOPS, 20);
assert.deepEqual(validateVehicleForm({ unit: ' C-06 ', plate: ' L 998877 ', maxStops: '' }), { ok: true, values: { unit: 'C-06', plate: 'L 998877', maxStops: 20, efficiency: null, fuelType: 'diesel' } });
assert.deepEqual(validateVehicleForm({ unit: 'C-07', plate: '', maxStops: '18' }).values, { unit: 'C-07', plate: '', maxStops: 18, efficiency: null, fuelType: 'diesel' });
assert.equal(validateVehicleForm({ unit: '  ', plate: '', maxStops: '20' }).message, 'Ingresa la unidad del camión.');
for (const bad of ['0', '-3', '2.5', 'abc']) assert.equal(validateVehicleForm({ unit: 'C-1', maxStops: bad }).message, 'Las paradas máximas deben ser un número entero mayor que 0.', bad);

assert.deepEqual(validateDriverForm({ name: ' Luis Mejía ', phone: ' 809-555-0103 ', email: ' Luis@Ejemplo.do ' }), { ok: true, values: { name: 'Luis Mejía', phone: '809-555-0103', email: 'luis@ejemplo.do' } });
assert.deepEqual(validateDriverForm({ name: 'Pedro', phone: '', email: '' }).values, { name: 'Pedro', phone: '', email: undefined });
assert.equal(validateDriverForm({ name: ' ', phone: '', email: '' }).message, 'Ingresa el nombre y apellido del conductor.');
assert.equal(validateDriverForm({ name: 'Ana', phone: '', email: 'sin-arroba' }).message, 'Escribe un correo válido o déjalo en blanco.');
console.log('fleet-list ok');

// SW-090: validación de rendimiento (km/L) y combustible
assert.deepEqual(validateFuelConfig({ efficiency: '', fuelType: '' }), { ok: true, values: { efficiency: null, fuelType: 'diesel' } });
assert.deepEqual(validateFuelConfig({ efficiency: '2,2', fuelType: 'gasolina' }).values, { efficiency: 2.2, fuelType: 'gasolina' });
assert.deepEqual(validateFuelConfig({ efficiency: ' 4.5 ', fuelType: 'diesel' }).values, { efficiency: 4.5, fuelType: 'diesel' });
for (const bad of ['0', '-1', 'abc', '500']) assert.equal(validateFuelConfig({ efficiency: bad, fuelType: 'diesel' }).message, 'El rendimiento debe ser un número entre 0,1 y 100 km por litro.', bad);
assert.equal(validateFuelConfig({ efficiency: '3', fuelType: 'kerosene' }).message, 'Elige diésel o gasolina.');
assert.equal(validateVehicleForm({ unit: 'C-1', efficiency: '0' }).ok, false);
assert.deepEqual(validateVehicleForm({ unit: 'C-1', efficiency: '2,5', fuelType: 'gasolina' }).values, { unit: 'C-1', plate: '', maxStops: 20, efficiency: 2.5, fuelType: 'gasolina' });
console.log('fleet-list sw090: ok');

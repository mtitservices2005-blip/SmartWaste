// SW-087: Flotilla (camiones y conductores). Lógica pura (sin DOM ni red): filas de las tablas del diseño Mando,
// encabezados con conteo y validación de los dos formularios de alta.
import { FUEL_TYPES, FUEL_TYPE_LABELS } from './emission-factors.js';

export const DEFAULT_MAX_STOPS = 20;

const text = (value) => String(value ?? '').trim();
// SW-114: la base guarda km por litro; la pantalla muestra y recibe km por galón americano.
const KM_PER_GAL_FACTOR = 3.785411784;
const kmPerGallon = (value) => Math.round(Number(value) * KM_PER_GAL_FACTOR * 10) / 10;
const efficiencyLabel = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? `${String(kmPerGallon(n)).replace('.', ',')} km/gal` : null;
};
const orDash = (value) => text(value) || '—';

export function buildVehicleRows(trucks) {
  return (Array.isArray(trucks) ? trucks : []).map((t) => ({
    id: t.id,
    unit: orDash(t.unit),
    plate: orDash(t.plate),
    maxStops: Number.isFinite(Number(t.max_stops)) && t.max_stops !== null && t.max_stops !== '' ? String(t.max_stops) : '—',
    state: t.state,
    // SW-090: rendimiento (km/L) y combustible que digita el ayuntamiento; sin dato no se calcula consumo.
    efficiency: efficiencyLabel(t.fuel_efficiency_km_per_l),
    fuelType: FUEL_TYPE_LABELS[t.fuel_type] ?? null,
    efficiencyValue: efficiencyLabel(t.fuel_efficiency_km_per_l) ? String(kmPerGallon(t.fuel_efficiency_km_per_l)) : '',
    fuelTypeKey: FUEL_TYPES.includes(t.fuel_type) ? t.fuel_type : 'diesel'
  }));
}

export function buildDriverRows(drivers, trucks) {
  const truckList = Array.isArray(trucks) ? trucks : [];
  return (Array.isArray(drivers) ? drivers : []).map((d) => {
    const email = text(d.email);
    return {
      id: d.id,
      name: orDash(d.name),
      phone: orDash(d.phone),
      email: email || '—',
      unit: truckList.find((t) => t.driverId === d.id)?.unit ?? '—',
      hasAccess: Boolean(email),
      accessLabel: email ? 'Con acceso' : 'Sin acceso'
    };
  });
}

export function fleetHeader({ tab, count, demo }) {
  const one = tab === 'conductores' ? 'conductor' : 'camión';
  const many = tab === 'conductores' ? 'conductores' : 'camiones';
  if (!count) return `Aún no hay ${many} registrados`;
  const base = `${count} ${count === 1 ? `${one} registrado` : `${many} registrados`}`;
  return demo ? `${base} · datos de ejemplo` : base;
}

// SW-090: rendimiento (opcional) y tipo de combustible (diésel por defecto). SW-114: se escribe en km por galón y se guarda en km por litro.
export function validateFuelConfig({ efficiency, fuelType } = {}) {
  const raw = text(efficiency).replace(',', '.');
  let value = null;
  if (raw !== '') {
    value = Number(raw);
    if (!Number.isFinite(value) || value < 0.4 || value > 400) return { ok: false, message: 'El rendimiento debe ser un número entre 0,4 y 400 km por galón.' };
    value = Math.round((value / KM_PER_GAL_FACTOR) * 10000) / 10000;
  }
  const type = text(fuelType) || 'diesel';
  if (!FUEL_TYPES.includes(type)) return { ok: false, message: 'Elige diésel o gasolina.' };
  return { ok: true, values: { efficiency: value, fuelType: type } };
}

export function validateVehicleForm({ unit, plate, maxStops, efficiency, fuelType } = {}) {
  const cleanUnit = text(unit);
  if (!cleanUnit) return { ok: false, message: 'Ingresa la unidad del camión.' };
  const raw = text(maxStops);
  let max = DEFAULT_MAX_STOPS;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return { ok: false, message: 'Las paradas máximas deben ser un número entero mayor que 0.' };
    max = n;
  }
  const fuel = validateFuelConfig({ efficiency, fuelType });
  if (!fuel.ok) return fuel;
  return { ok: true, values: { unit: cleanUnit, plate: text(plate), maxStops: max, ...fuel.values } };
}

export function validateDriverForm({ name, phone, email } = {}) {
  const cleanName = text(name);
  if (!cleanName) return { ok: false, message: 'Ingresa el nombre y apellido del conductor.' };
  const mail = text(email).toLowerCase();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, message: 'Escribe un correo válido o déjalo en blanco.' };
  return { ok: true, values: { name: cleanName, phone: text(phone), email: mail || undefined } };
}

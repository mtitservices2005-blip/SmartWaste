// SW-087: Flotilla (camiones y conductores). Lógica pura (sin DOM ni red): filas de las tablas del diseño Mando,
// encabezados con conteo y validación de los dos formularios de alta.
export const DEFAULT_MAX_STOPS = 20;

const text = (value) => String(value ?? '').trim();
const orDash = (value) => text(value) || '—';

export function buildVehicleRows(trucks) {
  return (Array.isArray(trucks) ? trucks : []).map((t) => ({
    id: t.id,
    unit: orDash(t.unit),
    plate: orDash(t.plate),
    maxStops: Number.isFinite(Number(t.max_stops)) && t.max_stops !== null && t.max_stops !== '' ? String(t.max_stops) : '—',
    state: t.state
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

export function validateVehicleForm({ unit, plate, maxStops } = {}) {
  const cleanUnit = text(unit);
  if (!cleanUnit) return { ok: false, message: 'Ingresa la unidad del camión.' };
  const raw = text(maxStops);
  let max = DEFAULT_MAX_STOPS;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return { ok: false, message: 'Las paradas máximas deben ser un número entero mayor que 0.' };
    max = n;
  }
  return { ok: true, values: { unit: cleanUnit, plate: text(plate), maxStops: max } };
}

export function validateDriverForm({ name, phone, email } = {}) {
  const cleanName = text(name);
  if (!cleanName) return { ok: false, message: 'Ingresa el nombre y apellido del conductor.' };
  const mail = text(email).toLowerCase();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, message: 'Escribe un correo válido o déjalo en blanco.' };
  return { ok: true, values: { name: cleanName, phone: text(phone), email: mail || undefined } };
}

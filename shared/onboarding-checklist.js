// SW-121: lista de "Primeros pasos" para el administrador de un ayuntamiento nuevo. Se marca sola con los datos reales:
// nadie tiene que tildar nada, y desaparece cuando todo está listo. Puro.
const hasEfficiency = (t) => Number(t?.fuel_efficiency_km_per_l) > 0;

export function buildChecklist({ profileConfigured = false, costConfigured = false, trucks = [], drivers = [], routes = [] } = {}) {
  const missingEff = trucks.filter((t) => !hasEfficiency(t)).length;
  const trucksDone = trucks.length > 0 && missingEff === 0;
  const items = [
    { id: 'datos', label: 'Datos del ayuntamiento', done: Boolean(profileConfigured), hint: 'Nombre oficial, logo, contacto y firmantes de los reportes.', href: '#configuracion', action: 'Completar datos' },
    { id: 'costos', label: 'Parámetros de costo', done: Boolean(costConfigured), hint: 'Precio del combustible, días de operación y costo por hora.', href: '#configuracion', action: 'Configurar costos' },
    { id: 'camiones', label: 'Camiones con su rendimiento', done: trucksDone, hint: trucks.length === 0 ? 'Registra tus camiones y su rendimiento en km por galón.' : `Faltan ${missingEff} ${missingEff === 1 ? 'camión' : 'camiones'} sin rendimiento (km por galón).`, href: '#operaciones/flota', action: trucks.length === 0 ? 'Registrar camiones' : 'Completar rendimiento' },
    { id: 'choferes', label: 'Choferes', done: drivers.length > 0, hint: 'Registra a quienes manejan y dales su acceso a la app.', href: '#operaciones/flota', action: 'Registrar choferes' },
    { id: 'ruta', label: 'Primera ruta', done: routes.length > 0, hint: 'Dibuja una ruta en el mapa con al menos 2 puntos.', href: '#operaciones/rutas', action: 'Crear ruta' }
  ];
  const doneCount = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done) ?? null;
  return { items, doneCount, total: items.length, complete: doneCount === items.length, nextId: next?.id ?? null, percent: Math.round((doneCount / items.length) * 100) };
}

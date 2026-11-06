// SW-083: registro de combustible al finalizar el recorrido (opcional pero recomendado).
const MAX_LITERS = 500;

// Acepta coma o punto decimal. Vacío = omitido. Rechaza <= 0, > 500 y texto con mensaje en español.
export function parseFuelLiters(input) {
  const text = String(input ?? '').trim();
  if (text === '') return { ok: true, liters: null };
  if (!/^\d+([.,]\d+)?$/.test(text)) return { ok: false, message: 'Escribe solo números en los litros, por ejemplo 45,5.' };
  const liters = Number(text.replace(',', '.'));
  if (!(liters > 0)) return { ok: false, message: 'Escribe los litros cargados (mayor que 0).' };
  if (liters > MAX_LITERS) return { ok: false, message: `Los litros no pueden pasar de ${MAX_LITERS}. Revisa el número.` };
  return { ok: true, liters };
}

// SW-114: el conductor anota galones americanos; el registro se guarda en litros (como la base).
const MAX_GALLONS = 130;
export function parseFuelGallons(input) {
  const text = String(input ?? '').trim();
  if (text === '') return { ok: true, gallons: null, liters: null };
  if (!/^\d+([.,]\d+)?$/.test(text)) return { ok: false, message: 'Escribe solo números en los galones, por ejemplo 5,5.' };
  const gallons = Number(text.replace(',', '.'));
  if (!(gallons > 0)) return { ok: false, message: 'Escribe los galones cargados (mayor que 0).' };
  if (gallons > MAX_GALLONS) return { ok: false, message: `Los galones no pueden pasar de ${MAX_GALLONS}. Revisa el número.` };
  return { ok: true, gallons, liters: Math.round(gallons * 3.785411784 * 100) / 100 };
}

// Arma el registro con el camión y la corrida de la asignación del chofer. Sin litros o sin camión: null.
export function buildFuelEntry({ liters, assignment, municipalityId }) {
  if (liters == null || !assignment?.vehicle_id) return null;
  return {
    vehicle_id: assignment.vehicle_id,
    route_run_id: assignment.route_run_id ?? null,
    liters,
    municipality_id: municipalityId
  };
}

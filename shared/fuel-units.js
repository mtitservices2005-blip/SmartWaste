// SW-114: el combustible se muestra y se captura en galones americanos. La base de datos sigue en litros
// (vehicles.fuel_efficiency_km_per_l, fuel_logs.liters), así que aquí se convierte en la entrada y la salida.
export const LITERS_PER_GALLON = 3.785411784;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export const litersToGallons = (liters) => (Number.isFinite(Number(liters)) && liters !== null ? Number(liters) / LITERS_PER_GALLON : null);
export const gallonsToLiters = (gallons) => (Number.isFinite(Number(gallons)) && gallons !== null ? Number(gallons) * LITERS_PER_GALLON : null);
// km por litro ↔ km por galón (el rendimiento sube 3,785 veces al medirlo por galón).
export const kmPerLiterToKmPerGallon = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) * LITERS_PER_GALLON : null);
export const kmPerGallonToKmPerLiter = (v) => (Number.isFinite(Number(v)) && v !== null ? round(Number(v) / LITERS_PER_GALLON, 4) : null);
// RD$ por litro ↔ RD$ por galón.
export const pricePerLiterToPerGallon = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) * LITERS_PER_GALLON : null);
export const pricePerGallonToPerLiter = (v) => (Number.isFinite(Number(v)) && v !== null ? round(Number(v) / LITERS_PER_GALLON, 4) : null);
export const co2KgPerGallon = (kgPerLiter) => round(Number(kgPerLiter) * LITERS_PER_GALLON, 2);

// SW-090: factores de emisión fijos (D3). Solo emisiones directas del escape; son aproximaciones
// visibles en la interfaz, no mediciones. Un Master Admin podrá editarlos más adelante.

export const EMISSION_FACTORS = { diesel: 2.68, gasolina: 2.31 }; // kg CO₂ por litro
export const FUEL_TYPE_LABELS = { diesel: 'Diésel', gasolina: 'Gasolina' };
export const FUEL_TYPES = Object.keys(EMISSION_FACTORS);
export const EMISSION_NOTICE = 'Huella de carbono: estimación basada en km medidos y consumo configurado (emisiones directas del escape).';

export function co2KgForLiters(liters, fuelType) {
  const l = Number(liters);
  const factor = EMISSION_FACTORS[fuelType];
  if (!Number.isFinite(l) || l <= 0 || factor === undefined) return null;
  return Math.round(l * factor * 100) / 100;
}

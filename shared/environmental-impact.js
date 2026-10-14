// SW-075: environmental impact estimate for the Centro de Impacto y Ahorros — kg of waste collected
// and CO2 avoided. Pure (no network, no DOM). Deliberately NOT part of shared/cost-parameters.js:
// those keys drive the per-municipality settings form and must all be present on save, and nothing
// in the schema measures waste weight or fuel burned today. These are fixed, visible assumptions
// (rule 6: no real-data claims without evidence; rule 7: keep the demo/estimate label), shown to the
// user alongside the result so nobody mistakes them for measurements.

export const ENVIRONMENTAL_ASSUMPTIONS = {
  // Supuesto: promedio de residuos presentados por casa en cada recolección (kg).
  kgPerStop: 8,
  // Supuesto: kg de CO2 emitidos por litro de diésel quemado.
  co2KgPerLiter: 2.68
};

export const ENVIRONMENTAL_NOTICE = 'Valores estimados con supuestos fijos · datos demo, no son mediciones reales';

const round = (value, digits) => Number(value.toFixed(digits));
const finiteOrZero = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// kg = completedStops x kgPerStop. CO2 = (avoidedKm / fuelEfficiency) liters x co2KgPerLiter.
// fuelEfficiency is a divisor: when it is not a positive number (or avoidedKm is missing), liters and CO2 are null
// ("pendiente de datos") instead of Infinity/NaN; kg does not depend on it and still computes.
export function calculateEnvironmentalImpact({ completedStops, avoidedKm, fuelEfficiency } = {}, assumptions = ENVIRONMENTAL_ASSUMPTIONS) {
  const stops = Math.max(0, finiteOrZero(completedStops));
  // Missing avoided km ("pendiente de datos") is not the same as 0 km avoided.
  const hasKm = avoidedKm !== null && avoidedKm !== undefined && Number.isFinite(Number(avoidedKm));
  const km = hasKm ? Math.max(0, Number(avoidedKm)) : 0;
  const efficiency = Number(fuelEfficiency);
  const hasEfficiency = Number.isFinite(efficiency) && efficiency > 0;
  const liters = hasEfficiency && hasKm ? km / efficiency : null;
  return {
    estimatedKg: round(stops * Number(assumptions.kgPerStop), 1),
    avoidedLiters: liters === null ? null : round(liters, 2),
    avoidedCo2Kg: liters === null ? null : round(liters * Number(assumptions.co2KgPerLiter), 2),
    assumptions,
    notice: ENVIRONMENTAL_NOTICE
  };
}

// Total stops across measured (started_at and completed_at) route runs: each run counts its route's
// stop count. Unmeasured runs, and runs on routes with no known stops, contribute nothing. This is an
// estimate — route_runs does not record which individual stops were collected (that state is
// derived from GPS on the fly, route-engine.js's deriveStopStatus), so a completed run is treated
// as having served all of its route's stops.
export function countCompletedStops(routeRuns, stopCountsByRouteId) {
  const counts = stopCountsByRouteId ?? {};
  return (routeRuns ?? []).reduce((total, run) => {
    if (!run.started_at || !run.completed_at) return total;
    const stops = Number(counts[run.route_id]);
    return total + (Number.isFinite(stops) && stops > 0 ? stops : 0);
  }, 0);
}

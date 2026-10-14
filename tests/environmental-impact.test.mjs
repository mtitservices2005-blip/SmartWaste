import assert from 'node:assert/strict';
import { ENVIRONMENTAL_ASSUMPTIONS, ENVIRONMENTAL_NOTICE, calculateEnvironmentalImpact, countCompletedStops } from '../shared/environmental-impact.js';

// SW-075: the assumptions are fixed, visible constants — not measurements. They must exist, be
// positive numbers, and the notice must say the figures are estimated (rule 7: demo/estimate label).
assert.ok(ENVIRONMENTAL_ASSUMPTIONS.kgPerStop > 0, 'kgPerStop is a positive visible assumption');
assert.ok(ENVIRONMENTAL_ASSUMPTIONS.co2KgPerLiter > 0, 'co2KgPerLiter is a positive visible assumption');
assert.match(ENVIRONMENTAL_NOTICE, /estimad/i);

// kg = completed stops x kgPerStop; CO2 = (avoidedKm / fuelEfficiency) liters x co2KgPerLiter.
const assumptions = { kgPerStop: 10, co2KgPerLiter: 2.5 };
const impact = calculateEnvironmentalImpact({ completedStops: 12, avoidedKm: 9.6, fuelEfficiency: 4.8 }, assumptions);
assert.equal(impact.estimatedKg, 120);
assert.equal(impact.avoidedLiters, 2);
assert.equal(impact.avoidedCo2Kg, 5);
assert.deepEqual(impact.assumptions, assumptions, 'the assumptions used travel with the result so the UI can show them');
assert.equal(impact.notice, ENVIRONMENTAL_NOTICE);

// Defaults come from ENVIRONMENTAL_ASSUMPTIONS when none are passed.
const withDefaults = calculateEnvironmentalImpact({ completedStops: 2, avoidedKm: 0, fuelEfficiency: 4.8 });
assert.equal(withDefaults.estimatedKg, 2 * ENVIRONMENTAL_ASSUMPTIONS.kgPerStop);
assert.equal(withDefaults.avoidedCo2Kg, 0);

// Never invent or flip numbers: negative avoided km clamps to 0; zero stops is a real 0 kg.
assert.equal(calculateEnvironmentalImpact({ completedStops: 0, avoidedKm: -5, fuelEfficiency: 4.8 }, assumptions).avoidedCo2Kg, 0);
assert.equal(calculateEnvironmentalImpact({ completedStops: 0, avoidedKm: 3, fuelEfficiency: 4.8 }, assumptions).estimatedKg, 0);

// fuelEfficiency is a divisor: zero/negative/missing must not produce Infinity/NaN — liters and CO2
// become null ("pendiente de datos"), while kg (which does not depend on it) still computes.
for (const badEfficiency of [0, -1, undefined, NaN]) {
  const r = calculateEnvironmentalImpact({ completedStops: 3, avoidedKm: 4, fuelEfficiency: badEfficiency }, assumptions);
  assert.equal(r.avoidedLiters, null, `fuelEfficiency=${badEfficiency} -> liters null`);
  assert.equal(r.avoidedCo2Kg, null, `fuelEfficiency=${badEfficiency} -> CO2 null`);
  assert.equal(r.estimatedKg, 30);
}

// Non-finite stop counts are treated as 0, not NaN.
assert.equal(calculateEnvironmentalImpact({ completedStops: undefined, avoidedKm: 1, fuelEfficiency: 4.8 }, assumptions).estimatedKg, 0);

// Missing avoided km (no real route comparison available yet) is "pendiente de datos", never a
// fabricated 0 kg of CO2 avoided — kg of waste (which does not depend on it) still computes.
for (const missingKm of [undefined, null, NaN]) {
  const r = calculateEnvironmentalImpact({ completedStops: 3, avoidedKm: missingKm, fuelEfficiency: 4.8 }, assumptions);
  assert.equal(r.avoidedLiters, null, `avoidedKm=${missingKm} -> liters null`);
  assert.equal(r.avoidedCo2Kg, null, `avoidedKm=${missingKm} -> CO2 null`);
  assert.equal(r.estimatedKg, 30);
}

// countCompletedStops: a measured run (both started_at and completed_at) contributes its route's
// stop count; unmeasured runs and routes with no known stops contribute nothing.
const runs = [
  { route_id: 'A', started_at: '2026-09-01T08:00:00Z', completed_at: '2026-09-01T09:00:00Z' },
  { route_id: 'A', started_at: '2026-09-02T08:00:00Z', completed_at: '2026-09-02T09:00:00Z' },
  { route_id: 'B', started_at: '2026-09-02T10:00:00Z', completed_at: '2026-09-02T10:30:00Z' },
  { route_id: 'A', started_at: '2026-09-03T08:00:00Z', completed_at: null },
  { route_id: 'C', started_at: '2026-09-03T09:00:00Z', completed_at: '2026-09-03T09:30:00Z' },
];
assert.equal(countCompletedStops(runs, { A: 10, B: 4 }), 24, '10 + 10 + 4; unmeasured A run and unknown route C add nothing');
assert.equal(countCompletedStops([], { A: 10 }), 0);
assert.equal(countCompletedStops(runs, {}), 0);
assert.equal(countCompletedStops(runs, undefined), 0);

console.log('environmental-impact ok');

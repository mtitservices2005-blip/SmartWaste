import assert from 'node:assert/strict';
import { EMISSION_FACTORS, FUEL_TYPE_LABELS, co2KgForLiters, EMISSION_NOTICE } from '../shared/emission-factors.js';

assert.equal(EMISSION_FACTORS.diesel, 2.68);
assert.equal(EMISSION_FACTORS.gasolina, 2.31);
assert.equal(FUEL_TYPE_LABELS.diesel, 'Diésel');
assert.equal(co2KgForLiters(10, 'diesel'), 26.8);
assert.equal(co2KgForLiters(10, 'gasolina'), 23.1);
assert.equal(co2KgForLiters(10, 'otro'), null);
assert.equal(co2KgForLiters(10, null), null);
assert.equal(co2KgForLiters(0, 'diesel'), null);
assert.equal(co2KgForLiters(-3, 'diesel'), null);
assert.equal(co2KgForLiters('x', 'diesel'), null);
assert.match(EMISSION_NOTICE, /estimación/i);
console.log('emission-factors: ok');

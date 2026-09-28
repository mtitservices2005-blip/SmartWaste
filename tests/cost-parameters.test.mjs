// SW-030: unit coverage for shared/cost-parameters.js.
import assert from 'node:assert/strict';
import { DEFAULT_COST_PARAMETERS, COST_PARAMETER_KEYS, validateCostParameters, mergeCostParameters, fetchCostParameters, saveCostParameters, createDemoCostParametersStore } from '../shared/cost-parameters.js';

// 1. validateCostParameters(): a full, valid set passes.
const fullValid = { ...DEFAULT_COST_PARAMETERS };
assert.deepEqual(validateCostParameters(fullValid), { valid: true, errors: [] });

// 2. Missing/blank/non-numeric fields are rejected, one error per bad field.
assert.equal(validateCostParameters({ ...fullValid, fuelPrice: undefined }).valid, false);
assert.equal(validateCostParameters({ ...fullValid, fuelPrice: '' }).valid, false);
assert.equal(validateCostParameters({ ...fullValid, fuelPrice: 'not-a-number' }).valid, false);
assert.equal(validateCostParameters(null).valid, false);
assert.equal(validateCostParameters({}).valid, false);

// 3. Negative values are rejected for every field.
assert.equal(validateCostParameters({ ...fullValid, hourlyCost: -1 }).valid, false);

// 4. Zero is rejected only for the two divisors (fuelEfficiency, avgSpeedKmh) — every other field
// legitimately allows zero (e.g. a municipality with no incident-avoidance program at all).
assert.equal(validateCostParameters({ ...fullValid, fuelEfficiency: 0 }).valid, false, 'fuelEfficiency=0 would divide by zero (fuelSavedLiters = avoidedKm / fuelEfficiency)');
assert.equal(validateCostParameters({ ...fullValid, avgSpeedKmh: 0 }).valid, false, 'avgSpeedKmh=0 would divide by zero (travelMinutes = distanceKm / avgSpeedKmh * 60)');
assert.equal(validateCostParameters({ ...fullValid, incidentAvoidanceCost: 0 }).valid, true, 'zero is legitimate for a pure multiplier field');
assert.equal(validateCostParameters({ ...fullValid, hourlyCost: 0 }).valid, true);

// 5. mergeCostParameters(): nothing saved yet -> all defaults, configured: false.
const emptyMerge = mergeCostParameters(undefined);
assert.deepEqual(emptyMerge.values, DEFAULT_COST_PARAMETERS);
assert.equal(emptyMerge.configured, false);
assert.deepEqual(mergeCostParameters(null).values, DEFAULT_COST_PARAMETERS);
assert.deepEqual(mergeCostParameters({}).values, DEFAULT_COST_PARAMETERS);
assert.equal(mergeCostParameters({}).configured, false, 'an empty object has nothing real in it either');

// 6. mergeCostParameters(): a partial/saved override wins for the fields it sets, defaults fill the
// rest, and configured flips to true.
const partialMerge = mergeCostParameters({ fuelPrice: 90 });
assert.equal(partialMerge.values.fuelPrice, 90);
assert.equal(partialMerge.values.fuelEfficiency, DEFAULT_COST_PARAMETERS.fuelEfficiency, 'unset fields still fall back to the default');
assert.equal(partialMerge.configured, true);

// 7. mergeCostParameters(): an invalid stored value (corrupt data) is ignored, not propagated as NaN.
const corruptMerge = mergeCostParameters({ fuelPrice: 'garbage', hourlyCost: 1200 });
assert.equal(corruptMerge.values.fuelPrice, DEFAULT_COST_PARAMETERS.fuelPrice);
assert.equal(corruptMerge.values.hourlyCost, 1200);

// 8. createDemoCostParametersStore(): get before any save returns defaults, configured: false.
const demoStore = createDemoCostParametersStore();
const beforeSave = demoStore.get('mun-a');
assert.equal(beforeSave.ok, true);
assert.deepEqual(beforeSave.values, DEFAULT_COST_PARAMETERS);
assert.equal(beforeSave.configured, false);

// 9. createDemoCostParametersStore(): save then get reflects the saved values, configured: true.
const saveResult = demoStore.save('mun-a', { ...DEFAULT_COST_PARAMETERS, fuelPrice: 100 });
assert.equal(saveResult.ok, true);
assert.equal(saveResult.values.fuelPrice, 100);
assert.equal(demoStore.get('mun-a').values.fuelPrice, 100);
assert.equal(demoStore.get('mun-a').configured, true);

// 10. createDemoCostParametersStore(): an invalid save is rejected, does not overwrite what's stored.
const invalidSaveResult = demoStore.save('mun-a', { ...DEFAULT_COST_PARAMETERS, avgSpeedKmh: 0 });
assert.equal(invalidSaveResult.ok, false);
assert.equal(demoStore.get('mun-a').values.fuelPrice, 100, 'a rejected save must not have touched the previously saved value');

// 11. createDemoCostParametersStore(): two municipalities are fully isolated from each other.
demoStore.save('mun-b', { ...DEFAULT_COST_PARAMETERS, fuelPrice: 55 });
assert.equal(demoStore.get('mun-a').values.fuelPrice, 100, 'saving mun-b must not affect mun-a');
assert.equal(demoStore.get('mun-b').values.fuelPrice, 55);

// 12. fetchCostParameters()/saveCostParameters() (real, fake Supabase client): no client / no
// municipality_id fail before touching anything.
assert.equal((await fetchCostParameters({}, 'mun-a')).ok, false);
assert.equal((await fetchCostParameters({ from: () => {} }, null)).ok, false);
assert.equal((await saveCostParameters({}, 'mun-a', fullValid)).ok, false);
assert.equal((await saveCostParameters({ from: () => {} }, null, fullValid)).ok, false);

// 13. saveCostParameters(): invalid params are rejected before any query runs.
const noQueryClient = { from: () => { throw new Error('must not query with invalid params'); } };
const invalidSave = await saveCostParameters(noQueryClient, 'mun-a', { ...fullValid, fuelEfficiency: -1 });
assert.equal(invalidSave.ok, false);
assert.equal(invalidSave.error.code, 'INVALID_COST_PARAMETERS');

// 14. fetchCostParameters(): reads settings.cost_parameters from an existing row, merges with
// defaults for whatever's absent.
const readClient = { from: (table) => { assert.equal(table, 'municipality_settings'); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: { cost_parameters: { fuelPrice: 88 } } }, error: null }) }) }) }; } };
const readResult = await fetchCostParameters(readClient, 'mun-a');
assert.equal(readResult.ok, true);
assert.equal(readResult.values.fuelPrice, 88);
assert.equal(readResult.values.fuelEfficiency, DEFAULT_COST_PARAMETERS.fuelEfficiency);
assert.equal(readResult.configured, true);

// 15. fetchCostParameters(): no row yet for this municipality -> all defaults, configured: false.
const noRowClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
const noRowResult = await fetchCostParameters(noRowClient, 'mun-a');
assert.equal(noRowResult.ok, true);
assert.deepEqual(noRowResult.values, DEFAULT_COST_PARAMETERS);
assert.equal(noRowResult.configured, false);

// 16. fetchCostParameters(): a query error is surfaced, not swallowed.
const failingReadClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST_TEST', message: 'rejected' } }) }) }) }) };
const failingReadResult = await fetchCostParameters(failingReadClient, 'mun-a');
assert.equal(failingReadResult.ok, false);
assert.equal(failingReadResult.error.code, 'PGRST_TEST');

// 17. saveCostParameters(): no existing row -> inserts a new one.
{
  let insertedPayload = null;
  const insertClient = {
    from: (table) => {
      assert.equal(table, 'municipality_settings');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: (payload) => { insertedPayload = payload; return { select: () => ({ single: async () => ({ data: { settings: payload.settings }, error: null }) }) }; }
      };
    }
  };
  const insertResult = await saveCostParameters(insertClient, 'mun-a', fullValid);
  assert.equal(insertResult.ok, true);
  assert.equal(insertedPayload.municipality_id, 'mun-a');
  assert.deepEqual(insertedPayload.settings.cost_parameters, fullValid);
}

// 18. saveCostParameters(): an existing row (with an unrelated key already in `settings`) is
// updated in place, preserving that unrelated key — never a blind overwrite of the jsonb blob.
{
  let updatedPayload = null;
  let updatedId = null;
  const updateClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'row-1', settings: { some_other_feature: 'keep-me' } }, error: null }) }) }),
      update: (payload) => {
        updatedPayload = payload;
        return { eq: (col, value) => { updatedId = value; return { select: () => ({ single: async () => ({ data: { settings: payload.settings }, error: null }) }) }; } };
      }
    })
  };
  const updateResult = await saveCostParameters(updateClient, 'mun-a', { ...fullValid, fuelPrice: 120 });
  assert.equal(updateResult.ok, true);
  assert.equal(updatedId, 'row-1');
  assert.equal(updatedPayload.settings.some_other_feature, 'keep-me', 'saving cost parameters must not erase other keys already in settings');
  assert.equal(updatedPayload.settings.cost_parameters.fuelPrice, 120);
  assert.equal(updateResult.values.fuelPrice, 120);
}

console.log('cost-parameters ok');

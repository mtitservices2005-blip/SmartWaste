// Roadmap item 5 ("estimación de viviendas por ruta"): unit coverage for
// shared/overpass-buildings.js using an injected fetchImpl — no real network call, consistent with
// this sandbox's inability to reach overpass-api.de (egress policy blocks it, same as
// router.project-osrm.org — see tests/osrm-routing.test.mjs).
import assert from 'node:assert/strict';
import { buildBuildingCountQuery, parseOverpassCountResponse, fetchBuildingCount, estimateCollectionMinutes, OVERPASS_DEFAULT_BASE_URL } from '../shared/overpass-buildings.js';

// 1. Query building: sample points and radius must appear correctly in the Overpass QL query.
const samplePoints = [[19.6489, -71.0956], [19.6500, -71.1000]];
const query = buildBuildingCountQuery(samplePoints);
assert.ok(query.includes('around:30,19.6489,-71.0956,19.65,-71.1'), 'default radius (30m) and sample points must appear in the query');
assert.ok(query.includes('way["building"]'));
assert.ok(query.includes('relation["building"]'));
assert.ok(query.includes('out count;'), 'must use Overpass\'s lightweight count-only output mode');
const customRadiusQuery = buildBuildingCountQuery(samplePoints, { radiusMeters: 50 });
assert.ok(customRadiusQuery.includes('around:50,'), 'custom radiusMeters must be reflected in the query');

// 2. Response parsing: Overpass's count-mode JSON shape.
assert.equal(parseOverpassCountResponse({ elements: [{ type: 'count', tags: { total: '12', ways: '10', relations: '2' } }] }), 12);
assert.equal(parseOverpassCountResponse({ elements: [{ type: 'count', tags: { total: '0' } }] }), 0, 'zero buildings is a valid, usable count');
assert.equal(parseOverpassCountResponse({}), null, 'missing elements must parse to null, not throw');
assert.equal(parseOverpassCountResponse({ elements: [] }), null, 'no count element must parse to null');
assert.equal(parseOverpassCountResponse({ elements: [{ type: 'count', tags: { total: 'not-a-number' } }] }), null, 'non-numeric total must not pass through');

// 3. fetchBuildingCount: success path, using a stubbed fetchImpl.
const successResult = await fetchBuildingCount(samplePoints, {
  fetchImpl: async (url, options) => {
    assert.equal(url, OVERPASS_DEFAULT_BASE_URL);
    assert.equal(options.method, 'POST');
    assert.ok(options.body.startsWith('data='), 'Overpass expects the query as a data= form field, not a query string');
    assert.ok(decodeURIComponent(options.body).includes('19.6489,-71.0956'), 'POST body must contain the encoded query with sample points');
    return { ok: true, status: 200, json: async () => ({ elements: [{ type: 'count', tags: { total: '7' } }] }) };
  }
});
assert.equal(successResult.ok, true);
assert.equal(successResult.buildingCount, 7);

// 4. fetchBuildingCount must degrade gracefully (never throw) on every failure mode — rule 5
// (never break the approved demo) depends on this.
const networkFailure = await fetchBuildingCount(samplePoints, { fetchImpl: async () => { throw new Error('network unreachable'); } });
assert.equal(networkFailure.ok, false);
assert.equal(networkFailure.error.code, 'OVERPASS_REQUEST_FAILED');

const httpFailure = await fetchBuildingCount(samplePoints, { fetchImpl: async () => ({ ok: false, status: 429 }) });
assert.equal(httpFailure.ok, false);
assert.equal(httpFailure.error.code, 'OVERPASS_HTTP_ERROR');

const malformed = await fetchBuildingCount(samplePoints, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
assert.equal(malformed.ok, false);
assert.equal(malformed.error.code, 'OVERPASS_MALFORMED_RESPONSE');

// 5. Empty sample points must fail fast, without even calling fetchImpl.
let fetchCalled = false;
const noSamples = await fetchBuildingCount([], { fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; } });
assert.equal(noSamples.ok, false);
assert.equal(noSamples.error.code, 'INVALID_SAMPLE_POINTS');
assert.equal(fetchCalled, false);

// 6. estimateCollectionMinutes: pure, no network.
assert.deepEqual(estimateCollectionMinutes(12), { minMinutes: 24, maxMinutes: 36, averageMinutes: 30 });
assert.deepEqual(estimateCollectionMinutes(12, { minMinutesPerStop: 1, maxMinutesPerStop: 4 }), { minMinutes: 12, maxMinutes: 48, averageMinutes: 30 });
assert.deepEqual(estimateCollectionMinutes(0), { minMinutes: 0, maxMinutes: 0, averageMinutes: 0 });
assert.equal(estimateCollectionMinutes(NaN), null);
assert.equal(estimateCollectionMinutes(-1), null);

console.log('overpass-buildings ok');

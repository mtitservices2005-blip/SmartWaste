// Roadmap item 1 ("trazado inteligente"): unit coverage for shared/osrm-routing.js using an
// injected fetchImpl — no real network call, consistent with this sandbox's inability to reach
// router.project-osrm.org (egress policy blocks it) and with how the rest of this codebase tests
// I/O wrappers (see tests/telemetry-ingestion.test.mjs for the same pattern against Supabase).
import assert from 'node:assert/strict';
import { buildOsrmRouteUrl, parseOsrmRouteResponse, fetchRoadRoute, OSRM_DEFAULT_BASE_URL } from '../shared/osrm-routing.js';

// 1. URL building: lat/lng waypoints must be flipped to OSRM's lon,lat order.
const url = buildOsrmRouteUrl([[19.6489, -71.0956], [19.6500, -71.1000]]);
assert.equal(url, `${OSRM_DEFAULT_BASE_URL}/route/v1/driving/-71.0956,19.6489;-71.1,19.65?overview=full&geometries=geojson`);
assert.ok(buildOsrmRouteUrl([[1, 2], [3, 4]], { baseUrl: 'https://osrm.example.test' }).startsWith('https://osrm.example.test/route/v1/driving/'));

// 2. Response parsing: OSRM's [lon,lat] GeoJSON coordinates must come back as [lat,lng].
const okBody = { code: 'Ok', routes: [{ geometry: { coordinates: [[-71.0956, 19.6489], [-71.0970, 19.6495], [-71.1000, 19.6500]] } }] };
assert.deepEqual(parseOsrmRouteResponse(okBody), [[19.6489, -71.0956], [19.6495, -71.0970], [19.6500, -71.1000]]);
assert.equal(parseOsrmRouteResponse({}), null, 'missing geometry must parse to null, not throw');
assert.equal(parseOsrmRouteResponse({ routes: [{ geometry: { coordinates: [[1, 2]] } }] }), null, 'a single coordinate is not a usable route');
assert.equal(parseOsrmRouteResponse({ routes: [{ geometry: { coordinates: [[1, 2], ['nope', 4]] } }] }), null, 'non-numeric coordinates must not pass through');

// 3. fetchRoadRoute: success path, using a stubbed fetchImpl.
const waypoints = [[19.6489, -71.0956], [19.6500, -71.1000]];
const successResult = await fetchRoadRoute(waypoints, {
  fetchImpl: async (calledUrl) => {
    assert.ok(calledUrl.includes('-71.0956,19.6489'), 'request URL must use OSRM lon,lat order');
    return { ok: true, status: 200, json: async () => okBody };
  }
});
assert.equal(successResult.ok, true);
assert.deepEqual(successResult.path, [[19.6489, -71.0956], [19.6495, -71.0970], [19.6500, -71.1000]]);

// 4. fetchRoadRoute must degrade gracefully (never throw) on every failure mode a caller might see
// in this sandbox or in production: network rejection, non-2xx HTTP, OSRM "no route" response, and
// a malformed/empty body — rule 5 (never break the approved demo) depends on this.
const networkFailure = await fetchRoadRoute(waypoints, { fetchImpl: async () => { throw new Error('network unreachable'); } });
assert.equal(networkFailure.ok, false);
assert.equal(networkFailure.error.code, 'OSRM_REQUEST_FAILED');

const httpFailure = await fetchRoadRoute(waypoints, { fetchImpl: async () => ({ ok: false, status: 503 }) });
assert.equal(httpFailure.ok, false);
assert.equal(httpFailure.error.code, 'OSRM_HTTP_ERROR');

const noRoute = await fetchRoadRoute(waypoints, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 'NoRoute', message: 'Impossible route between points' }) }) });
assert.equal(noRoute.ok, false);
assert.equal(noRoute.error.code, 'OSRM_NO_ROUTE');

const malformed = await fetchRoadRoute(waypoints, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [] }) }) });
assert.equal(malformed.ok, false);
assert.equal(malformed.error.code, 'OSRM_MALFORMED_RESPONSE');

// 5. Fewer than 2 waypoints must fail fast, without even calling fetchImpl.
let fetchCalled = false;
const tooFew = await fetchRoadRoute([[1, 2]], { fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => okBody }; } });
assert.equal(tooFew.ok, false);
assert.equal(tooFew.error.code, 'INVALID_WAYPOINTS');
assert.equal(fetchCalled, false);

console.log('osrm-routing ok');

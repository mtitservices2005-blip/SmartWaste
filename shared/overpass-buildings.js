// "Estimación de viviendas" (roadmap ítem 5): estimates how many households/collection points a
// drawn route actually serves, using real OpenStreetMap building footprint density near the route
// — this codebase has no address/cadastral data at all, so this is the closest available "how many
// houses" signal without a municipality providing its own GIS data (documented as the future
// upgrade path, not built here). Deliberately its own module — not added to
// shared/route-engine.js, which is documented there as pure/no-I/O — because this makes a real
// network call. URL/query building and response parsing are plain functions so they can be unit
// tested without a network, same separation as shared/osrm-routing.js.
//
// Overpass's public instance (overpass-api.de) is free, needs no credentials, but is rate-limited/
// fair-use and has no SLA — same category of choice as OSRM's public demo server (rule 8 of
// CLAUDE.md is satisfied trivially, nothing to leak). Any failure (network, timeout, malformed
// response, rate limit) must fall back to "estimate unavailable" and never block route creation,
// per rule 5 (never break the approved demo).
//
// The count is a density estimate, not a real household count: it counts OSM building footprints
// within radiusMeters of a set of sample points along the route (reusing the same points
// shared/route-engine.js's generateRouteStopPoints() already generates every ~100m, rather than
// re-interpolating or using OSRM's dense polyline directly). Accuracy depends entirely on how
// complete OSM's building coverage is for the pilot municipality's area.
export const OVERPASS_DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter';

// samplePoints: [[lat,lng],...]. Builds an Overpass QL query using the `around` filter to find
// building ways/relations within radiusMeters of ANY sample point, then `out count;` — Overpass's
// lightweight count-only output mode, so the response is a handful of bytes instead of full
// geometries for every building found.
export function buildBuildingCountQuery(samplePoints, { radiusMeters = 30 } = {}) {
  const around = samplePoints.map(([lat, lng]) => `${lat},${lng}`).join(',');
  return `[out:json][timeout:25];(way["building"](around:${radiusMeters},${around});relation["building"](around:${radiusMeters},${around}););out count;`;
}

// Parses Overpass's count-mode JSON response: { elements: [{ type: 'count', tags: { total: 'N', ... } }] }.
// Returns null (not throw) on anything unexpected, same "no usable data" contract as
// shared/osrm-routing.js's parseOsrmRouteResponse.
export function parseOverpassCountResponse(body) {
  const countElement = body?.elements?.find((element) => element?.type === 'count');
  const total = Number(countElement?.tags?.total);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

// fetchImpl is injectable (defaults to global fetch) so this can be unit tested without a real
// network call. Overpass's documented interface is POST with the query as a `data=` form field —
// a GET URL would get unwieldy fast with more than a handful of sample points. Never throws: any
// failure resolves to { ok:false }, leaving the "estimate unavailable" fallback to the caller.
export async function fetchBuildingCount(samplePoints, { fetchImpl = fetch, baseUrl = OVERPASS_DEFAULT_BASE_URL, radiusMeters = 30, timeoutMs = 15000 } = {}) {
  if (!Array.isArray(samplePoints) || samplePoints.length < 1) return { ok: false, error: { code: 'INVALID_SAMPLE_POINTS', message: 'At least 1 sample point is required.' } };
  const query = buildBuildingCountQuery(samplePoints, { radiusMeters });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response?.ok) return { ok: false, error: { code: 'OVERPASS_HTTP_ERROR', message: `Overpass responded with status ${response?.status ?? 'unknown'}.` } };
    const body = await response.json();
    const buildingCount = parseOverpassCountResponse(body);
    if (buildingCount === null) return { ok: false, error: { code: 'OVERPASS_MALFORMED_RESPONSE', message: 'Overpass response did not contain a usable building count.' } };
    return { ok: true, buildingCount };
  } catch (error) {
    return { ok: false, error: { code: 'OVERPASS_REQUEST_FAILED', message: error?.message ?? 'Overpass request failed.' } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Pure, no I/O — turns an estimated household count into a rough collection-time estimate. The
// 2-3 min/stop range is an assumption (not measured field data), shown as a range rather than a
// single number so the UI doesn't imply more precision than this actually has.
export function estimateCollectionMinutes(householdCount, { minMinutesPerStop = 2, maxMinutesPerStop = 3 } = {}) {
  if (!Number.isFinite(householdCount) || householdCount < 0) return null;
  const minMinutes = Math.round(householdCount * minMinutesPerStop);
  const maxMinutes = Math.round(householdCount * maxMinutesPerStop);
  const averageMinutes = Math.round((minMinutes + maxMinutes) / 2);
  return { minMinutes, maxMinutes, averageMinutes };
}

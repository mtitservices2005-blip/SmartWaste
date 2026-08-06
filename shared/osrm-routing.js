// "Trazado inteligente": snap a hand-drawn set of waypoints ([[lat,lng],...], click order) onto
// real street geometry via OSRM (https://project-osrm.org). Deliberately its own module — not
// added to shared/route-engine.js, which is documented there as pure/no-I/O — because this makes
// a real network call. Pure logic aside from that one fetch: URL building and response parsing are
// both plain functions so they can be unit tested without a network.
//
// OSRM's public demo server (router.project-osrm.org) is free, needs no credentials (rule 8 of
// CLAUDE.md is satisfied trivially — there's nothing to leak), but is rate-limited/eval-only and
// not meant for production load. Judged sufficient for a 3-5 truck pilot municipality (user's
// explicit choice). Any failure (network, timeout, malformed response, no route found) must fall
// back to the straight-line path the caller already had — this feature must never be able to break
// route creation, per rule 5 (never break the approved demo).
export const OSRM_DEFAULT_BASE_URL = 'https://router.project-osrm.org';

// OSRM expects "lon,lat" pairs in the URL, the exact opposite of this codebase's [lat, lng]
// convention used everywhere else (routeGeometry(), drawnRoutePoints, Leaflet calls).
export function buildOsrmRouteUrl(waypoints, { baseUrl = OSRM_DEFAULT_BASE_URL } = {}) {
  const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  return `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
}

// Parses an OSRM /route response body (already JSON.parse'd) back into [[lat,lng],...], flipping
// coordinate order back. Returns null (not throw) on anything unexpected, so the caller can treat
// "no usable geometry" uniformly whether it came from a network failure or a malformed response.
export function parseOsrmRouteResponse(body) {
  const coordinates = body?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const path = coordinates.map(([lng, lat]) => [lat, lng]);
  return path.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)) ? path : null;
}

// fetchImpl is injectable (defaults to global fetch) so this can be unit tested without a real
// network call — same pattern as this codebase's other testable I/O wrappers (see
// createTelemetryIngestionAdapter in shared/telemetry-simulator.js). Never throws: any failure
// resolves to { ok:false }, leaving the fallback-to-straight-line decision to the caller.
export async function fetchRoadRoute(waypoints, { fetchImpl = fetch, baseUrl = OSRM_DEFAULT_BASE_URL, timeoutMs = 8000 } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return { ok: false, error: { code: 'INVALID_WAYPOINTS', message: 'At least 2 waypoints are required.' } };
  const url = buildOsrmRouteUrl(waypoints, { baseUrl });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) return { ok: false, error: { code: 'OSRM_HTTP_ERROR', message: `OSRM responded with status ${response?.status ?? 'unknown'}.` } };
    const body = await response.json();
    if (body?.code && body.code !== 'Ok') return { ok: false, error: { code: 'OSRM_NO_ROUTE', message: body.message ?? `OSRM could not compute a route (${body.code}).` } };
    const path = parseOsrmRouteResponse(body);
    if (!path) return { ok: false, error: { code: 'OSRM_MALFORMED_RESPONSE', message: 'OSRM response did not contain usable route geometry.' } };
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: { code: 'OSRM_REQUEST_FAILED', message: error?.message ?? 'OSRM request failed.' } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

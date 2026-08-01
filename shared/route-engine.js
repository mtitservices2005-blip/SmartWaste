// SW-025: pure route-planning logic — generates synthetic collection points along an existing
// routePath geometry (shared/demo-data.js, the same source DeviceSimulator already walks for
// telemetry simulation), splits them into capacity-bounded trips, and derives a point's
// pending/recolectado status from recorded positions. No I/O here — persistence lives in
// shared/operations-adapter.js's saveRouteStops()/listRouteStopsWithStatus(), which write/read
// route_stops using these functions.
import { routePaths } from './demo-data.js';

const EARTH_RADIUS_M = 6371000;

export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Walks the path's segments in order, placing a point every `stepMeters` along the way (linear
// lat/lng interpolation — fine at city-block scale, not meant for long distances). This generates
// a genuinely synthetic, evenly-spaced sequence instead of just reusing the path's own sparse
// waypoints, while never leaving the path's geometry or reordering anything: point N+1 is always
// further along the same street line than point N.
function interpolatePath(path, stepMeters) {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0]];
  const points = [path[0]];
  let carry = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const start = path[i];
    const end = path[i + 1];
    const segmentLength = haversineMeters(start, end);
    if (segmentLength === 0) continue;
    let distanceAlong = stepMeters - carry;
    while (distanceAlong < segmentLength) {
      const t = distanceAlong / segmentLength;
      points.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
      distanceAlong += stepMeters;
    }
    carry = segmentLength - (distanceAlong - stepMeters);
  }
  const last = path[path.length - 1];
  const lastGenerated = points[points.length - 1];
  if (haversineMeters(lastGenerated, last) > 1) points.push(last);
  return points;
}

// Generates the full, sequence-ordered list of synthetic collection points for a routePath id.
// sequence always follows the path's own order (1..N) — never reordered by distance/nearest-
// neighbor, since the path already follows real street geometry and doing so would zig-zag across
// streets that only look close in straight-line terms.
export function generateRouteStopPoints(pathId, { stepMeters = 100 } = {}) {
  const path = routePaths[pathId];
  if (!path) throw new Error(`Unknown routePath id: ${pathId}`);
  return interpolatePath(path, stepMeters).map(([latitude, longitude], index) => ({
    sequence: index + 1,
    label: `Punto de recolección ${index + 1}`,
    latitude,
    longitude
  }));
}

// Splits a sequence-ordered point list into trips of at most `maxStopsPerTrip` points each. The cut
// always falls between two points (never mid-segment) — trip N's last point and trip N+1's first
// point are simply adjacent points in the original sequence. Sequence numbers are NOT reset per
// trip: all points still belong to the same route_id/route_stops set (see
// shared/operations-adapter.js's saveRouteStops()), trips are just a capacity-planning grouping.
export function splitIntoTrips(points, maxStopsPerTrip) {
  if (!Number.isFinite(maxStopsPerTrip) || maxStopsPerTrip <= 0) return [points];
  const trips = [];
  for (let i = 0; i < points.length; i += maxStopsPerTrip) trips.push(points.slice(i, i + maxStopsPerTrip));
  return trips;
}

// A stop counts as collected if any recorded position for the assigned vehicle came within
// `radiusMeters` of it — a real geometric check against actual captured lat/lng, not a simulator
// index. No new column needed on route_stops for this (see docs/TECHNICAL_DEBT_REGISTER.md item
// #12's writeup for why a demo needs to stay honest about what's derived vs. stored).
export function deriveStopStatus(stop, positions, { radiusMeters = 40 } = {}) {
  const collected = positions.some((position) => haversineMeters([stop.latitude, stop.longitude], [position.latitude, position.longitude]) <= radiusMeters);
  return collected ? 'recolectado' : 'pendiente';
}

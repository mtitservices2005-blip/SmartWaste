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

function totalPathLength(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) total += haversineMeters(path[i], path[i + 1]);
  return total;
}

function pointAtDistance(path, targetDistance) {
  let travelled = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segmentLength = haversineMeters(path[i], path[i + 1]);
    if (segmentLength === 0) continue;
    if (travelled + segmentLength >= targetDistance) {
      const t = (targetDistance - travelled) / segmentLength;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
    }
    travelled += segmentLength;
  }
  return path[path.length - 1];
}

// count evenly-spaced points (including the exact start and end) along the path's total length —
// used when a caller needs an exact stop count (e.g. matching a route's declared `stops` field)
// instead of a fixed meter spacing.
function evenlySpacedPoints(path, count) {
  if (count <= 1) return [path[0]];
  const total = totalPathLength(path);
  return Array.from({ length: count }, (_, i) => pointAtDistance(path, (i / (count - 1)) * total));
}

// Generates the full, sequence-ordered list of synthetic collection points for a routePath.
// sequence always follows the path's own order (1..N) — never reordered by distance/nearest-
// neighbor, since the path already follows real street geometry and doing so would zig-zag across
// streets that only look close in straight-line terms. Pass `count` to generate exactly that many
// points (e.g. to match a route's declared `stops` field) instead of spacing by `stepMeters`.
//
// `pathOrId` accepts either a routePaths key (shared/demo-data.js's 5 bundled demo routes) or a raw
// [[lat,lng], ...] array directly (SW-027: a route drawn through the "Crear ruta" UI, whose geometry
// lives in route_paths, not in the fixed demo dictionary) — same generation logic either way, no
// separate implementation for drawn routes.
export function generateRouteStopPoints(pathOrId, { stepMeters = 100, count } = {}) {
  const path = Array.isArray(pathOrId) ? pathOrId : routePaths[pathOrId];
  if (!path) throw new Error(`Unknown routePath id: ${pathOrId}`);
  const rawPoints = Number.isFinite(count) && count > 0 ? evenlySpacedPoints(path, count) : interpolatePath(path, stepMeters);
  return rawPoints.map(([latitude, longitude], index) => ({
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

// Local planar (equirectangular) projection around a reference latitude — fine at city-block
// scale, same caveat as interpolatePath's linear lat/lng interpolation above. Used so
// pointToSegmentDistanceMeters can do ordinary 2D point-to-segment math instead of spherical
// geometry, which has no simple closed form for the "nearest point on a great-circle segment".
function toLocalXY([lat, lng], refLat) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  return [toRad(lng) * Math.cos(toRad(refLat)) * EARTH_RADIUS_M, toRad(lat) * EARTH_RADIUS_M];
}

function pointToSegmentDistanceMeters(point, segStart, segEnd) {
  const refLat = (segStart[0] + segEnd[0]) / 2;
  const [px, py] = toLocalXY(point, refLat);
  const [ax, ay] = toLocalXY(segStart, refLat);
  const [bx, by] = toLocalXY(segEnd, refLat);
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

// A stop counts as collected if it lies within `radiusMeters` of the vehicle's recorded trail —
// checked against trail SEGMENTS, not just the discrete sample points themselves. A sparse
// telemetry source (e.g. a simulator that jumps directly between routePath waypoints, recording no
// samples in between) can cross right past a stop between two samples without ever recording a
// point near it; checking only discrete points would leave that stop pendiente forever even once
// the vehicle has clearly passed it (found by Codex review on PR #26). `trail` must be
// chronologically ordered (oldest first) — shared/operations-adapter.js's
// listRouteStopsWithStatus() sorts by captured_at ascending before calling this, and
// shared/telemetry-simulator.js's createDemoPositionHistory().listPositions() already returns
// points in that order.
export function deriveStopStatus(stop, trail, { radiusMeters = 40 } = {}) {
  const target = [stop.latitude, stop.longitude];
  if (trail.length === 0) return 'pendiente';
  if (trail.length === 1) {
    return haversineMeters(target, [trail[0].latitude, trail[0].longitude]) <= radiusMeters ? 'recolectado' : 'pendiente';
  }
  for (let i = 0; i < trail.length - 1; i += 1) {
    const segStart = [trail[i].latitude, trail[i].longitude];
    const segEnd = [trail[i + 1].latitude, trail[i + 1].longitude];
    if (pointToSegmentDistanceMeters(target, segStart, segEnd) <= radiusMeters) return 'recolectado';
  }
  return 'pendiente';
}

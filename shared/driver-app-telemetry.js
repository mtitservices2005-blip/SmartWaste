import { validateTelemetryPosition } from './telemetry-simulator.js';

export const DRIVER_APP_MAX_INTERVAL_MS = 10_000;
export const DRIVER_APP_MIN_DISTANCE_METERS = 25;

export function distanceMeters(a, b) {
  const radians = (degrees) => Number(degrees) * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(b.longitude) - radians(a.longitude);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

// Background-geolocation callbacks may arrive more frequently than we want to persist. Keep a
// sample when ten seconds have elapsed OR the phone moved at least 25 metres, whichever happens
// first. The first valid sample is always kept.
export function shouldCaptureDriverPosition(lastPosition, nextPosition, {
  maxIntervalMs = DRIVER_APP_MAX_INTERVAL_MS,
  minDistanceMeters = DRIVER_APP_MIN_DISTANCE_METERS
} = {}) {
  if (!lastPosition) return true;
  const elapsed = Date.parse(nextPosition.captured_at) - Date.parse(lastPosition.captured_at);
  return elapsed >= maxIntervalMs || distanceMeters(lastPosition, nextPosition) >= minDistanceMeters;
}

export function positionFromDriverLocation(location, {
  vehicle_id,
  municipality_id,
  route_run_id,
  device_id,
  correlation_id
} = {}) {
  const coords = location.coords ?? location;
  const timestamp = location.timestamp ?? location.time ?? Date.now();
  return {
    vehicle_id,
    municipality_id,
    route_run_id: route_run_id ?? null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? 0,
    speed: coords.speed ?? 0,
    heading: coords.heading ?? coords.bearing ?? 0,
    captured_at: new Date(timestamp).toISOString(),
    received_at: new Date().toISOString(),
    source: 'driver_app',
    device_id,
    correlation_id
  };
}

function queueKey(position) {
  return [position.device_id, position.vehicle_id, position.captured_at,
    position.latitude, position.longitude].join('|');
}

async function readStorage(storage, key) {
  const raw = await storage?.getItem?.(key);
  if (!raw) return { pending: [], sent: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      sent: Array.isArray(parsed.sent) ? parsed.sent : []
    };
  } catch {
    return { pending: [], sent: [] };
  }
}

// Storage deliberately follows the localStorage getItem/setItem contract, while accepting async
// implementations too (for example Capacitor Preferences). Queue state is written after every
// mutation so process/app restarts preserve pending samples and the local sent-id ledger.
export function createPersistentTelemetryQueue({ storage, storageKey = 'smartwaste.driver-telemetry.v1' } = {}) {
  let statePromise;
  let flushPromise = null;
  const state = () => statePromise ??= readStorage(storage, storageKey);
  const persist = (value) => storage?.setItem?.(storageKey, JSON.stringify(value));

  return {
    async list() {
      const value = await state();
      return value.pending.slice().sort((a, b) => Date.parse(a.position.captured_at) - Date.parse(b.position.captured_at));
    },
    async enqueue(position) {
      const value = await state();
      const id = queueKey(position);
      if (value.sent.includes(id) || value.pending.some((item) => item.id === id)) return false;
      value.pending.push({ id, position: { ...position } });
      await persist(value);
      return true;
    },
    async flush(ingest) {
      if (flushPromise) return flushPromise;
      flushPromise = (async () => {
        const value = await state();
        value.pending.sort((a, b) => Date.parse(a.position.captured_at) - Date.parse(b.position.captured_at));
        let sent = 0;
        while (value.pending.length) {
          const item = value.pending[0];
          if (value.sent.includes(item.id)) {
            value.pending.shift();
            await persist(value);
            continue;
          }
          const result = await ingest(item.position, { correlation_id: item.position.correlation_id });
          if (!result?.ok) return { ok: false, sent, pending: value.pending.length, error: result?.error };
          value.sent.push(item.id);
          value.pending.shift();
          await persist(value);
          sent += 1;
        }
        return { ok: true, sent, pending: 0 };
      })();
      try { return await flushPromise; } finally { flushPromise = null; }
    }
  };
}

// Resolves the same active route/vehicle assignment used by the web GPS path before accepting any
// samples. This keeps an unassigned driver from creating queue entries that RLS would later reject.
export async function createDriverTelemetrySession({
  profileId,
  municipalityId,
  deviceId,
  operationsAdapter,
  ingestionAdapter,
  queue
}) {
  const assignment = await operationsAdapter.findOwnVehicleAssignment(profileId);
  if (!assignment.ok) {
    return {
      ok: false,
      error: {
        code: assignment.error?.code ?? 'NO_ACTIVE_ROUTE_ASSIGNED',
        message: 'No tienes un vehiculo asignado en una ruta activa.'
      }
    };
  }

  let lastCaptured = null;
  return {
    ok: true,
    async capture(location, { correlation_id } = {}) {
      const position = positionFromDriverLocation(location, {
        vehicle_id: assignment.data.vehicle_id,
        route_run_id: assignment.data.route_run_id,
        municipality_id: municipalityId,
        device_id: deviceId,
        correlation_id
      });
      const validation = validateTelemetryPosition(position);
      if (!validation.valid) return { ok: false, error: { code: 'INVALID_TELEMETRY', message: validation.errors.join('; ') } };
      if (!shouldCaptureDriverPosition(lastCaptured, position)) return { ok: true, queued: false, reason: 'THROTTLED' };
      const queued = await queue.enqueue(position);
      if (queued) lastCaptured = position;
      return { ok: true, queued, position };
    },
    reconnect: () => queue.flush((position, opts) => ingestionAdapter.ingest(position, opts))
  };
}

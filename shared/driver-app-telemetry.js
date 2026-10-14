import { validateTelemetryPosition } from './telemetry-simulator.js';
import { readBatteryPct } from './driver-app-battery.js';
import { HEARTBEAT_INTERVAL_MS, createHeartbeat, heartbeatPosition, nextRetryDelayMs } from './driver-app-heartbeat.js';

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

// Nivel decimal 0..1 (como lo entrega el dispositivo) -> entero 0..100; cualquier otra cosa -> null.
function batteryPercent(level) {
  if (level === null || level === undefined || level === '') return null;
  const n = Number(level);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 100);
}

export function positionFromDriverLocation(location, {
  vehicle_id,
  municipality_id,
  route_run_id,
  device_id,
  correlation_id,
  battery_pct
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
    battery_pct: batteryPercent(battery_pct),
    correlation_id
  };
}

// Tope del registro local de enviados (solo sirve para ignorar repeticiones recientes).
const SENT_LEDGER_LIMIT = 2000;

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
    // SW-083: lectura y confirmación por lotes (más antiguos primero). Nada sale de la cola hasta que
    // markSent confirma que el servidor lo recibió, así un corte a mitad de envío no pierde puntos.
    async peek(max = 200) {
      const value = await state();
      return value.pending
        .slice()
        .sort((a, b) => Date.parse(a.position.captured_at) - Date.parse(b.position.captured_at))
        .slice(0, max);
    },
    async markSent(ids) {
      const value = await state();
      const done = new Set(ids);
      value.pending = value.pending.filter((item) => !done.has(item.id));
      for (const id of done) if (!value.sent.includes(id)) value.sent.push(id);
      if (value.sent.length > SENT_LEDGER_LIMIT) value.sent = value.sent.slice(-SENT_LEDGER_LIMIT);
      await persist(value);
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
          if (value.sent.length > SENT_LEDGER_LIMIT) value.sent = value.sent.slice(-SENT_LEDGER_LIMIT);
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
  queue,
  // SW-083: con batchAdapter (ingestPositions) la cola sale en lotes de hasta 200 puntos; sin él se
  // mantiene el envío de a uno de SW-074.
  batchAdapter = null,
  getBatteryLevel = () => readBatteryPct(),
  now = () => Date.now(),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(id),
  setIntervalFn,
  clearIntervalFn,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS
}) {
  const assignment = await operationsAdapter.findOwnVehicleAssignment(profileId);
  if (!assignment.ok) {
    if (assignment.error?.code === 'NO_ACTIVE_ROUTE_ASSIGNED') {
      return {
        ok: false,
        error: {
          ...assignment.error,
          message: 'No tienes un vehiculo asignado en una ruta activa.'
        }
      };
    }
    return {
      ok: false,
      error: {
        ...assignment.error,
        code: assignment.error?.code ?? 'ASSIGNMENT_LOOKUP_FAILED',
        message: assignment.error?.message ?? 'No se pudo consultar tu asignacion de ruta.'
      }
    };
  }

  let lastCaptured = null;
  let lastSampleAt = null;
  let retryAttempt = 0;
  let retryTimer = null;
  let heartbeat = null;
  let stopped = false;

  const cancelRetry = () => {
    if (retryTimer !== null) { clearTimeoutFn(retryTimer); retryTimer = null; }
  };
  const scheduleRetry = () => {
    if (stopped || retryTimer !== null) return;
    const delay = nextRetryDelayMs(retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeoutFn(async () => { retryTimer = null; await session.reconnect(); }, delay);
  };

  const session = {
    ok: true,
    assignment: { vehicle_id: assignment.data.vehicle_id, route_run_id: assignment.data.route_run_id ?? null },
    async capture(location, { correlation_id } = {}) {
      let battery_pct = null;
      try { battery_pct = await getBatteryLevel(); } catch { battery_pct = null; }
      const position = positionFromDriverLocation(location, {
        vehicle_id: assignment.data.vehicle_id,
        route_run_id: assignment.data.route_run_id,
        municipality_id: municipalityId,
        device_id: deviceId,
        correlation_id,
        battery_pct
      });
      const validation = validateTelemetryPosition(position);
      if (!validation.valid) return { ok: false, error: { code: 'INVALID_TELEMETRY', message: validation.errors.join('; ') } };
      if (!shouldCaptureDriverPosition(lastCaptured, position)) return { ok: true, queued: false, reason: 'THROTTLED' };
      const queued = await queue.enqueue(position);
      if (queued) { lastCaptured = position; lastSampleAt = now(); }
      return { ok: true, queued, position };
    },
    async pendingCount() { return (await queue.list()).length; },
    async reconnect() {
      if (!batchAdapter) return queue.flush((position, opts) => ingestionAdapter.ingest(position, opts));
      const { sent, failed } = await flushInBatches({ queue, send: (batch) => batchAdapter.ingestPositions(batch) });
      if (failed > 0) {
        scheduleRetry();
        return { ok: false, sent, pending: failed, error: { code: 'BATCH_SEND_FAILED', message: 'No se pudo enviar; se reintentará solo.' } };
      }
      retryAttempt = 0;
      cancelRetry();
      return { ok: true, sent, pending: 0 };
    },
    // Latido: si pasaron al menos `heartbeatIntervalMs` sin muestra, repite la última posición con
    // velocidad 0 (así el centro de control ve "detenido" y no "sin señal").
    startHeartbeat() {
      if (heartbeat) return;
      stopped = false;
      heartbeat = createHeartbeat({
        intervalMs: heartbeatIntervalMs,
        now,
        setIntervalFn,
        clearIntervalFn,
        onBeat: async ({ at }) => {
          if (!lastCaptured || (lastSampleAt !== null && now() - lastSampleAt < heartbeatIntervalMs)) return;
          const beat = heartbeatPosition(lastCaptured, at);
          if (await queue.enqueue(beat)) { lastSampleAt = now(); await session.reconnect(); }
        }
      });
      heartbeat.start();
    },
    stop() {
      stopped = true;
      cancelRetry();
      heartbeat?.stop();
      heartbeat = null;
    }
  };
  return session;
}

// SW-083: vacía la cola en lotes de hasta `maxBatch` puntos (tope de ingest_positions: 200), del más
// antiguo al más nuevo. Se detiene en el primer fallo (respuesta no ok o excepción) para que ningún
// punto adelante a otro; lo no enviado sigue en la cola. `failed` = puntos que quedan pendientes.
export async function flushInBatches({ queue, send, maxBatch = 200 }) {
  let sent = 0;
  for (;;) {
    const items = await queue.peek(maxBatch);
    if (!items.length) return { sent, failed: 0 };
    let result;
    try {
      result = await send(items.map((item) => item.position));
    } catch (error) {
      result = { ok: false, error: { code: 'NETWORK', message: String(error?.message ?? error) } };
    }
    if (!result?.ok) return { sent, failed: (await queue.list()).length };
    await queue.markSent(items.map((item) => item.id));
    sent += items.length;
  }
}

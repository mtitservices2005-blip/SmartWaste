import assert from 'node:assert/strict';
import {
  createDriverTelemetrySession,
  createPersistentTelemetryQueue,
  positionFromDriverLocation,
  shouldCaptureDriverPosition
} from '../shared/driver-app-telemetry.js';
import { validateTelemetryPosition } from '../shared/telemetry-simulator.js';

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => initial.get(key) ?? null,
    setItem: (key, value) => initial.set(key, value),
    data: initial
  };
}

const context = { vehicle_id: 'veh-1', municipality_id: 'mun-1', route_run_id: 'run-1', device_id: 'android-abc' };
const first = positionFromDriverLocation({ latitude: 19.6489, longitude: -71.0956, timestamp: '2026-10-03T12:00:00.000Z' }, context);
assert.equal(first.source, 'driver_app');
assert.equal(first.device_id, 'android-abc');
assert.equal(validateTelemetryPosition(first, { now: Date.parse(first.captured_at) }).valid, true);
assert.equal(validateTelemetryPosition({ ...first, device_id: '' }, { now: Date.parse(first.captured_at) }).valid, false);
assert.equal(validateTelemetryPosition({ ...first, route_run_id: null }, { now: Date.parse(first.captured_at) }).valid, false);

const beforeCadence = { ...first, captured_at: '2026-10-03T12:00:09.999Z' };
const atCadence = { ...first, captured_at: '2026-10-03T12:00:10.000Z' };
assert.equal(shouldCaptureDriverPosition(first, beforeCadence), false);
assert.equal(shouldCaptureDriverPosition(first, atCadence), true, '10 seconds must trigger a sample');
const moved25m = { ...beforeCadence, latitude: first.latitude + (25.1 / 111_111) };
assert.equal(shouldCaptureDriverPosition(first, moved25m), true, '25 metres must trigger before 10 seconds');

// Offline persistence: recreate the queue over the same storage, then flush oldest-first. A
// duplicate callback is ignored and captured_at remains exactly as captured.
const storage = memoryStorage();
const offlineQueue = createPersistentTelemetryQueue({ storage });
const later = { ...first, captured_at: '2026-10-03T12:00:20.000Z', latitude: 19.65, correlation_id: '22222222-2222-4222-8222-222222222222' };
const earlier = { ...first, captured_at: '2026-10-03T12:00:10.000Z', correlation_id: '11111111-1111-4111-8111-111111111111' };
assert.equal(await offlineQueue.enqueue(later), true);
assert.equal(await offlineQueue.enqueue(earlier), true);
assert.equal(await offlineQueue.enqueue(earlier), false, 'same captured sample must not be queued twice');

const restoredQueue = createPersistentTelemetryQueue({ storage });
const delivered = [];
const flushed = await restoredQueue.flush(async (position) => {
  delivered.push({ ...position });
  return { ok: true };
});
assert.deepEqual(delivered.map((item) => item.captured_at), [earlier.captured_at, later.captured_at]);
assert.equal(flushed.sent, 2);
assert.equal((await restoredQueue.list()).length, 0);
assert.equal(await restoredQueue.enqueue(earlier), false, 'sent ledger must reject a duplicate after reconnect');

// Stop at the first failure so later samples cannot overtake it; a second reconnect resumes in
// order without changing captured_at.
const retryStorage = memoryStorage();
const retryQueue = createPersistentTelemetryQueue({ storage: retryStorage });
await retryQueue.enqueue(earlier);
await retryQueue.enqueue(later);
const failed = await retryQueue.flush(async () => ({ ok: false, error: { code: 'OFFLINE' } }));
assert.equal(failed.sent, 0);
assert.equal(failed.pending, 2);
const retryDelivered = [];
await createPersistentTelemetryQueue({ storage: retryStorage }).flush(async (position) => {
  retryDelivered.push(position.captured_at);
  return { ok: true };
});
assert.deepEqual(retryDelivered, [earlier.captured_at, later.captured_at]);

// An unassigned driver receives a clear error and cannot enqueue or ingest anything.
let enqueueCalls = 0;
let ingestCalls = 0;
const noVehicle = await createDriverTelemetrySession({
  profileId: 'profile-no-vehicle', municipalityId: 'mun-1', deviceId: 'android-abc',
  operationsAdapter: { findOwnVehicleAssignment: async () => ({ ok: false, error: { code: 'NO_ACTIVE_ROUTE_ASSIGNED' } }) },
  ingestionAdapter: { ingest: async () => { ingestCalls += 1; return { ok: true }; } },
  queue: { enqueue: async () => { enqueueCalls += 1; }, flush: async () => ({ ok: true }) }
});
assert.equal(noVehicle.ok, false);
assert.equal(noVehicle.error.code, 'NO_ACTIVE_ROUTE_ASSIGNED');
assert.match(noVehicle.error.message, /vehiculo asignado/i);
assert.equal(enqueueCalls, 0);
assert.equal(ingestCalls, 0);

// Operational lookup failures retain their real cause instead of being presented as an absent
// assignment, and likewise cannot create a queue entry or reach ingestion.
const lookupFailure = await createDriverTelemetrySession({
  profileId: 'profile-query-failure', municipalityId: 'mun-1', deviceId: 'android-abc',
  operationsAdapter: { findOwnVehicleAssignment: async () => ({
    ok: false,
    error: { code: '42501', message: 'permission denied for table route_runs', correlation_id: 'lookup-1' }
  }) },
  ingestionAdapter: { ingest: async () => { ingestCalls += 1; return { ok: true }; } },
  queue: { enqueue: async () => { enqueueCalls += 1; }, flush: async () => ({ ok: true }) }
});
assert.equal(lookupFailure.ok, false);
assert.deepEqual(lookupFailure.error, {
  code: '42501',
  message: 'permission denied for table route_runs',
  correlation_id: 'lookup-1'
});
assert.doesNotMatch(lookupFailure.error.message, /vehiculo asignado/i);
assert.equal(enqueueCalls, 0);
assert.equal(ingestCalls, 0);

// Happy session connects assignment -> queue -> the existing ingestion adapter contract.
const sessionStorage = memoryStorage();
const sessionQueue = createPersistentTelemetryQueue({ storage: sessionStorage });
const sessionDelivered = [];
const session = await createDriverTelemetrySession({
  profileId: 'profile-1', municipalityId: 'mun-1', deviceId: 'android-session',
  operationsAdapter: { findOwnVehicleAssignment: async () => ({ ok: true, data: { vehicle_id: 'veh-1', route_run_id: 'run-1' } }) },
  ingestionAdapter: { ingest: async (position) => { sessionDelivered.push(position); return { ok: true }; } },
  queue: sessionQueue
});
assert.equal(session.ok, true);
const captured = await session.capture({ latitude: 19.6489, longitude: -71.0956, timestamp: Date.now() }, {
  correlation_id: '33333333-3333-4333-8333-333333333333'
});
assert.equal(captured.queued, true);
await session.reconnect();
assert.equal(sessionDelivered.length, 1);
assert.equal(sessionDelivered[0].source, 'driver_app');
assert.equal(sessionDelivered[0].device_id, 'android-session');
assert.equal(sessionDelivered[0].route_run_id, 'run-1');

console.log('driver-app-telemetry ok');

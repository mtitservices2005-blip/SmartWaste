// SW-083 Task 7 (CA-083-1): envío por lotes en orden, reintento sin duplicar, espera exponencial y latido.
import assert from 'node:assert/strict';
import { createPersistentTelemetryQueue, flushInBatches } from '../shared/driver-app-telemetry.js';
import { createHeartbeat, nextRetryDelayMs, heartbeatPosition } from '../shared/driver-app-heartbeat.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
}
const base = { vehicle_id: 'veh-1', municipality_id: 'mun-1', route_run_id: 'run-1', device_id: 'android-abc', latitude: 19.65, longitude: -71.09, accuracy: 8, speed: 5, heading: 90, battery_pct: 80, source: 'driver_app' };
const t0 = Date.parse('2026-10-14T12:00:00.000Z');
const pointAt = (i) => ({ ...base, captured_at: new Date(t0 + i * 10_000).toISOString(), latitude: base.latitude + i * 0.0001 });

// 450 puntos pendientes, encolados al revés: 3 envíos (200, 200, 50) en orden de captured_at.
{
  const queue = createPersistentTelemetryQueue({ storage: memoryStorage() });
  for (let i = 449; i >= 0; i -= 1) await queue.enqueue(pointAt(i));
  const batches = [];
  const result = await flushInBatches({ queue, send: async (batch) => { batches.push(batch.map((p) => p.captured_at)); return { ok: true }; } });
  assert.deepEqual(batches.map((b) => b.length), [200, 200, 50]);
  const flat = batches.flat();
  assert.deepEqual(flat, [...flat].sort(), 'orden cronológico entre y dentro de los lotes');
  assert.equal(flat.length, new Set(flat).size, 'sin duplicados');
  assert.deepEqual(result, { sent: 450, failed: 0 });
  assert.equal((await queue.list()).length, 0);
}

// Falla el lote 2: el 1 queda enviado, el 2 y el 3 siguen en cola; al reconectar no se repite nada.
{
  const queue = createPersistentTelemetryQueue({ storage: memoryStorage() });
  for (let i = 0; i < 450; i += 1) await queue.enqueue(pointAt(i));
  let call = 0;
  const first = await flushInBatches({ queue, send: async () => { call += 1; return call === 2 ? { ok: false, error: { code: 'OFFLINE' } } : { ok: true }; } });
  assert.deepEqual(first, { sent: 200, failed: 250 });
  assert.equal((await queue.list()).length, 250);
  const resent = [];
  const second = await flushInBatches({ queue, send: async (batch) => { resent.push(...batch.map((p) => p.captured_at)); return { ok: true }; } });
  assert.deepEqual(second, { sent: 250, failed: 0 });
  assert.equal(resent[0], pointAt(200).captured_at, 'reanuda justo donde quedó');
  assert.equal(resent.length, 250);
}

// Una excepción de red cuenta como fallo (no pierde puntos ni revienta).
{
  const queue = createPersistentTelemetryQueue({ storage: memoryStorage() });
  await queue.enqueue(pointAt(0));
  const result = await flushInBatches({ queue, send: async () => { throw new Error('network down'); } });
  assert.deepEqual(result, { sent: 0, failed: 1 });
  assert.equal((await queue.list()).length, 1);
}

// Cola vacía: no llama a send. maxBatch pequeño respeta el tope.
{
  const queue = createPersistentTelemetryQueue({ storage: memoryStorage() });
  let calls = 0;
  assert.deepEqual(await flushInBatches({ queue, send: async () => { calls += 1; return { ok: true }; } }), { sent: 0, failed: 0 });
  assert.equal(calls, 0);
  for (let i = 0; i < 5; i += 1) await queue.enqueue(pointAt(i));
  const sizes = [];
  await flushInBatches({ queue, maxBatch: 2, send: async (b) => { sizes.push(b.length); return { ok: true }; } });
  assert.deepEqual(sizes, [2, 2, 1]);
}

// Espera exponencial: 1 s, 2 s, 4 s … tope 60 s.
assert.equal(nextRetryDelayMs(0), 1000);
assert.equal(nextRetryDelayMs(1), 2000);
assert.equal(nextRetryDelayMs(2), 4000);
assert.equal(nextRetryDelayMs(5), 32000);
assert.equal(nextRetryDelayMs(6), 60000);
assert.equal(nextRetryDelayMs(10), 60000);
assert.equal(nextRetryDelayMs(-3), 1000);

// Latido cada 30 s aunque no haya movimiento.
{
  let tick = null;
  let cleared = false;
  const beats = [];
  const heartbeat = createHeartbeat({
    now: () => t0,
    onBeat: (beat) => beats.push(beat),
    setIntervalFn: (fn, ms) => { tick = { fn, ms }; return 7; },
    clearIntervalFn: (id) => { cleared = id === 7; }
  });
  heartbeat.start();
  heartbeat.start();
  assert.equal(tick.ms, 30_000);
  tick.fn(); tick.fn(); tick.fn();
  assert.equal(beats.length, 3);
  assert.equal(beats[0].at, new Date(t0).toISOString());
  heartbeat.stop();
  assert.equal(cleared, true);
}

// El latido reutiliza la última posición con velocidad 0 y hora nueva.
{
  const beat = heartbeatPosition(pointAt(3), new Date(t0 + 99_000));
  assert.equal(beat.latitude, pointAt(3).latitude);
  assert.equal(beat.speed, 0);
  assert.equal(beat.captured_at, new Date(t0 + 99_000).toISOString());
  assert.equal(beat.source, 'driver_app');
  assert.equal(beat.battery_pct, 80);
  assert.equal(heartbeatPosition(null, new Date(t0)), null, 'sin posición previa no hay latido');
}
console.log('driver-app-batching ok');

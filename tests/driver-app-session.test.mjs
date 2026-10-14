// SW-083: la sesión del chofer envía por lotes a ingest_positions, con batería, latido y reintento
// exponencial (CA-083-1, CA-083-3). Todo con relojes y temporizadores falsos.
import assert from 'node:assert/strict';
import { createDriverTelemetrySession, createPersistentTelemetryQueue } from '../shared/driver-app-telemetry.js';

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const operationsAdapter = { findOwnVehicleAssignment: async () => ({ ok: true, data: { vehicle_id: 'veh-1', route_run_id: 'run-1' } }) };
const t0 = Date.now() - 600_000;
const loc = (i) => ({ latitude: 19.65 + i * 0.001, longitude: -71.09, timestamp: t0 + i * 10_000 });

async function make({ send, getBatteryLevel = async () => 0.5, clock = { now: t0 }, timers = fakeTimers() } = {}) {
  const queue = createPersistentTelemetryQueue({ storage: memoryStorage() });
  const singles = [];
  const session = await createDriverTelemetrySession({
    profileId: 'p1', municipalityId: 'mun-1', deviceId: 'android-1', operationsAdapter, queue,
    ingestionAdapter: { ingest: async (p) => { singles.push(p); return { ok: true }; } },
    batchAdapter: { ingestPositions: send },
    getBatteryLevel, now: () => clock.now,
    setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    setIntervalFn: timers.setInterval, clearIntervalFn: timers.clearInterval
  });
  return { session, queue, singles, clock, timers };
}
function fakeTimers() {
  const t = { timeouts: [], intervals: [], cleared: [] };
  t.setTimeout = (fn, ms) => { const id = t.timeouts.length + 1; t.timeouts.push({ id, fn, ms }); return id; };
  t.clearTimeout = (id) => { t.cleared.push(id); };
  t.setInterval = (fn, ms) => { t.intervals.push({ fn, ms }); return 99; };
  t.clearIntervalFn = null;
  t.clearInterval = (id) => { t.cleared.push(`i${id}`); };
  return t;
}

// 1. Tres muestras pendientes salen en UN lote, con batería, sin pasar por el envío de a uno.
{
  const batches = [];
  const { session, queue, singles } = await make({ send: async (batch) => { batches.push(batch); return { ok: true }; } });
  for (let i = 0; i < 3; i += 1) await session.capture(loc(i));
  const result = await session.reconnect();
  assert.equal(result.ok, true);
  assert.equal(result.sent, 3);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.deepEqual(batches[0].map((p) => p.battery_pct), [50, 50, 50]);
  assert.equal(batches[0][0].device_id, 'android-1');
  assert.equal(batches[0][0].vehicle_id, 'veh-1');
  assert.equal(singles.length, 0);
  assert.equal((await queue.list()).length, 0);
}

// 2. Sin batería disponible el punto sale con null y no se pierde.
{
  const batches = [];
  const { session } = await make({ getBatteryLevel: async () => { throw new Error('no api'); }, send: async (b) => { batches.push(b); return { ok: true }; } });
  await session.capture(loc(0));
  await session.reconnect();
  assert.equal(batches[0][0].battery_pct, null);
}

// 3. Fallo -> reintento programado con 1 s, 2 s, 4 s; éxito reinicia la cuenta; stop() cancela.
{
  let ok = false;
  const { session, timers, queue } = await make({ send: async () => (ok ? { ok: true } : { ok: false, error: { code: 'OFFLINE' } }) });
  await session.capture(loc(0));
  let r = await session.reconnect();
  assert.equal(r.ok, false);
  assert.equal(r.pending, 1);
  assert.deepEqual(timers.timeouts.map((x) => x.ms), [1000]);
  await timers.timeouts[0].fn();
  assert.deepEqual(timers.timeouts.map((x) => x.ms), [1000, 2000]);
  await timers.timeouts[1].fn();
  assert.deepEqual(timers.timeouts.map((x) => x.ms), [1000, 2000, 4000]);
  assert.equal(timers.timeouts.length, 3, 'nunca hay dos reintentos pendientes a la vez');
  ok = true;
  await timers.timeouts[2].fn();
  assert.equal((await queue.list()).length, 0);
  assert.equal(timers.timeouts.length, 3, 'tras el éxito no se programa nada más');
  ok = false;
  await session.capture(loc(5));
  await session.reconnect();
  assert.equal(timers.timeouts.at(-1).ms, 1000, 'la espera vuelve a 1 s tras un éxito');
  session.stop();
  assert.equal(timers.cleared.includes(timers.timeouts.at(-1).id), true, 'stop() cancela el reintento pendiente');
}

// 4. Latido: cada 30 s, si no hubo muestra reciente, se envía la última posición con velocidad 0.
{
  const sent = [];
  const clock = { now: t0 };
  const { session, timers } = await make({ clock, send: async (b) => { sent.push(...b); return { ok: true }; } });
  await session.capture(loc(0));
  await session.reconnect();
  session.startHeartbeat();
  assert.equal(timers.intervals[0].ms, 30_000);
  clock.now = t0 + 5_000;
  await timers.intervals[0].fn();
  assert.equal(sent.length, 1, 'hubo una muestra hace 5 s: no hace falta latido');
  clock.now = t0 + 40_000;
  await timers.intervals[0].fn();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].speed, 0);
  assert.equal(sent[1].captured_at, new Date(t0 + 40_000).toISOString());
  assert.equal(sent[1].latitude, sent[0].latitude);
  assert.equal(sent[1].route_run_id, 'run-1');
  session.stop();
  assert.equal(timers.cleared.includes('i99'), true);
}

// 5. Sin ninguna muestra previa el latido no inventa posiciones.
{
  const sent = [];
  const { session, timers } = await make({ send: async (b) => { sent.push(...b); return { ok: true }; } });
  session.startHeartbeat();
  await timers.intervals[0].fn();
  assert.equal(sent.length, 0);
}
// 6. La sesión expone su asignación (camión y corrida) para asociar el combustible (CA-083-4).
{
  const { session } = await make({ send: async () => ({ ok: true }) });
  assert.deepEqual(session.assignment, { vehicle_id: 'veh-1', route_run_id: 'run-1' });
}
console.log('driver-app-session ok');

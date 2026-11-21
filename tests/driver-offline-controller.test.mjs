// SW-095: el controlador del conductor sin internet: abre con copia, inicia, termina con combustible y sincroniza.
import assert from 'node:assert/strict';
import { createDriverController } from '../frontend/driver-app.js';
import { createDriverCache } from '../shared/driver-offline-cache.js';
import { createDriverActionQueue } from '../shared/driver-action-queue.js';

const NOW = new Date('2026-10-14T12:20:00Z'); // 8:20 a. m. en Santo Domingo
const stops = [{ sequence: 1, label: 'Calle Duarte 10', latitude: 19.0, longitude: -71.0 }];
const runsFor = () => ([{ id: 'run1', routeId: 'r1', vehicleId: 'v1', status: 'assigned', createdAt: '2026-10-13T10:00:00Z', scheduledStartAt: '2026-10-14T12:00:00Z', startedAt: null, routeName: 'Ruta Centro', stopsCount: 1, stops, distanceText: '—', estimatedMinutes: null }]);
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };

function setup({ online = true, storage = mem(), loadError = null, rejectStart = false } = {}) {
  const env = { online, log: [], draws: [], toasts: [], storage };
  const net = { ok: false, error: { message: 'TypeError: Failed to fetch' } };
  const serverRuns = runsFor();
  env.adapter = {
    startRoute: async (routeId, opts) => { env.log.push(['startRoute', routeId, opts]); if (!env.online) return net; if (rejectStart) return { ok: false, error: { code: '42501', message: 'permiso denegado' } }; serverRuns[0].status = 'started'; return { ok: true, data: { started_at: opts?.at ?? '2026-10-14T12:21:00Z' } }; },
    completeRoute: async (routeId, opts) => { env.log.push(['completeRoute', routeId, opts]); if (!env.online) return net; serverRuns[0].status = 'completed'; return { ok: true, data: {} }; },
    findOwnVehicleAssignment: async () => (env.online ? { ok: true, data: { vehicle_id: 'v1', route_run_id: 'run1', route_id: 'r1' } } : net),
    logFuel: async (entry) => { env.log.push(['logFuel', entry]); return env.online ? { ok: true } : net; },
    listFuelLogs: async () => ({ ok: true, data: [] })
  };
  env.gps = { active: false, start: async () => { env.log.push(['gps.start']); env.gps.active = true; }, stop: async (o) => { env.log.push(['gps.stop', o]); env.gps.active = false; }, isActive: () => env.gps.active };
  env.queue = createDriverActionQueue({ storage, now: () => NOW });
  env.cache = createDriverCache({ storage: { getItem: (k) => storage.getItem(`c:${k}`), setItem: (k, v) => storage.setItem(`c:${k}`, v) }, now: () => NOW });
  env.c = createDriverController({
    load: async () => {
      if (loadError) return loadError;
      return env.online ? { ok: true, driver: { id: 'd1', display_name: 'Carlos Peña' }, unit: 'C-01', runs: serverRuns.map((r) => ({ ...r })) } : { ok: false, message: 'TypeError: Failed to fetch' };
    },
    adapter: env.adapter, gps: env.gps, municipalityId: 'm1', userId: 'u1', queue: env.queue, cache: env.cache, isOnline: () => env.online,
    gpsFlush: async () => { env.log.push(['gpsFlush']); },
    toast: (m, o) => env.toasts.push([m, o?.type ?? 'info']), draw: (screen, html) => env.draws.push({ screen, html }), now: () => NOW, logout: async () => {}
  });
  env.last = () => env.draws[env.draws.length - 1];
  return env;
}

// (a) con red guarda la copia; sin red abre con ella
let e = setup();
await e.c.refresh();
assert.equal(e.c.state.offline, false);
e.online = false;
await e.c.refresh();
assert.equal(e.last().screen, 'today');
assert.equal(e.c.state.offline, true);
assert.ok(e.last().html.includes('Ruta Centro') && e.last().html.includes('Sin conexión'));

// (b) sin red y sin copia: pantalla de error con reintento
e = setup({ online: false });
await e.c.refresh();
assert.equal(e.last().screen, 'error'); assert.ok(e.last().html.includes('data-driver-retry'));

// (c) un error de permisos con copia guardada NO usa la copia
e = setup();
await e.c.refresh();
const denied = setup({ loadError: { ok: false, message: 'permission denied for table route_runs' }, storage: e.storage });
await denied.c.refresh();
assert.equal(denied.last().screen, 'error'); assert.equal(denied.c.state.offline, false);

// (d) iniciar sin red: no hay llamada de red que cuente, el GPS arranca, queda 1 acción start
e = setup(); await e.c.refresh(); e.online = false;
await e.c.action('start', 'run1');
assert.ok(e.log.some((l) => l[0] === 'gps.start'));
assert.equal(e.last().screen, 'run');
const acts = await e.queue.list();
assert.deepEqual(acts.map((a) => [a.type, a.runId, a.routeId]), [['start', 'run1', 'r1']]);
assert.equal(acts[0].at, NOW.toISOString());
assert.ok(e.last().html.includes('1 pendiente de enviar'));

// (e) terminar sin red con 5 galones: fuel + complete en cola, GPS apagado, vuelve a Hoy
await e.c.action('finish-open');
await e.c.action('finish-save', '5');
const q2 = await e.queue.list();
assert.deepEqual(q2.map((a) => a.type), ['start', 'fuel', 'complete']);
assert.deepEqual(q2[1].entry, { vehicle_id: 'v1', route_run_id: 'run1', liters: 18.93, municipality_id: 'm1' });
assert.deepEqual(e.log.find((l) => l[0] === 'gps.stop')[1], { flush: true });
assert.equal(e.last().screen, 'today');
assert.ok(!e.last().html.includes('data-driver-start-route="run1"'), 'la corrida terminada no se ofrece otra vez');
assert.ok(e.last().html.includes('3 pendientes de enviar'));

// (f) vuelve la señal: syncQueue envía start → fuel → complete en orden, con la corrida exacta, y la cola queda vacía
e.log.length = 0; e.online = true;
await e.c.syncQueue();
assert.deepEqual(e.log.filter((l) => ['startRoute', 'logFuel', 'completeRoute'].includes(l[0])).map((l) => l[0]), ['startRoute', 'logFuel', 'completeRoute']);
assert.equal(e.log.find((l) => l[0] === 'startRoute')[2].runId, 'run1');
assert.ok(e.log.some((l) => l[0] === 'gpsFlush'));
assert.equal(await e.queue.pendingCount(), 0);
assert.equal(e.c.state.pendingActions, 0);

// (g) rechazo del servidor: aparece "No se pudo enviar" con Reintentar/Descartar, y descartar limpia
e = setup({ rejectStart: true }); await e.c.refresh(); e.online = false;
await e.c.action('start', 'run1'); e.online = true;
await e.c.syncQueue();
assert.equal(e.c.state.failedActions.length, 1);
assert.ok(/No se pudo enviar/.test(e.c.state.failedActions[0].text) && /permiso denegado/.test(e.c.state.failedActions[0].text));
const id = e.c.state.failedActions[0].id;
await e.c.action('discard-action', id);
assert.equal(e.c.state.failedActions.length, 0); assert.equal(await e.queue.pendingCount(), 0);

// (h) con red y cola vacía el camino es el de siempre (pasa solo la corrida exacta)
e = setup(); await e.c.refresh();
await e.c.action('start', 'run1');
assert.equal(await e.queue.pendingCount(), 0);
assert.deepEqual(e.log.slice(0, 2).map((l) => l[0]), ['startRoute', 'gps.start']);
console.log('driver-offline-controller: ok');

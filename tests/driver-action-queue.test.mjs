// SW-095: cola de acciones del conductor (iniciar, combustible, terminar) con envío ordenado e idempotente.
import assert from 'node:assert/strict';
import { createDriverActionQueue, sanitizeActionTime } from '../shared/driver-action-queue.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
let n = 0; const newId = () => `a${++n}`;
const mk = (storage = mem()) => createDriverActionQueue({ storage, now: () => NOW, newId });

// ---- sanitizeActionTime ----
const iso = (d) => new Date(d).toISOString();
assert.equal(sanitizeActionTime('2026-10-17T11:00:00Z', { now: NOW }), iso('2026-10-17T11:00:00Z'));
assert.equal(sanitizeActionTime('2026-10-17T12:10:00Z', { now: NOW }), undefined, 'futura > 5 min');
assert.equal(sanitizeActionTime('2026-10-17T12:04:00Z', { now: NOW }), iso('2026-10-17T12:04:00Z'), 'futura <= 5 min vale');
assert.equal(sanitizeActionTime('2026-10-14T12:00:00Z', { now: NOW }), undefined, 'más de 2 días');
assert.equal(sanitizeActionTime('2020-01-01T00:00:00Z', { now: NOW }), undefined, 'año equivocado');
assert.equal(sanitizeActionTime('basura', { now: NOW }), undefined);
assert.equal(sanitizeActionTime(undefined, { now: NOW }), undefined);
assert.equal(sanitizeActionTime('2026-10-17T09:00:00Z', { now: NOW, startedAt: '2026-10-17T10:00:00Z' }), iso('2026-10-17T10:00:00Z'), 'completed >= started');

// ---- adaptador falso ----
function fakeAdapter({ failOn = {}, fuelRows = [] } = {}) {
  const calls = [];
  const res = (name, id) => { const f = failOn[name]; return typeof f === 'function' ? f(id) : f ?? { ok: true, data: {} }; };
  return {
    calls,
    startRoute: async (routeId, opts) => { calls.push(['start', routeId, opts]); return res('start', routeId); },
    completeRoute: async (routeId, opts) => { calls.push(['complete', routeId, opts]); return res('complete', routeId); },
    logFuel: async (entry) => { calls.push(['fuel', entry]); fuelRows.push({ ...entry }); return res('fuel', entry.route_run_id); },
    listFuelLogs: async () => ({ ok: true, data: fuelRows })
  };
}
const entry = { vehicle_id: 'v1', route_run_id: 'run1', liters: 20.82, municipality_id: 'm1' };
const A = (type, runId, extra = {}) => ({ type, runId, routeId: `r-${runId}`, at: '2026-10-17T11:00:00Z', ...extra });

// orden por corrida: start -> gps -> fuel -> complete (aunque se encolen revueltas)
let q = mk(); let ad = fakeAdapter(); const order = [];
await q.enqueue(A('complete', 'run1', { at: '2026-10-17T11:50:00Z' }));
await q.enqueue(A('fuel', 'run1', { entry }));
await q.enqueue(A('start', 'run1'));
let r = await q.flush({ adapter: ad, gpsFlush: async () => { order.push('gps'); } });
assert.deepEqual(ad.calls.map((c) => c[0]), ['start', 'fuel', 'complete']);
assert.deepEqual(order, ['gps'], 'el GPS pendiente sube una vez antes de fuel/complete');
assert.equal(ad.calls[0][2].runId, 'run1'); assert.equal(ad.calls[0][2].at, iso('2026-10-17T11:00:00Z'));
assert.equal(ad.calls[2][2].at, iso('2026-10-17T11:50:00Z'));
assert.deepEqual(r, { sent: 3, failed: 0, stoppedByNetwork: false });
assert.equal(await q.pendingCount(), 0);

// complete sin start en cola: at válido pasa; at anterior al start en cola se sube al start
q = mk(); ad = fakeAdapter();
await q.enqueue(A('start', 'run1', { at: '2026-10-17T11:00:00Z' }));
await q.enqueue(A('complete', 'run1', { at: '2026-10-17T10:00:00Z' }));
await q.flush({ adapter: ad });
assert.equal(ad.calls[1][2].at, iso('2026-10-17T11:00:00Z'));

// ya aplicado en el servidor = hecho (start/complete)
const invalidMsg = (m) => ({ ok: false, error: { code: 'INVALID_ROUTE_TRANSITION', message: `Rejected route transition ${m}` } });
q = mk(); ad = fakeAdapter({ failOn: { start: invalidMsg('in_progress->started'), complete: invalidMsg('completed->completed') } });
await q.enqueue(A('start', 'run1')); await q.enqueue(A('complete', 'run1'));
r = await q.flush({ adapter: ad });
assert.equal(r.sent, 2); assert.equal(r.failed, 0); assert.equal(await q.pendingCount(), 0);

// cancelada por el despacho mientras estaba sin red: NO es "ya aplicada", queda failed con aviso
q = mk(); ad = fakeAdapter({ failOn: { start: invalidMsg('cancelled->started') } });
await q.enqueue(A('start', 'run1')); await q.enqueue(A('complete', 'run1'));
r = await q.flush({ adapter: ad });
assert.equal(r.failed, 1); assert.equal(r.sent, 0);
assert.equal((await q.list()).find((x) => x.status === 'failed').type, 'start');
q = mk(); ad = fakeAdapter({ failOn: { complete: invalidMsg('cancelled->completed') } });
await q.enqueue(A('complete', 'run1'));
r = await q.flush({ adapter: ad }); assert.equal(r.failed, 1, 'completar una corrida cancelada no se da por hecho');
q = mk(); ad = fakeAdapter({ failOn: { complete: { ok: false, error: { code: 'INVALID_ROUTE_TRANSITION', message: 'sin formato' } } } });
await q.enqueue(A('complete', 'run1')); r = await q.flush({ adapter: ad }); assert.equal(r.failed, 1, 'mensaje irreconocible: no se asume hecho');

// el GPS pendiente no subió: no se completa la corrida (las métricas saldrían sin sus puntos)
q = mk(); ad = fakeAdapter();
await q.enqueue(A('fuel', 'run1', { entry })); await q.enqueue(A('complete', 'run1'));
r = await q.flush({ adapter: ad, gpsFlush: async () => ({ ok: false }) });
assert.equal(r.stoppedByNetwork, true); assert.equal(ad.calls.length, 0); assert.equal(await q.pendingCount(), 2);
r = await q.flush({ adapter: ad, gpsFlush: async () => { throw new Error('x'); } });
assert.equal(ad.calls.length, 0, 'si el GPS lanza, tampoco se completa');
r = await q.flush({ adapter: ad, gpsFlush: async () => ({ ok: true }) });
assert.equal(r.sent, 2);

// combustible ya guardado (corte a mitad): no se duplica
const rows = [{ route_run_id: 'run1', vehicle_id: 'v1', liters: 20.82 }];
q = mk(); ad = fakeAdapter({ fuelRows: rows });
await q.enqueue(A('fuel', 'run1', { entry }));
r = await q.flush({ adapter: ad });
assert.equal(ad.calls.filter((c) => c[0] === 'fuel').length, 0); assert.equal(r.sent, 1);

// corte de red: se detiene, queda pendiente y no se llama complete
const net = { ok: false, error: { message: 'TypeError: Failed to fetch' } };
q = mk(); ad = fakeAdapter({ failOn: { fuel: net } });
await q.enqueue(A('fuel', 'run1', { entry })); await q.enqueue(A('complete', 'run1'));
r = await q.flush({ adapter: ad });
assert.equal(r.stoppedByNetwork, true); assert.equal(ad.calls.some((c) => c[0] === 'complete'), false);
assert.equal(await q.pendingCount(), 2);
assert.ok((await q.list()).every((a) => a.status === 'pending'));
// sin señal declarada: ni se intenta
q = mk(); ad = fakeAdapter(); await q.enqueue(A('start', 'run1'));
r = await q.flush({ adapter: ad, isOnline: () => false });
assert.equal(ad.calls.length, 0); assert.equal(r.stoppedByNetwork, true);

// rechazo del servidor en la corrida A: A queda failed y sin seguir; B continúa
const denied = { ok: false, error: { code: '42501', message: 'permiso denegado' } };
q = mk(); ad = fakeAdapter({ failOn: { start: (id) => (id === 'r-runA' ? denied : { ok: true, data: {} }) } });
await q.enqueue(A('start', 'runA')); await q.enqueue(A('complete', 'runA')); await q.enqueue(A('start', 'runB')); await q.enqueue(A('complete', 'runB'));
r = await q.flush({ adapter: ad });
assert.equal(r.failed, 1); assert.equal(r.sent, 2);
assert.deepEqual(ad.calls.map((c) => `${c[0]}:${c[1]}`), ['start:r-runA', 'start:r-runB', 'complete:r-runB']);
let list = await q.list();
const failed = list.filter((a) => a.status === 'failed'); assert.equal(failed.length, 1); assert.equal(failed[0].error, 'permiso denegado');
assert.equal(list.filter((a) => a.runId === 'runA').length, 2, 'complete de A queda en cola, no se pierde');
assert.equal(await q.pendingCount(), 2);
// reintentar
ad = fakeAdapter(); await q.retry(failed[0].id); r = await q.flush({ adapter: ad });
assert.deepEqual(ad.calls.map((c) => c[0]), ['start', 'complete']); assert.equal(await q.pendingCount(), 0);
// descartar
q = mk(); ad = fakeAdapter({ failOn: { start: denied } }); await q.enqueue(A('start', 'runA'));
await q.flush({ adapter: ad }); const [bad] = await q.list(); await q.discard(bad.id); assert.equal((await q.list()).length, 0);

// persistencia y JSON dañado
const st = mem(); q = mk(st); await q.enqueue(A('start', 'run1'));
assert.equal((await mk(st).list()).length, 1);
const dmg = mem(); dmg.setItem('smartwaste.driver-actions.v1', '{roto'); assert.deepEqual(await mk(dmg).list(), []);

// flush simultáneo: cada llamada una sola vez
q = mk(); ad = fakeAdapter(); await q.enqueue(A('start', 'run1')); await q.enqueue(A('complete', 'run1'));
await Promise.all([q.flush({ adapter: ad }), q.flush({ adapter: ad })]);
assert.equal(ad.calls.length, 2);
console.log('driver-action-queue: ok');

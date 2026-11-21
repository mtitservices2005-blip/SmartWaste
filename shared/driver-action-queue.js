// SW-095: cola local de acciones del conductor hechas sin internet: iniciar, combustible, terminar.
// Se envían por corrida y en orden (iniciar → GPS pendiente → combustible → terminar). Un fallo de red detiene
// el envío sin perder nada; un rechazo del servidor marca esa acción como "failed" y frena solo su corrida.
import { isNetworkFailure } from './driver-offline-net.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const RANK = { start: 0, fuel: 1, complete: 2 };

// Hora del teléfono → ISO usable, o undefined (se usa la hora del servidor) si no es creíble.
export function sanitizeActionTime(at, { now = new Date(), startedAt } = {}) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return undefined;
  if (t > now.getTime() + 5 * MIN || t < now.getTime() - 2 * DAY) return undefined;
  const s = Date.parse(startedAt);
  if (Number.isFinite(s) && t < s) return new Date(s).toISOString();
  return new Date(t).toISOString();
}

export function createDriverActionQueue({ storage, key = 'smartwaste.driver-actions.v1', now = () => new Date(), newId = () => globalThis.crypto.randomUUID() } = {}) {
  let items = null;
  let flushPromise = null;
  let seq = 0;

  async function load() {
    if (items) return items;
    try {
      const parsed = JSON.parse((await storage.getItem(key)) || '[]');
      items = Array.isArray(parsed) ? parsed.filter((a) => a && RANK[a.type] !== undefined && a.runId) : [];
    } catch { items = []; }
    return items;
  }
  const save = async () => { try { await storage.setItem(key, JSON.stringify(items)); } catch { /* almacenamiento no disponible */ } };

  const queue = {
    async enqueue(action) {
      await load();
      const id = newId();
      items.push({ ...action, id, status: 'pending', createdAt: now().toISOString(), seq: seq += 1 });
      await save();
      return id;
    },
    async list() { await load(); return items.map((a) => ({ ...a })); },
    async pendingCount() { await load(); return items.length; },
    async retry(id) { await load(); const a = items.find((x) => x.id === id); if (a) { a.status = 'pending'; delete a.error; await save(); } },
    async discard(id) { await load(); items = items.filter((x) => x.id !== id); await save(); },

    flush({ adapter, gpsFlush = async () => {}, isOnline = () => true }) {
      if (flushPromise) return flushPromise;
      flushPromise = (async () => {
        await load();
        const summary = { sent: 0, failed: 0, stoppedByNetwork: false };
        if (!items.length) return summary;
        if (isOnline() === false) { summary.stoppedByNetwork = true; return summary; }
        const runIds = [...new Set(items.map((a) => a.runId))];
        for (const runId of runIds) {
          const mine = items.filter((a) => a.runId === runId).sort((a, b) => RANK[a.type] - RANK[b.type] || (a.seq ?? 0) - (b.seq ?? 0));
          const startedAt = mine.find((a) => a.type === 'start')?.at;
          let gpsDone = false;
          for (const a of mine) {
            if (a.status === 'failed') break; // lo que sigue en esta corrida depende de esta acción
            if (a.type !== 'start' && !gpsDone) { gpsDone = true; try { await gpsFlush(); } catch { /* el GPS se reintenta solo */ } }
            const result = await attempt(adapter, a, startedAt);
            if (result.ok || result.error?.code === 'INVALID_ROUTE_TRANSITION') { // ya estaba aplicada = hecho
              items = items.filter((x) => x.id !== a.id); summary.sent += 1; await save(); continue;
            }
            if (isNetworkFailure(result)) { summary.stoppedByNetwork = true; return summary; }
            a.status = 'failed'; a.error = result.error?.message ?? 'Error desconocido'; summary.failed += 1; await save();
            break;
          }
        }
        return summary;
      })();
      return flushPromise.finally(() => { flushPromise = null; });
    }
  };

  async function attempt(adapter, a, startedAt) {
    if (a.type === 'start') return adapter.startRoute(a.routeId, { at: sanitizeActionTime(a.at, { now: now() }), runId: a.runId });
    if (a.type === 'complete') return adapter.completeRoute(a.routeId, { at: sanitizeActionTime(a.at, { now: now(), startedAt }), runId: a.runId });
    // fuel: si ya llegó (corte justo antes de la respuesta), no se duplica
    const e = a.entry ?? {};
    const existing = await adapter.listFuelLogs?.();
    if (existing?.ok && (existing.data ?? []).some((r) => r.route_run_id === e.route_run_id && r.vehicle_id === e.vehicle_id && Number(r.liters) === Number(e.liters))) return { ok: true };
    return adapter.logFuel(e);
  }
  return queue;
}

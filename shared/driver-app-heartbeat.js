// SW-083: latido y reintentos de la app del chofer.
// El latido avisa "sigo aquí" cada 30 s aunque el camión esté quieto, para que el centro de control
// distinga "detenido" (hay latido, velocidad 0) de "sin señal" (no llega nada por más de 90 s).

export const HEARTBEAT_INTERVAL_MS = 30_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

// 1 s, 2 s, 4 s, 8 s … hasta un tope de 60 s.
export function nextRetryDelayMs(attempt) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(n, 16));
}

export function createHeartbeat({
  intervalMs = HEARTBEAT_INTERVAL_MS,
  now = () => Date.now(),
  onBeat,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (id) => clearInterval(id)
} = {}) {
  let timer = null;
  return {
    start() {
      if (timer !== null) return;
      timer = setIntervalFn(() => onBeat?.({ at: new Date(now()).toISOString() }), intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    }
  };
}

// Punto de latido: la última posición conocida, velocidad 0 y hora nueva.
export function heartbeatPosition(lastPosition, at = new Date()) {
  if (!lastPosition) return null;
  return { ...lastPosition, speed: 0, captured_at: new Date(at).toISOString() };
}

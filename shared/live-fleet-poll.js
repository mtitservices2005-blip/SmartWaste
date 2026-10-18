export const POLL_INTERVAL_MS = 15000;
const MAX_BACKOFF_MS = 60000;

export function pollLiveFleet({
  fetchFleet,
  onData,
  onError,
  intervalMs = POLL_INTERVAL_MS,
  timers = globalThis,
  doc = globalThis.document,
} = {}) {
  let stopped = false;
  let inFlight = false;
  let timer = null;
  let delay = intervalMs;

  const clear = () => {
    if (timer != null) { timers.clearTimeout(timer); timer = null; }
  };
  const schedule = () => {
    clear();
    if (stopped || doc?.hidden) return;
    timer = timers.setTimeout(run, delay);
  };
  async function run() {
    timer = null;
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const data = await fetchFleet();
      if (stopped) return;
      delay = intervalMs;
      onData?.(data);
    } catch (err) {
      if (stopped) return;
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      onError?.(err);
    } finally {
      inFlight = false;
    }
    schedule();
  }
  const onVisibility = () => {
    if (stopped) return;
    if (doc.hidden) { clear(); return; }
    clear();
    run();
  };
  doc?.addEventListener?.('visibilitychange', onVisibility);
  run();

  return {
    refreshNow() { if (!stopped && !inFlight) { clear(); run(); } },
    stop() {
      stopped = true;
      clear();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}

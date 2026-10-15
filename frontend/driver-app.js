// SW-085: la app del conductor. El controlador (createDriverController) no toca el DOM ni la red por su
// cuenta: recibe adaptador, GPS y dibujo por parámetro, así se prueba entero. mountDriverApp() lo conecta al
// navegador (clics, mapa, posición). Hoy → Iniciar → En ruta → Terminar → Hoy.
import { renderDriverToday, renderDriverRun, renderDriverFinish, renderDriverLoadError } from './components/driver-screens.js';
import { selectTodayRoutes, formatTodayText } from '../shared/driver-today.js';
import { loadDriverToday } from '../shared/driver-data.js';
import { nextStopInfo, formatElapsed, formatDistance, markVisitedStops, haversineMeters } from '../shared/driver-nav.js';
import { parseFuelLiters, buildFuelEntry } from '../shared/fuel-entry.js';

const firstName = (full) => String(full ?? '').trim().split(/\s+/)[0] ?? '';

export function createDriverController({ load, adapter, gps, municipalityId, userId, toast = () => {}, draw, now = () => new Date(), logout = async () => {} }) {
  const state = { screen: 'today', data: null, error: '', runId: null, startedAt: {}, visited: {}, position: null, finishError: '', fuelValue: '', fuelSaved: {}, busy: false };
  const c = { state, onField: null };

  const runs = () => state.data?.runs ?? [];
  const currentRun = () => runs().find((r) => r.id === state.runId) ?? null;
  const visitedOf = (id) => (state.visited[id] ??= new Set());
  const emit = (field, value) => c.onField?.(field, value);

  function runView(run) {
    const info = nextStopInfo({ stops: run.stops, position: state.position, visited: visitedOf(run.id) });
    return {
      info,
      timeText: formatElapsed(run.startedAt ?? state.startedAt[run.id], now()),
      distanceText: run.distanceText ?? '—'
    };
  }

  function render() {
    if (state.error) { draw('error', renderDriverLoadError({ message: state.error })); return; }
    if (state.screen === 'run' || state.screen === 'finish') {
      const run = currentRun();
      if (run) {
        const v = runView(run);
        if (state.screen === 'run') {
          draw('run', renderDriverRun({ unit: state.data.unit, connected: globalThis.navigator?.onLine !== false, routeName: run.routeName, progressText: v.info.progressText, nextStopLabel: v.info.label, nextStopDistance: v.info.distanceText, timeText: v.timeText, distanceText: v.distanceText, pendingText: v.info.total ? String(v.info.pending) : '—' }));
        } else {
          draw('finish', renderDriverFinish({ routeName: run.routeName, timeText: v.timeText, distanceText: v.distanceText, stopsText: v.info.total ? `${v.info.done}/${v.info.total}` : '—', errorMessage: state.finishError, fuelValue: state.fuelValue }));
        }
        return;
      }
      state.screen = 'today';
    }
    const today = selectTodayRoutes(runs(), { now: now() });
    draw('today', renderDriverToday({
      name: firstName(state.data?.driver?.display_name), dateText: formatTodayText(now()), unit: state.data?.unit ?? null, gpsActive: Boolean(gps.isActive?.()),
      routes: today.items.map((r) => ({ id: r.id, routeName: r.routeName, stopsCount: r.stopsCount, distanceText: r.distanceText, estimatedMinutes: r.estimatedMinutes, slot: r.slot, startLabel: r.startLabel }))
    }));
  }

  c.refresh = async () => {
    const res = await load();
    if (!res.ok) { state.error = res.message ?? 'Error desconocido.'; render(); return; }
    state.error = '';
    state.data = res;
    if (state.screen === 'today') {
      const { activeId } = selectTodayRoutes(res.runs, { now: now() });
      if (activeId) { state.runId = activeId; state.screen = 'run'; await gps.start(); }
    }
    render();
  };

  // Rutas nuevas sin cerrar la app: solo se recarga en la pantalla Hoy y sin acciones en curso.
  c.refreshIfIdle = async () => { if (state.screen !== 'today' || state.busy) return; await c.refresh(); };

  c.setPosition = (position) => {
    state.position = position;
    const run = currentRun();
    if (!run || state.screen !== 'run') return;
    state.visited[run.id] = markVisitedStops(run.stops, position, visitedOf(run.id));
    const v = runView(run);
    emit('progress', v.info.progressText);
    emit('next-label', v.info.label ?? 'Sin paradas pendientes');
    emit('next-distance', v.info.distanceText);
    emit('pending', v.info.total ? String(v.info.pending) : '—');
    emit('time', v.timeText);
  };

  c.tick = () => { const run = currentRun(); if (run && state.screen === 'run') emit('time', runView(run).timeText); };

  async function start(id) {
    const run = runs().find((r) => r.id === id);
    if (!run || state.busy) return;
    state.busy = true;
    try {
      const res = await adapter.startRoute(run.routeId);
      if (!res?.ok) { toast(`No se pudo iniciar "${run.routeName}": ${res?.error?.message ?? 'error desconocido'}`, { type: 'error' }); return; }
      state.startedAt[run.id] = res.data?.started_at ?? now().toISOString();
      await gps.start();
      state.runId = run.id; state.screen = 'run'; state.finishError = ''; state.fuelValue = '';
      render();
      await c.refresh();
    } finally { state.busy = false; }
  }

  async function finish(text) {
    const run = currentRun();
    if (!run || state.busy) return;
    state.fuelValue = String(text ?? '');
    const fuel = parseFuelLiters(text);
    if (!fuel.ok) { state.finishError = fuel.message; render(); return; }
    state.busy = true;
    try {
      if (fuel.liters != null && !state.fuelSaved[run.id]) {
        const assignment = await adapter.findOwnVehicleAssignment(userId);
        const entry = buildFuelEntry({ liters: fuel.liters, assignment: assignment?.data, municipalityId });
        if (entry) {
          const saved = await adapter.logFuel(entry);
          if (saved?.ok) state.fuelSaved[run.id] = true;
          else toast(`No se pudo guardar el combustible: ${saved?.error?.message ?? 'error desconocido'}. Avisa a tu supervisor.`, { type: 'error' });
        }
      }
      await gps.stop({ flush: true });
      const done = await adapter.completeRoute(run.routeId);
      if (!done?.ok) { state.finishError = `No se pudo terminar la ruta: ${done?.error?.message ?? 'error desconocido'}. Inténtalo de nuevo.`; render(); return; }
      toast(`Ruta "${run.routeName}" terminada.`);
      state.screen = 'today'; state.runId = null; state.finishError = ''; state.fuelValue = '';
      await c.refresh();
    } finally { state.busy = false; }
  }

  c.action = async (name, payload) => {
    if (name === 'start') return start(payload);
    if (name === 'open-run') { state.runId = payload; state.screen = 'run'; return render(); }
    if (name === 'finish-open') { state.screen = 'finish'; state.finishError = ''; return render(); }
    if (name === 'finish-back') { state.screen = 'run'; state.finishError = ''; return render(); }
    if (name === 'finish-save') return finish(payload);
    if (name === 'retry') return c.refresh();
    if (name === 'logout') { if (gps.isActive?.()) await gps.stop({ flush: true }); return logout(); }
    return undefined;
  };

  c.routeCoordinates = () => (currentRun()?.stops ?? []).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)).map((s) => [s.latitude, s.longitude]);
  return c;
}

// ---- Conexión con el navegador / WebView ----
export async function mountDriverApp({ root, client, ctx, adapter, gps, toast, logout, win = globalThis.window, nav = globalThis.navigator }) {
  const userResult = await client.auth.getUser();
  const email = userResult?.data?.user?.email ?? '';
  let map = null; let marker = null;

  const controller = createDriverController({
    load: () => loadDriverToday(client, { userId: ctx.user_id, municipalityId: ctx.municipality_id, email }),
    adapter, gps, toast, logout, municipalityId: ctx.municipality_id, userId: ctx.user_id,
    draw: (screen, html) => {
      if (map) { map.remove(); map = null; marker = null; }
      root.innerHTML = html;
      if (screen === 'run' && win?.L) {
        map = win.L.map('driverRunMap', { zoomControl: false, attributionControl: false });
        win.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        const css = win.getComputedStyle(win.document.documentElement);
        const color = css.getPropertyValue('--color-primary').trim() || '#3d7a00';
        const coords = controller.routeCoordinates();
        if (coords.length) { win.L.polyline(coords, { color, weight: 5 }).addTo(map); map.fitBounds(coords, { padding: [40, 40] }); } else { map.setView([19.0, -71.0], 15); }
        if (controller.state.position) { marker = win.L.circleMarker([controller.state.position.latitude, controller.state.position.longitude], { radius: 8, color: '#fff', fillColor: color, fillOpacity: 1 }).addTo(map); }
      }
    }
  });

  controller.onField = (field, value) => {
    root.querySelectorAll(`[data-driver-field="${field}"]`).forEach((el) => { el.textContent = value; });
    if (field === 'progress' && controller.state.position && map && win?.L) {
      const p = [controller.state.position.latitude, controller.state.position.longitude];
      if (marker) marker.setLatLng(p); else marker = win.L.circleMarker(p, { radius: 8, color: '#fff', fillOpacity: 1 }).addTo(map);
    }
  };

  root.addEventListener('click', (event) => {
    const t = event.target.closest?.('[data-driver-start-route],[data-driver-open-run],[data-driver-finish-open],[data-driver-finish-back],[data-driver-finish-save],[data-driver-retry],[data-driver-logout]');
    if (!t) return;
    const d = t.dataset;
    if ('driverStartRoute' in d) controller.action('start', d.driverStartRoute);
    else if ('driverOpenRun' in d) controller.action('open-run', d.driverOpenRun);
    else if ('driverFinishOpen' in d) controller.action('finish-open');
    else if ('driverFinishBack' in d) controller.action('finish-back');
    else if ('driverFinishSave' in d) controller.action('finish-save', root.querySelector('#driverFuelLiters')?.value ?? '');
    else if ('driverRetry' in d) controller.action('retry');
    else if ('driverLogout' in d) controller.action('logout');
  });

  nav?.geolocation?.watchPosition?.((p) => controller.setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  const setConn = () => {
    const on = nav?.onLine !== false;
    root.querySelectorAll('[data-driver-field="connected"]').forEach((el) => { el.textContent = on ? 'Conectado' : 'Sin conexión'; el.classList.toggle('sw-driver__chip--on', on); el.classList.toggle('sw-driver__chip--off', !on); });
  };
  win?.addEventListener?.('online', setConn); win?.addEventListener?.('offline', setConn);
  win?.setInterval?.(() => controller.tick(), 30000);
  win?.setInterval?.(() => controller.refreshIfIdle(), 60000);
  win?.document?.addEventListener?.('visibilitychange', () => { if (win.document.visibilityState === 'visible') controller.refreshIfIdle(); });

  await controller.refresh();
  return controller;
}

export { haversineMeters, formatDistance };

// SW-097: página pública /en-vivo?m=<slug>. Solo lectura: consulta la RPC public_live_fleet cada 15 s.
import { normalizeLiveFleet, describeVehicleStatus } from '../shared/live-fleet.js';
import { pollLiveFleet } from '../shared/live-fleet-poll.js';
import { renderLiveHeader, renderLiveVehicleList, renderLiveEmpty, renderLiveError, renderLiveNoMunicipality, renderLiveMarker, renderLiveIconPicker, LIVE_ICONS } from './components/live-map.js';

const ICON_KEY = 'smartwaste-live-icon';
const FOCUS_ZOOM = 16;

function agoText(seconds) {
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.floor(seconds / 60)} min`;
}

export function mountLiveMap({ root, win = globalThis, fetchFleet, loadLeaflet, slug } = {}) {
  if (!slug) {
    root.innerHTML = `<div class="live-shell">${renderLiveNoMunicipality()}</div>`;
    return { stop() {} };
  }
  root.innerHTML = '<div class="live-shell"><div id="liveHeader"></div><div class="live-body"><div class="live-map"><div id="liveMapCanvas" class="live-map__canvas"></div></div><div id="livePanel" class="live-panel"></div></div></div>';
  const $header = root.querySelector('#liveHeader');
  const $panel = root.querySelector('#livePanel');
  const $canvas = root.querySelector('#liveMapCanvas');

  let icon = 'compactador';
  try { const s = win.localStorage?.getItem(ICON_KEY); if (LIVE_ICONS.some((i) => i.id === s)) icon = s; } catch { /* sin almacenamiento */ }

  let fleet = null;
  let hasError = false;
  let selected = null;
  let lastOkMs = null;
  let stopped = false;
  let userMoved = false;
  let framed = false;
  let L = null; let map = null;
  const markers = new Map(); const lines = new Map();

  const now = () => Date.now();

  function renderHeader() {
    const ago = lastOkMs == null ? '' : agoText(Math.max(0, Math.round((now() - lastOkMs) / 1000)));
    $header.innerHTML = renderLiveHeader({ municipalityName: fleet?.municipality?.name ?? '', updatedAgoText: ago });
  }

  function renderPanel() {
    const t = now();
    const vehicles = (fleet?.vehicles ?? []).map((v) => ({ ...v, statusText: describeVehicleStatus(v, t) }));
    let body = '';
    if (hasError) body += renderLiveError({ hasData: vehicles.length > 0 });
    if (fleet && !vehicles.length) body += renderLiveEmpty();
    else if (vehicles.length) body += renderLiveVehicleList({ vehicles, selectedCode: selected });
    $panel.innerHTML = renderLiveIconPicker({ selected: icon }) + body;
  }

  function drawMap() {
    if (!L || !map || !fleet) return;
    const seen = new Set();
    for (const v of fleet.vehicles) {
      seen.add(v.code);
      const html = renderLiveMarker({ icon, status: v.status });
      const divIcon = L.divIcon({ html, className: 'live-marker-wrap', iconSize: [34, 34], iconAnchor: [17, 17] });
      let m = markers.get(v.code);
      if (!m) { m = L.marker([v.lat, v.lng], { icon: divIcon }).addTo(map); markers.set(v.code, m); m.on?.('click', () => select(v.code)); }
      else { m.setLatLng([v.lat, v.lng]); m.setIcon(divIcon); }
      if (v.path.length > 1) {
        const old = lines.get(v.code);
        if (old) old.setLatLngs(v.path);
        else lines.set(v.code, L.polyline(v.path, { color: '#6b7f78', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(map));
      }
    }
    for (const [code, m] of markers) if (!seen.has(code)) { m.remove(); markers.delete(code); lines.get(code)?.remove(); lines.delete(code); }
    frame();
  }

  // El encuadre sigue a los camiones, nunca a la ruta.
  function frame() {
    const vs = fleet.vehicles;
    if (!vs.length) return;
    if (!framed) {
      framed = true;
      if (vs.length === 1) map.setView([vs[0].lat, vs[0].lng], FOCUS_ZOOM);
      else map.fitBounds(L.latLngBounds(vs.map((v) => [v.lat, v.lng])), { padding: [40, 40], maxZoom: FOCUS_ZOOM });
      return;
    }
    const sel = vs.find((v) => v.code === selected);
    if (sel && !userMoved) map.panTo([sel.lat, sel.lng]);
  }

  function select(code) {
    selected = code; userMoved = false;
    const v = fleet?.vehicles.find((x) => x.code === code);
    if (v && map) map.setView([v.lat, v.lng], Math.max(map.getZoom?.() ?? 0, FOCUS_ZOOM));
    renderPanel();
  }

  const onClick = (e) => {
    const iconBtn = e.target?.closest?.('[data-live-icon]');
    if (iconBtn) {
      icon = iconBtn.getAttribute('data-live-icon');
      try { win.localStorage?.setItem(ICON_KEY, icon); } catch { /* sin almacenamiento */ }
      renderPanel(); drawMap();
      return;
    }
    const card = e.target?.closest?.('[data-live-vehicle]');
    if (card) select(card.getAttribute('data-live-vehicle'));
  };
  root.addEventListener('click', onClick);

  renderHeader(); renderPanel();
  const tick = win.setInterval(renderHeader, 1000);

  let leafletStarted = false;
  function ensureMap() {
    if (leafletStarted || !fleet?.vehicles.length) return;
    leafletStarted = true;
    Promise.resolve(loadLeaflet()).then((Lib) => {
      if (stopped) return;
      L = Lib;
      map = L.map($canvas, { zoomControl: true, attributionControl: true }).setView([fleet.vehicles[0].lat, fleet.vehicles[0].lng], FOCUS_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      map.on('dragstart', () => { userMoved = true; });
      drawMap();
    }).catch(() => { leafletStarted = false; });
  }

  const poller = pollLiveFleet({
    fetchFleet,
    timers: win,
    doc: win.document,
    onData: (payload) => {
      fleet = normalizeLiveFleet(payload, now());
      hasError = false; lastOkMs = now();
      if (!fleet.municipality) { root.innerHTML = `<div class="live-shell">${renderLiveNoMunicipality()}</div>`; return; }
      if (selected === null && fleet.vehicles.length === 1) selected = fleet.vehicles[0].code;
      renderHeader(); renderPanel(); ensureMap(); drawMap();
    },
    onError: () => { hasError = true; renderPanel(); }
  });

  return {
    stop() {
      stopped = true;
      poller.stop();
      win.clearInterval(tick);
      root.removeEventListener?.('click', onClick);
      try { map?.remove(); } catch { /* ya liberado */ }
    }
  };
}

async function loadLeafletFromCdn() {
  if (window.L) return window.L;
  await new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.append(css);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.onload = resolve; script.onerror = reject; document.head.append(script);
  });
  return window.L;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const root = document.getElementById('liveRoot');
  if (root) {
    const slug = new URLSearchParams(window.location.search).get('m') ?? '';
    const cfg = window.SMARTWASTE_SUPABASE_CONFIG;
    let clientPromise = null;
    const getClient = () => clientPromise ??= import('./vendor/supabase-js.mjs').then(({ createClient }) => createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }));
    mountLiveMap({
      root, win: window, slug,
      loadLeaflet: loadLeafletFromCdn,
      fetchFleet: async () => {
        if (!cfg?.url || !cfg?.anonKey) throw new Error('Sin configuración de Supabase');
        const { data, error } = await (await getClient()).rpc('public_live_fleet', { p_municipality_slug: slug });
        if (error) throw error;
        return data;
      }
    });
  }
}

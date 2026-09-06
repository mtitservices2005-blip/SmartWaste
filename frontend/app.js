import { demoNotice, simulationNotice, pilotMunicipality, trucks, routes, sectors, drivers, incidents, notifications, municipalities, routeFlow, routePaths, stateLabels } from '../shared/demo-data.js';
import { operationsAdapter, resolveOperationsAdapter } from '../shared/operations-adapter.js';
import { DeviceSimulator, createDemoPositionHistory, createTelemetryIngestionAdapter } from '../shared/telemetry-simulator.js';
import { validateEvidenceFile } from '../shared/channel-contracts.js';
import { createDemoFolio, findSectorService, findIncidentStatus, submitCitizenReport } from '../shared/citizen-portal.js';
import { generateRouteStopPoints, deriveStopStatus, haversineMeters, splitIntoTrips } from '../shared/route-engine.js';
import { fetchRoadRoute } from '../shared/osrm-routing.js';
import { fetchBuildingCount, estimateCollectionMinutes } from '../shared/overpass-buildings.js';
import { optimizeWaypointOrder } from '../shared/route-optimizer.js';
import { positionFromGeolocationEvent, shouldSendPosition } from '../shared/browser-geolocation.js';
import { suggestReoptimizedOrder } from '../shared/route-reoptimizer.js';
import { summarizeRouteRunsByRoute, summarizeRouteRunsByDriver } from '../shared/route-run-stats.js';
import { routeReadinessStage, ROUTE_READINESS_LABELS } from '../shared/route-readiness.js';
import { IMPACT_DEMO_NOTICE, IMPACT_SCENARIO_NOTICE, defaultImpactAssumptions, metricReadiness, calculateImpactMetrics } from '../shared/impact-center.js';
import { initAuthGate, readSupabaseConfig, getAuthClient } from './auth-gate.js';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
// SW-055: a recurring source of confusion this whole project — actions that DO work (completar
// ruta, asignar vehículo/chofer, iniciar recorrido) only ever showed their result as a silent
// re-render somewhere in the page, so it repeatedly looked like "nothing happened" even when it
// had. One small reusable toast instead of scattering ad-hoc status text everywhere: a fixed banner
// at the top of the viewport, auto-dismissed, reused by every mutating action below rather than
// each inventing its own feedback (or none at all). `type` picks the color (success/error); a
// second call while one is still showing replaces it rather than stacking multiple banners.
let toastTimer = null;
function showToast(message, { type = 'success' } = {}) {
  clearTimeout(toastTimer);
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    document.body.append(toast);
  }
  toast.className = `app-toast app-toast-${type} visible`;
  toast.textContent = message;
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}
// SW-044: a real municipality only starts genuinely demo-free the very first time it has zero
// real vehicles/drivers/routes (bootstrapRealBackend()'s "vacío real" branch, further down) — the
// moment any real record exists, later logins go back to showing the 5 bundled demo
// routes/trucks merged alongside real data (by design, rule 5 — never wipe real data). Confirmed
// with the Project Owner during SW-044 staging verification that the demo/real mix was making
// testing hard to follow. This is a deployment-level opt-in (SUPABASE_HIDE_DEMO, read from
// scripts/build-frontend-config.mjs's injected config — never the default, so a plain
// frontend/index.html or a deploy without this env var keeps showing the demo exactly as before,
// same as always), not a change to the demo itself — clears the bundled demo arrays before
// anything downstream (module-init seeding below, the initial render) ever reads them, so a
// deployment with this flag set stays demo-free permanently, regardless of how much real data
// accumulates.
if (readSupabaseConfig()?.hideDemo) { trucks.length = 0; routes.length = 0; drivers.length = 0; incidents.length = 0; }
const driverName = (id) => drivers.find((driver) => driver.id === id)?.name ?? 'Sin asignar';
const routeById = (id) => routes.find((route) => route.id === id);
const routeName = (id) => routeById(id)?.name ?? 'Sin ruta asignada';
// SW-044 fix: truck.routeId never got cleared once a route finished, so a vehicle stayed "busy"
// (excluded from every "vehículos disponibles" select) forever after its first route ever —
// blocking real fleet reuse, found while testing the new "Iniciar/Finalizar recorrido" flow with a
// real vehicle in staging. Keeps truck.routeId set for display purposes (routeName(), "Ver ruta
// completa", the map) instead of nulling it out — a truck only counts as available again once its
// current route actually reached a terminal state.
const isTruckAvailable = (truck) => !truck.routeId || ['completed', 'verified'].includes(routeById(truck.routeId)?.status);
const label = (state) => ROUTE_READINESS_LABELS[state] ?? stateLabels[state] ?? state;
const routePosition = (truck) => truck.position ?? routeGeometry(truck.routeId)[truck.positionIndex ?? 0] ?? pilotMunicipality.center;
// SW-044: only returns a value once both timestamps exist (see startRouteManually()/
// completeRouteManually()) — a route completed without ever being started, or a demo route that
// hasn't run through either yet, has no measured duration to show.
const routeMeasuredDurationMinutes = (route) => (route.started_at && route.completed_at)
  ? Math.max(0, Math.round((Date.parse(route.completed_at) - Date.parse(route.started_at)) / 60000))
  : null;
// SW-045: real GPS-derived distance for a completed run (route.real_distance_meters, stamped by
// transitionRouteRun() in shared/operations-adapter.js) — falls back to null (never a fake value)
// when there was no GPS trail to measure, same "medido vs. estimado" bias as duration above.
const routeMeasuredDistanceKm = (route) => route.real_distance_meters != null ? Math.round(route.real_distance_meters / 100) / 10 : null;
// Reuses the same fuel-efficiency assumption already configurable in Impacto y Ahorros ·
// Economía (shared/impact-center.js's defaultImpactAssumptions) rather than inventing a second,
// disconnected one — consumption itself is always an estimate (no fuel is actually measured
// anywhere in this system), whether the distance it's based on is real or estimated.
const estimateFuelLiters = (distanceKm, efficiencyKmPerLiter = defaultImpactAssumptions.fuelEfficiency) =>
  efficiencyKmPerLiter > 0 ? Math.round((distanceKm / efficiencyKmPerLiter) * 10) / 10 : null;
const formatMinutes = (minutes) => {
  if (minutes === null || minutes === undefined) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}min` : `${rest} min`;
};
let selectedTruckId = null;
let selectedRouteId = null;
// SW-049: browser-local operator preference, read once at module init — never blocks rendering if
// localStorage is unavailable (private browsing, sandboxed iframe), same "never break on a missing
// nice-to-have" bias as the rest of this file.
function readGuidedAssignmentPreference() {
  try { return localStorage.getItem('smartwaste.guidedAssignment') === 'true'; } catch { return false; }
}
function setGuidedAssignmentPreference(enabled) {
  guidedAssignmentEnabled = enabled;
  try { localStorage.setItem('smartwaste.guidedAssignment', enabled ? 'true' : 'false'); } catch { /* private browsing etc. — preference just won't survive reload */ }
}
let guidedAssignmentEnabled = readGuidedAssignmentPreference();
// Roadmap item 4 ("reoptimización dinámica" — suggestion only, docs/TECHNICAL_DEBT_REGISTER.md
// #21): holds the last computed reoptimization suggestion for one route at a time. Cleared when a
// different route is selected (see selectRoute()) so a stale suggestion never bleeds into another
// route's detail panel. Never written back to route_stops/route_paths — display only.
let routeReoptimizationPreview = null;
let selectedIncidentId = null;
// SW-034: `operationsAdapter` (imported above) stays bound to the in-memory demo instance for
// every existing synchronous read (routeGeometry(), drawMapLayers(), drawDriverPositions(), the
// seeding blocks below) — none of that changes. `realAdapter` is only set once Supabase is
// configured AND the signed-in session resolves a municipality_id (see bootstrapRealBackend() near
// the bottom of this file); mutation handlers (createVehicleFromForm/createDriverFromForm/
// finishCreateRoute) mirror their write to it, best-effort, after already doing their existing
// demo-adapter write. This keeps the entire rendering/simulation architecture untouched (rule 5 —
// never break the approved demo) while still persisting real writes when configured.
//
// Deliberately NOT in scope here: hydrating pre-existing real vehicles/drivers/routes into the
// running page. trucksWithRoute/simState/driverSimulators/initialTruckState/initialRouteProgress
// are all derived from trucks/routes exactly once at module load (below); overwriting
// trucks/routes/drivers with fetched data afterward would leave all of those stale and pointing at
// the wrong (demo) objects, which risks the simulation engine itself, not just what's displayed.
// Doing this properly means re-deriving that whole cascade on demand, which is a separate,
// larger refactor — tracked as a follow-up (SW-035), not force-fit into this change.
let realAdapter = null;
let backendMode = 'DEMO_ONLY';
// SW-058: real citizen reports (shared/citizen-portal.js's submitCitizenReport() writes them to
// Supabase already) that Supervisor can act on — see hydrateCitizenReports()/renderSupervisor()
// below. Unrelated to the demo `incidents` array (a separate, always-demo concept).
let realCitizenReports = [];
// Roadmap item 3 ("GPS real"): the signed-in session's context (user_id/municipality_id, from
// initAuthGate()/bootstrapRealBackend() below), kept around so the driver GPS button can resolve
// "my own real vehicle" on demand. driverGpsWatchId is the navigator.geolocation.watchPosition()
// handle while GPS sharing is active, null otherwise.
let driverAuthContext = null;
let driverGpsWatchId = null;
// Onboarding en vacío (pedido del Project Owner): un municipio real recién conectado a Supabase, sin
// ningún vehículo/chofer/ruta real todavía, no debería ver los 5 datos demo como si fueran
// operación real — bootstrapRealBackend() (más abajo) detecta ese caso, vacía los arrays demo, y
// muestra este wizard de 2 pasos (vehículo, chofer) antes de entregar el control al flujo normal de
// "Crear ruta" ya existente para el tercer paso (la primera ruta real).
let needsOnboarding = false;
let onboardingVehicle = null;
let onboardingDriver = null;
// SW-036: the dispatcher-facing map's real-GPS overlay. realPositions is keyed by truck.real_id
// (vehicle_positions.vehicle_id is the Supabase-generated uuid, same key already used everywhere
// else a truck's real row needs matching — see hydrateVehiclesAndDrivers()/assignTruckToRoute()).
// opsGpsPollTimer follows the exact startDriverPolling()/stopDriverPolling() pair below.
let realPositions = {};
let opsGpsPollTimer = null;
let map;
let mapReady = false;
let routeLayers = [];
let truckMarkers = [];
let incidentMarkers = [];
// SW-043: which route's bounds the map last fitBounds()-ed to — lets drawMapLayers() tell "just
// focused this route, fit its full bounds" apart from "still focused on it, just follow the truck".
let mapFocusRouteId = null;
let simulationTimer = null;
let simulationSpeed = 1;
// Seeded per page load (not a fixed 1) so two concurrent demo sessions don't both hand out
// SW-FOLIO-3001 first — this has no backing store, so a random per-session start is the only way
// to keep the same low collision odds the previous Math.random()-per-submission version had
// (Codex review on PR #23).
let citizenFolioSequence = Math.floor(Math.random() * 5000) + 1;
const initialTruckState = Object.fromEntries(trucks.map((truck) => [truck.id, { index: truck.positionIndex ?? 0, progress: truck.progress, updatedAt: truck.updatedAt, sector: truck.sector }]));
// route.progress (not truck.progress) drives renderRouteDetail()'s % and drawMapLayers()'s solid/
// dashed split point — captured here so resetSimulation() can restore it once the tick loop below
// starts advancing it alongside its assigned truck.
const initialRouteProgress = Object.fromEntries(routes.map((route) => [route.id, route.progress]));
const simState = Object.fromEntries(trucks.map((truck) => [truck.id, { index: truck.positionIndex ?? 0, progress: truck.progress }]));

// Driver mobile view (vista móvil conductor): DeviceSimulator feeds a demo, in-memory stand-in for
// vehicle_positions (createDemoPositionHistory, shared/telemetry-simulator.js) — same shape/columns
// a real Supabase-backed history would have, just not persisted. Generation runs independently of
// whether the view is visible (mirrors trucks always reporting telemetry); the view itself only
// polls (Realtime is unresolved — docs/TECHNICAL_DEBT_REGISTER.md item #14) and only while visible.
const trucksWithRoute = trucks.filter((truck) => truck.routeId);
const positionHistory = createDemoPositionHistory();
const driverSimulators = Object.fromEntries(trucksWithRoute.map((truck) => {
  // getPath is called lazily (only once emit()/start() actually runs, well after the route_paths
  // seeding block below completes) — see shared/telemetry-simulator.js's DeviceSimulator for why
  // this replaces the old routePaths[routeId] runtime-mutation coupling (item 16).
  const simulator = new DeviceSimulator(truck.id, { getPath: () => routeGeometry(truck.routeId) });
  simulator.index = truck.positionIndex ?? 0; // start the trail aligned with the truck's current demo progress
  return [truck.id, simulator];
}));
// SW-044: trucks[0] used to be safe to assume (the 5 bundled demo trucks always existed at module
// init) — with SUPABASE_HIDE_DEMO=true (or a real municipality genuinely starting empty), trucks
// can now be [] at this exact point, and trucks[0].id threw synchronously, killing the whole
// module's evaluation before anything downstream (the click listeners, the initial render) ever
// ran — same failure shape as the earlier esm.sh/missing-shared/ bugs (SW-040): no login, no
// buttons, nothing but the static topbar, no visible error.
let driverVehicleId = trucksWithRoute[0]?.id ?? trucks[0]?.id ?? null;
let driverMap;
let driverMapReady = false;
let driverPlannedLayer = null;
let driverTrailLayer = null;
let driverCurrentMarker = null;
let driverPollTimer = null;
let driverStopsLayer = null;
const DRIVER_POLL_INTERVAL_MS = 7000; // dentro del rango pedido de 5-10s
// SW-036: mismo orden de magnitud que DRIVER_POLL_INTERVAL_MS — Realtime queda descartado por no
// determinístico (ver docs/TECHNICAL_DEBT_REGISTER.md #14), así que el mapa del despachador también
// resuelve GPS real vía polling. REAL_GPS_FRESHNESS_MS es la ventana de frescura contra
// vehicle_positions.captured_at: sin esto, una posición real vieja (chofer cerró el navegador,
// perdió señal, nunca tocó "Detener GPS real") se mostraría como vigente para siempre — no hay
// ningún campo de estado "sigo compartiendo" persistido, por diseño (ver
// docs/NEXT_MILESTONE_RECOMMENDATION_SW036.md).
const OPS_GPS_POLL_INTERVAL_MS = 8000;
const REAL_GPS_FRESHNESS_MS = 30000;

// SW-027: "Crear ruta" — free-click drawing on its own Leaflet map (no street snapping/routing, no
// new mapping library). drawnRoutePoints is [[lat,lng], ...] in click order, same shape routePaths
// entries already have, so it can go straight into generateRouteStopPoints()/routePaths[id] once
// finished.
let drawnRoutePoints = [];
let createRouteMap;
let createRouteMapReady = false;
let createRoutePolyline = null;
let createRouteMarkers = [];

// SW-026: generate + persist synthetic collection points (shared/route-engine.js) for every demo
// route with a routePath geometry, through the same in-memory operationsAdapter other writes here
// already go through. Guarded so re-running this module doesn't duplicate points against the same
// route_id. count:route.stops keeps the generated total consistent with the same number demo-
// data.js/the route list already display elsewhere (Codex review on PR #26 — a fixed meter spacing
// produced a different total per route). SW-027's "Crear ruta" UI (renderCreateRoute()/
// finishCreateRoute() below) calls the exact same generateRouteStopPoints()/saveRouteStops() for
// routes drawn at runtime, not a separate implementation.
routes.filter((route) => routePaths[route.id]).forEach((route) => {
  if (operationsAdapter.listRouteStops(route.id).length > 0) return;
  operationsAdapter.saveRouteStops(route.id, generateRouteStopPoints(route.id, { count: route.stops }));
});

// SW-033: route geometry used to only live in the in-memory routePaths dictionary (shared/
// demo-data.js), read directly by every consumer below and mutated at runtime by
// finishCreateRoute() for hand-drawn routes (docs/TECHNICAL_DEBT_REGISTER.md item 16) — that only
// works because everything runs in the same in-memory demo adapter; a real Supabase session
// wouldn't see a mutation to a plain JS dictionary from another session at all. Seeding it into the
// adapter here (same pattern as the route_stops seeding right above) means every consumer can read
// through operationsAdapter.listPathPoints() instead, same as route_stops already does.
routes.filter((route) => routePaths[route.id]).forEach((route) => {
  if (operationsAdapter.listPathPoints(route.id).length > 0) return;
  operationsAdapter.savePathPoints(route.id, routePaths[route.id].map(([latitude, longitude], index) => ({ sequence: index + 1, latitude, longitude })));
});
// [lat,lng] pairs sorted by sequence — the shape every consumer below expects, mirroring what
// routePaths[id] used to provide directly.
function routeGeometry(routeId) { return operationsAdapter.listPathPoints(routeId).map((point) => [point.latitude, point.longitude]); }

// SW-026 fix (Codex review on PR #26): a truck that starts partway through its route — or is
// already 'completed', like the demo's truck-04 — otherwise has no recorded history for the
// waypoints it already passed before this page loaded, so every stop before truck.positionIndex
// would show pendiente forever. Backfill the path prefix as historical trail, timestamped strictly
// before the "live" telemetry below, so deriveStopStatus() sees it as already-covered ground.
trucksWithRoute.forEach((truck) => {
  const path = routeGeometry(truck.routeId);
  const upToIndex = Math.min(truck.positionIndex ?? 0, path.length - 1);
  const backfillStart = Date.now() - (upToIndex + 1) * 1000;
  for (let i = 0; i <= upToIndex; i += 1) {
    const [latitude, longitude] = path[i];
    positionHistory.record({ vehicle_id: truck.id, latitude, longitude, captured_at: new Date(backfillStart + i * 1000).toISOString() });
  }
});

Object.values(driverSimulators).forEach((simulator) => positionHistory.record(simulator.start()));
function tickDriverTelemetry() {
  Object.entries(driverSimulators).forEach(([truckId, simulator]) => {
    const truck = trucks.find((item) => item.id === truckId);
    // Only 'active'/'delayed' trucks are actually moving — 'stopped' has speedKmh 0 by definition
    // (shared/demo-data.js), and 'offline'/'completed' aren't reporting either; advancing the
    // simulator for any of those would move a marker that's supposed to be stationary.
    if (!truck || (truck.state !== 'active' && truck.state !== 'delayed')) return;
    const path = routeGeometry(truck.routeId);
    // emit() reads path[index % path.length] then increments index, so index === path.length is the
    // first tick that would wrap back to the route's first point. Stop there — this still records
    // the true final point (index === path.length - 1) before capping, instead of stopping one
    // point short of the route's actual end.
    if (simulator.index >= path.length) return;
    positionHistory.record(simulator.emit());
  });
}
setInterval(tickDriverTelemetry, 4000);

// SW-058 (Codex review, PR #75, P1): citizen_reports.type/description are filled by anonymous
// citizens (submitCitizenReport(), shared/citizen-portal.js) with no RLS constraint on their
// content beyond a length check on description — interpolating them into innerHTML unescaped lets
// a report body carrying e.g. <img src=x onerror=...> execute in a supervisor's browser.
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function progress(value) { return `<div class="progress" aria-label="${value}% completado"><i style="width:${value}%"></i></div>`; }
function pill(state) { return `<span class="pill ${state}">${label(state)}</span>`; }
function routeStatus(route) { return route.status === 'completed' || route.status === 'verified' ? 'completed' : route.status; }
// Pedido del Project Owner: el marcador del mapa se veía como un círculo genérico (el estado
// 'completed' incluso lo fuerza a serlo vía CSS, .truck-icon.completed{border-radius:999px}), no
// reconocible como un vehículo. Reemplaza el símbolo unicode por una silueta de camión inline
// (sin depender de ningún CDN/ícono externo — misma lección de esm.sh de SW-040) mientras
// conserva el color/forma del contenedor por estado que ya codifica el estado del vehículo, así
// que sigue siendo igual de rápido de distinguir "detenido" vs "activo" de un vistazo.
const TRUCK_SILHOUETTE_SVG = `<svg viewBox="0 0 32 20" width="24" height="15" fill="none" aria-hidden="true"><rect x="1" y="3" width="18" height="11" rx="1.5" fill="currentColor"/><path d="M19 7h6l4 5v2H19V7z" fill="currentColor"/><rect x="21" y="8.5" width="4" height="3.2" fill="#fff" opacity=".85"/><circle cx="8" cy="16" r="2.6" fill="#1f2937"/><circle cx="24" cy="16" r="2.6" fill="#1f2937"/></svg>`;
function truckIcon(truck, isRealGps = false) {
  // SW-036: distinción visual obligatoria entre posición real y simulada (regla 6/7 de CLAUDE.md) —
  // sin esto, un camión con GPS real activo se ve idéntico a uno puramente simulado.
  const badge = isRealGps ? '<i class="gps-real-badge" title="Posición GPS real">●</i>' : '';
  return `<span class="truck-icon ${truck.state}" title="${label(truck.state)}">${badge}${TRUCK_SILHOUETTE_SVG}<small>${truck.unit.replace('SW-LS-', '')}</small></span>`;
}
// Fase 2 UX (auditoría SW-020): la app no tenía pantalla de aterrizaje — se llegaba directo a
// "Mapa" sin ningún resumen de qué necesita atención. Esta sección agrega esa vista, reutilizando
// los mismos filtros que ya usan renderMap()/renderSupervisor() (no se inventa ningún estado
// nuevo), y cada tarjeta es un link real a la sección correspondiente en vez de solo mostrar el
// número — mismo patrón del link "Municipal · Flota y personal" de la Fase 1.
function renderSummary() {
  const activeRoutes = routes.filter((route) => route.status === 'in_progress' || route.status === 'delayed');
  const delayedRoutes = routes.filter((route) => route.status === 'delayed');
  const pendingVerification = routes.filter((route) => route.status === 'completed');
  const openIncidents = incidents.filter((incident) => incident.status !== 'Cerrada');
  const outOfServiceTrucks = trucks.filter((truck) => truck.state === 'maintenance' || truck.state === 'offline');
  const summaryCards = [
    { label: 'Rutas activas', value: activeRoutes.length, href: '#operaciones/mapa' },
    { label: 'Rutas retrasadas', value: delayedRoutes.length, href: '#operaciones/mapa', tone: delayedRoutes.length ? 'alert' : '' },
    { label: 'Incidencias abiertas', value: openIncidents.length, href: '#supervisor', tone: openIncidents.length ? 'alert' : '' },
    { label: 'Rutas por verificar', value: pendingVerification.length, href: '#supervisor', tone: pendingVerification.length ? 'attention' : '' },
    { label: 'Vehículos fuera de servicio', value: outOfServiceTrucks.length, href: '#operaciones/flota', scrollTo: 'fleetManagement', tone: outOfServiceTrucks.length ? 'attention' : '' }
  ];
  const attentionItems = [
    ...delayedRoutes.map((route) => `<button class="row selectable" data-route="${route.id}"><span>🚨 Ruta retrasada: ${route.name}<br>${route.sectors.join(' · ')}</span>${pill('delayed')}</button>`),
    ...openIncidents.map((incident) => `<button class="row selectable" data-incident="${incident.code}"><span>⚠️ ${incident.type}<br>${incident.sector} · ${incident.priority}</span>${pill('open')}</button>`)
  ];
  return `<section id="resumen" class="section card">
    <p class="eyebrow">${pilotMunicipality.branding.label}</p>
    <h1>Resumen del día</h1>
    <p class="demo">${demoNotice} · Municipio piloto: ${pilotMunicipality.name}, ${pilotMunicipality.country}</p>
    <div class="kpis summary-grid">${summaryCards.map((card) => `<a class="kpi${card.tone ? ` ${card.tone}` : ''}" href="${card.href}"${card.scrollTo ? ` data-scroll-to="${card.scrollTo}"` : ''}><strong>${card.value}</strong><br>${card.label}</a>`).join('')}</div>
    ${attentionItems.length
      ? `<div><h3>Necesita tu atención</h3><div class="list">${attentionItems.join('')}</div></div>`
      : '<p class="demo">Sin rutas retrasadas ni incidencias abiertas — todo en orden.</p>'}
  </section>`;
}

// SW-043: was a truck selector with no wiring at all — selecting one did nothing (dead UI, "no hace
// nada"). Repurposed as a route selector: choosing one calls selectRoute() (frontend/app.js's
// click-a-route-row/click-a-route-polyline path), focusing the map on just that route's trajectory
// and truck — same effect, without needing to touch the map or leave "Operaciones · Mapa" to pick a
// route from the "Rutas" list first. Does not "start" anything: a real route's movement is driven
// entirely by the driver's own GPS, and a demo route's "Iniciar" button already runs the shared
// simulation for every demo truck at once (not scoped per-route) — this control only changes what's
// in view, matching frontend/auth-gate.js and the rest of this file's "never invent state that
// isn't backed by something real" bias.
function routeFocusSelect() {
  if (!routes.length) return '<select id="simVehicle" disabled><option>Sin rutas</option></select>';
  return `<select id="simVehicle"><option value="">Seleccionar ruta a monitorear…</option>${routes.map((route) => `<option value="${route.id}"${route.id === selectedRouteId ? ' selected' : ''}>${route.name}</option>`).join('')}</select>`;
}

// SW-054: only shown when a route is actually selected on the map AND ready to start (same
// truckId/status guard as renderRouteDetail()'s startAction) — reuses the existing
// [data-start-route] handler, no new wiring. Kept in its own function/container (#mapStartAction)
// so markSelection() can refresh it on every route selection change without re-rendering the whole
// map panel (which would tear down and rebuild the Leaflet map).
function mapStartAction() {
  const route = selectedRouteId ? routeById(selectedRouteId) : null;
  if (!route || !route.truckId || route.truckId === 'Sin asignar' || route.status !== 'assigned') return '';
  return `<button type="button" class="btn-primary" data-start-route="${route.id}">Iniciar ruta</button>`;
}
// SW-054: the Project Owner reported this panel felt "saturado" — 8 KPI tiles (operationalKpis(),
// removed) stacked above the map itself, duplicating numbers already on Resumen (renderSummary()),
// before ever reaching the map. Trimmed to just: route selector + start action + the map. Anything
// needing the broader operational KPIs is a click away on Resumen.
function renderMapPanel() {
  return `<div class="map-card">
      <div class="map-header">
        <div><p class="eyebrow">${pilotMunicipality.branding.label}</p><h1>Mapa operativo real de ${pilotMunicipality.name}</h1><p class="demo">${demoNotice} · Las rutas son simuladas, no oficiales del ayuntamiento.</p><p class="demo gps-legend">● = posición GPS real · el resto son camiones simulados</p></div>
        <div class="sim-controls" aria-label="Controles de simulación"><span>${simulationNotice} · fuente desacoplada: ${backendMode}</span>${routeFocusSelect()}<span id="mapStartAction">${mapStartAction()}</span><button class="btn-primary" data-sim="start">Iniciar</button><button data-sim="pause">Pausar</button><button data-sim="reset">Reiniciar</button><button class="btn-ghost" data-sim="speed">${simulationSpeed}×</button><button class="btn-ghost" data-sim="fullscreen">Pantalla completa</button></div>
      </div>
      <div id="realMap" class="real-map" role="application" aria-label="Mapa OpenStreetMap de Laguna Salada"><div class="map-fallback"><strong>Mapa externo no disponible.</strong><span>Fallback operativo demo: use listas, paneles y coordenadas simuladas.</span></div></div>
    </div>
    <aside class="detail-drawer is-hidden" id="detail" aria-hidden="true"></aside>`;
}

// SW-042 (docs/TECHNICAL_DEBT_REGISTER.md #24): there was no UI to assign a driver to a vehicle at
// all — a real vehicle's driver could only be linked by writing vehicle_assignments directly
// against Supabase (what scripts/seed-local.mjs/seed-remote.mjs do). Only offers drivers of the
// same kind as the truck (real drivers for a real/hydrated truck, demo drivers for a demo one) —
// a demo driver has no backing Supabase profile/auth account to assign to a real vehicle_id.
function driverAssignmentControl(truck) {
  const candidateDrivers = drivers.filter((driver) => Boolean(driver.real_id) === Boolean(truck.real_id) && driver.id !== truck.driverId);
  if (!candidateDrivers.length) return '<p class="demo">No hay choferes disponibles para asignar.</p>';
  return `<div class="controls"><select id="assignDriverSelect">${candidateDrivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join('')}</select><button type="button" class="btn-primary" data-assign-driver="${truck.id}">${truck.driverId ? 'Reasignar chofer' : 'Asignar chofer'}</button></div>`;
}

function renderTruckDetail(truck) {
  const route = routeById(truck.routeId);
  const relatedIncidents = route ? incidents.filter((incident) => route.incidents.includes(incident.code)) : [];
  return `<div class="drawer-head"><p class="eyebrow">Detalle del camión</p><h2>${truck.unit} · ${truck.name}</h2>${pill(truck.state)}</div>
    <div class="detail-grid"><p><b>Conductor</b><span>${driverName(truck.driverId)}</span></p><p><b>Matrícula demo</b><span>${truck.plate}</span></p><p><b>Ruta</b><span>${routeName(truck.routeId)}</span></p><p><b>Velocidad demo</b><span>${truck.speedKmh} km/h</span></p><p><b>Última actualización</b><span>${truck.updatedAt}</span></p><p><b>Sector actual</b><span>${truck.sector}</span></p><p><b>Próxima parada</b><span>${truck.nextStop}</span></p><p><b>Nivel de carga demo</b><span>${truck.loadLevel}%</span></p></div>
    ${driverAssignmentControl(truck)}
    ${progress(truck.progress)}<p><strong>${truck.progress}%</strong> completado · ${demoNotice}</p>
    <h3>Incidencias</h3>${relatedIncidents.length ? relatedIncidents.map((incident) => `<button class="incident-row" data-incident="${incident.code}">${incident.type} · ${incident.priority}</button>`).join('') : '<p>Sin incidencias demo asociadas.</p>'}
    <div class="actions"><button data-route="${truck.routeId ?? ''}">Ver ruta completa</button><button data-history="${truck.id}">Ver historial demo</button></div>`;
}

function renderRouteDetail(route) {
  const relatedIncidents = incidents.filter((incident) => route.incidents.includes(incident.code));
  // Closing the crear->asignar->seguimiento->cerrar loop needed two actions that had no UI
  // anywhere: assigning a vehicle AFTER a route was created without one (only possible at creation
  // time before this, via "Crear ruta"'s own select), and marking a route completed (the simulation
  // tick caps progress at 99 — see startSimulation() — so nothing ever pushed a route into
  // Supervisor's "pendientes de verificación" queue without this).
  const availableTrucks = trucks.filter(isTruckAvailable);
  const assignAction = (!route.truckId || route.truckId === 'Sin asignar')
    ? (availableTrucks.length
      ? `<div class="controls"><select id="assignVehicleSelect">${availableTrucks.map((truck) => `<option value="${truck.id}">${truck.unit}</option>`).join('')}</select><button type="button" class="btn-primary" data-assign-vehicle="${route.id}">Asignar vehículo</button></div>`
      : '<p class="demo">No hay vehículos disponibles para asignar — <a href="#operaciones/flota" data-scroll-to="fleetManagement">registra uno en Operaciones · Flota</a>.</p>')
    : '';
  // SW-048: route.truckId is the assigned truck's *unit label* (a display string, set by
  // assignTruckToRoute()), not its id — the actual truck object (needed for driverId and for a
  // link to its own detail panel) is only reachable via the reverse foreign key truck.routeId,
  // same lookup previewRouteReoptimization() already uses.
  const assignedTruck = trucks.find((truck) => truck.routeId === route.id);
  // A driver is assigned to the TRUCK (assignDriverToTruck()), never to the route directly — before
  // this, this panel showed driverName(route.driverId), a field nothing ever set for a real/created
  // route (only the 5 bundled demo routes happen to have it pre-seeded), so a real route's
  // "Conductor" field silently stayed "Sin asignar" forever even after a driver was assigned.
  // Embedding driverAssignmentControl() (already used in Flota's truck detail) directly here closes
  // the UX gap that made assigning a driver a separate trip to another tab — reuses the exact same
  // function/handler (data-assign-driver, #assignDriverSelect), no new wiring needed.
  const driverAssignAction = (assignedTruck && !assignedTruck.driverId) ? driverAssignmentControl(assignedTruck) : '';
  const readinessStage = routeReadinessStage(route, assignedTruck);
  // SW-049 (opción E, confirmada con el Project Owner tras la reingeniería SW-048): un operador que
  // activó el flujo guiado en Configuración ve un solo formulario + un solo botón que encadena
  // asignar vehículo, asignar chofer e iniciar — en vez de los controles paso a paso de arriba.
  // Apagado por defecto (guidedAssignmentEnabled parte en false): sin tocar Configuración, esta
  // rama nunca se activa y el comportamiento es idéntico a SW-048.
  const guidedAction = (guidedAssignmentEnabled && readinessStage && readinessStage !== 'ready')
    ? renderGuidedPutInMotion(route, assignedTruck, readinessStage)
    : '';
  // SW-044: only offered once a vehicle is assigned (ROUTE_TRANSITIONS in shared/contracts.js only
  // allows assigned->started, never planned->started) and only before it's already started —
  // reachable here for admin/dispatcher, and from the driver's own Conductor view
  // (startAssignedRoute()) for the same route.
  const startAction = (route.truckId && route.truckId !== 'Sin asignar' && route.status === 'assigned')
    ? `<div class="controls"><button type="button" class="btn-primary" data-start-route="${route.id}">Iniciar ruta</button></div>`
    : '';
  const completeAction = (route.truckId && route.truckId !== 'Sin asignar' && route.status !== 'completed' && route.status !== 'verified')
    ? `<div class="controls"><button type="button" class="btn-primary" data-complete-route="${route.id}">Marcar como completada</button></div>`
    : '';
  // Roadmap item 4 ("reoptimización dinámica" — suggestion only): only offered for a route that's
  // actually underway with a truck assigned — reoptimizing a planned/completed/verified route's
  // stop order makes no sense (nothing is "in progress" to reroute around).
  const reoptimizeAction = ((route.status === 'in_progress' || route.status === 'delayed') && route.truckId && route.truckId !== 'Sin asignar')
    ? `<div class="controls"><button type="button" data-reoptimize-route="${route.id}">Reoptimizar ruta</button></div>`
    : '';
  const reoptimizationPreview = (routeReoptimizationPreview?.routeId === route.id)
    ? `<h3>Sugerencia de reoptimización</h3>
       ${routeReoptimizationPreview.order.length
         ? `<p>Ahorro estimado: ${Math.round(routeReoptimizationPreview.savedMeters)} m (${routeReoptimizationPreview.currentDistanceMeters > 0 ? Math.round(100 * routeReoptimizationPreview.savedMeters / routeReoptimizationPreview.currentDistanceMeters) : 0}%)</p>
           <ol>${routeReoptimizationPreview.order.map((stop) => `<li>${stop.label}</li>`).join('')}</ol>
           <p class="demo">Sugerencia de vista previa — no aplicada. Este orden no se guarda en la ruta.</p>`
         : '<p class="demo">No hay suficientes paradas pendientes para reoptimizar.</p>'}`
    : '';
  // Roadmap item 5 ("estimación de viviendas"): only rendered when the field exists — the 5
  // pre-built demo routes (shared/demo-data.js) don't have it, and a route created while the
  // Overpass estimate failed leaves it undefined too (rule 5, never break rendering).
  const householdEstimateRow = route.estimatedHouseholds !== undefined
    ? `<p><b>Viviendas estimadas (OSM)</b><span>${route.estimatedHouseholds} · ${route.estimatedMinutesRange ? `${route.estimatedMinutesRange.min}-${route.estimatedMinutesRange.max} min` : 'No disponible'}</span></p>`
    : '';
  // SW-044: prefers a real measured duration (started_at/completed_at, both set only once
  // startRouteManually()/completeRouteManually() actually ran) over the existing formula estimate
  // (shared/impact-center.js's "Uso" tab) — falls back to "estimado" when either timestamp is
  // missing, same "never invent a real-looking number" bias as the GPS-real vs. simulated badge on
  // the map (SW-036).
  const measuredMinutes = routeMeasuredDurationMinutes(route);
  const durationRow = measuredMinutes !== null
    ? `<p><b>Duración</b><span>${formatMinutes(measuredMinutes)} · medido</span></p>`
    : `<p><b>Duración</b><span>${route.estimatedMinutes === '—' ? '—' : `${route.estimatedMinutes} min`} · estimado</span></p>`;
  // SW-045: same medido/estimado split as duración, plus a consumo estimado derived from whichever
  // distance is showing (real when measured, the drawn trace's length otherwise) — consumo itself
  // is never "medido" (nothing tracks actual fuel loaded), so it's always labeled as an estimate.
  const measuredDistanceKm = routeMeasuredDistanceKm(route);
  const displayDistanceKm = measuredDistanceKm ?? route.distanceKm ?? null;
  const distanceRow = measuredDistanceKm !== null
    ? `<p><b>Distancia</b><span>${measuredDistanceKm} km · medido</span></p>`
    : `<p><b>Distancia</b><span>${route.distanceKm != null ? `${route.distanceKm} km` : '—'} · estimado</span></p>`;
  const estimatedFuelLiters = displayDistanceKm != null ? estimateFuelLiters(displayDistanceKm) : null;
  const fuelRow = `<p><b>Consumo estimado</b><span>${estimatedFuelLiters != null ? `${estimatedFuelLiters} L` : '—'}</span></p>`;
  // Only real/hydrated routes can have more than one corrida to compare (a demo route is always
  // "the same object", never a history of separate route_runs) — refreshRouteDurationHistory()
  // (called from selectRoute()) fills this in asynchronously since it's a network read.
  const durationHistoryPlaceholder = route.real_id ? `<p id="routeDurationHistory" class="demo">Cargando histórico de corridas…</p>` : '';
  return `<div class="drawer-head"><p class="eyebrow">Detalle de ruta</p><h2>${route.name}</h2>${pill(readinessStage ?? routeStatus(route))}</div>
    <div class="detail-grid"><p><b>Unidad asignada</b><span>${assignedTruck ? `<button type="button" class="row-link" data-truck="${assignedTruck.id}">${route.truckId}</button>` : route.truckId}</span></p><p><b>Conductor</b><span>${driverName(assignedTruck?.driverId)}</span></p><p><b>Paradas</b><span>${route.covered} completadas · ${route.pending} pendientes</span></p>${durationRow}${distanceRow}${fuelRow}</div>
    ${durationHistoryPlaceholder}
    ${guidedAction || `${assignAction}${driverAssignAction}`}${startAction}${completeAction}${reoptimizeAction}
    <details class="detail-more"><summary>Ver detalles técnicos</summary>
      <div class="detail-grid"><p><b>Sectores</b><span>${route.sectors.join(', ')}</span></p><p><b>Inicio</b><span>${route.started}</span></p><p><b>Programada</b><span>${route.scheduled}</span></p><p><b>Tiempo estimado</b><span>${route.estimatedMinutes} min</span></p><p><b>Distancia demo</b><span>${route.distanceKm} km</span></p>${householdEstimateRow}</div>
    </details>
    ${progress(route.progress)}<p><strong>${route.progress}%</strong> completado</p><h3>Incidencias</h3>${relatedIncidents.map((incident) => `<button class="incident-row" data-incident="${incident.code}">${incident.type} · ${incident.status}</button>`).join('') || '<p>Sin incidencias demo.</p>'}
    <h3>Timeline operativo</h3><div class="timeline">${routeFlow.map((step) => `<p>${step === route.status ? '●' : '○'} ${label(step)}</p>`).join('')}</div>
    ${reoptimizationPreview}`;
}
function renderIncidentDetail(incident) { return `<div class="drawer-head"><p class="eyebrow">Incidencia operativa demo</p><h2>${incident.type}</h2>${pill('open')}</div><p><b>Folio:</b> ${incident.id}</p><p><b>Sector:</b> ${incident.sector}</p><p><b>Prioridad:</b> ${incident.priority}</p><p><b>Estado:</b> ${incident.status}</p><p>${incident.detail}</p><p class="demo">${demoNotice}</p>`; }

// SW-054: "+ Nueva ruta" used to be the last thing in this panel, collapsed below the entire route
// list — the Project Owner reported it was "muy difícil de encontrar". Moved above the list, same
// collapsible <details> (no behavior change, just position), and the search bar got its own
// `.search-bar` class instead of the generic `.controls` (used everywhere from creation forms to
// route-detail actions) so it can have its own alignment without affecting every other `.controls`
// block in the app.
function renderRutasPanel() {
  return `<h2>Rutas</h2><p class="demo">${demoNotice} · Municipio piloto configurable: ${pilotMunicipality.name}, ${pilotMunicipality.country}</p>
    <details class="create-route-toggle" id="createRouteToggle"><summary>+ Nueva ruta</summary>${renderCreateRoute()}</details>
    <div class="search-bar"><input id="search" placeholder="Buscar ruta, camión o sector"><select id="sectorFilter"><option value="">Todos los sectores</option>${sectors.map((s) => `<option>${s.name}</option>`).join('')}</select></div>
    <h3>Rutas del día</h3><div class="list compact" id="routeList">${renderRoutes(routes)}</div>`;
}
// SW-054: renamed "Flota" -> "Flotilla" (display label only, OPS_VIEW_LABELS above — the
// #operaciones/flota hash/ids are untouched so existing links keep working). Reordered so both
// vehicles and drivers now follow the same top-to-bottom pattern — creation forms first, lists
// after — instead of the old inconsistency (vehicle list rendered before any form; driver list
// rendered after its own form but vehicle form had none below it).
function renderFlotaPanel() {
  return `<h2>Flotilla</h2><p class="demo">${demoNotice}</p>
    ${renderFleetManagement()}
    <h3>Vehículos y choferes</h3>
    <div class="panel-grid two-col">
      <div><h4>Vehículos</h4><div id="vehicleList">${renderVehicleList()}</div></div>
      <div><h4>Choferes</h4><div class="list" id="driverList">${renderDriverList()}</div></div>
    </div>`;
}
function renderIncidenciasPanel() {
  return `<h2>Incidencias</h2><p class="demo">${demoNotice}</p>
    <div class="list">${incidents.map((incident) => `<button class="row selectable${incident.code === selectedIncidentId ? ' selected' : ''}" data-incident="${incident.code}"><span>${incident.type}<br>${incident.sector}</span>${pill('open')}</button>`).join('')}</div>`;
}
// SW-047: eficiencia por ruta/chofer, agregada sobre corridas medidas reales (route_runs con GPS
// real, SW-044/045) — solo tiene sentido con backend real conectado (la demo no tiene route_runs
// persistidos), mismo criterio que refreshRouteDurationHistory(). El panel se rellena de forma
// asíncrona (refreshEfficiencyDashboard()) al abrir la pestaña, no al construir este HTML estático.
function renderEstadisticasPanel() {
  return `<h2>Estadísticas</h2><p class="demo">${demoNotice} · Eficiencia por ruta y chofer, calculada sobre corridas con duración/distancia medida real.</p>
    <h3>Por ruta</h3><div id="statsByRoute" class="list"><p class="demo">Cargando…</p></div>
    <h3>Por chofer</h3><div id="statsByDriver" class="list"><p class="demo">Cargando…</p></div>`;
}
async function refreshEfficiencyDashboard() {
  const byRouteEl = document.getElementById('statsByRoute');
  const byDriverEl = document.getElementById('statsByDriver');
  if (!byRouteEl || !byDriverEl) return;
  if (!realAdapter) {
    const message = '<p class="demo">Requiere un backend real conectado — la demo no acumula corridas persistidas.</p>';
    byRouteEl.innerHTML = message;
    byDriverEl.innerHTML = message;
    return;
  }
  const result = await realAdapter.listRouteRuns();
  if (currentOpsView() !== 'estadisticas') return; // el usuario navegó a otra pestaña mientras esto estaba en vuelo
  if (!result.ok) {
    byRouteEl.innerHTML = '<p class="demo">No se pudo cargar el histórico de corridas.</p>';
    byDriverEl.innerHTML = '<p class="demo">No se pudo cargar el histórico de corridas.</p>';
    return;
  }
  const byRoute = summarizeRouteRunsByRoute(result.data);
  const byDriver = summarizeRouteRunsByDriver(result.data);
  byRouteEl.innerHTML = byRoute.length
    ? byRoute.map((stat) => {
        const route = routes.find((r) => r.real_id === stat.routeId);
        return `<div class="row"><span>${route?.name ?? 'Ruta eliminada'}<br><small>${stat.runsCount} corrida(s)</small></span><span>${formatMinutes(stat.avgDurationMinutes)} prom. · última ${formatMinutes(stat.lastDurationMinutes)}${stat.avgDistanceKm != null ? ` · ${stat.avgDistanceKm} km prom.` : ''}</span></div>`;
      }).join('')
    : '<p class="demo">Todavía no hay corridas con duración medida.</p>';
  byDriverEl.innerHTML = byDriver.length
    ? byDriver.map((stat) => {
        const driver = drivers.find((d) => d.real_id === stat.driverId);
        return `<div class="row"><span>${driver?.name ?? 'Chofer eliminado'}<br><small>${stat.runsCount} corrida(s)</small></span><span>${formatMinutes(stat.avgDurationMinutes)} prom. · última ${formatMinutes(stat.lastDurationMinutes)}${stat.avgDistanceKm != null ? ` · ${stat.avgDistanceKm} km prom.` : ''}</span></div>`;
      }).join('')
    : '<p class="demo">Todavía no hay corridas con duración medida.</p>';
}
// Fase 3 UX (auditoría SW-020): "Municipal" hacía 5 cosas a la vez en un solo scroll (buscar rutas/
// vehículos/incidencias, gestionar flota, crear rutas), y el mapa vivía en su propia pestaña de
// nivel superior aparte. Agrupa Mapa/Rutas/Flota/Incidencias bajo un único espacio "Operaciones"
// con sub-vistas locales (hash propio #operaciones/<vista>, no rompe deep-links existentes) —
// mismas funciones/estado que antes (renderRoutes(), renderVehicleList(), renderFleetManagement(),
// renderCreateRoute() sin cambios), solo reorganizado en paneles separados.
const OPS_VIEWS = ['mapa', 'rutas', 'flota', 'incidencias', 'estadisticas'];
const OPS_VIEW_LABELS = { mapa: 'Mapa', rutas: 'Rutas', flota: 'Flotilla', incidencias: 'Incidencias', estadisticas: 'Estadísticas' };
function renderOperations() {
  return `<section id="operaciones" class="section">
    <div class="ops-nav" role="tablist" aria-label="Vistas de Operaciones">${OPS_VIEWS.map((view) => `<button type="button" class="ops-tab" data-ops-nav="${view}" role="tab">${OPS_VIEW_LABELS[view]}</button>`).join('')}</div>
    <div class="ops-panel operations-shell" data-ops-view="mapa">${renderMapPanel()}</div>
    <div class="ops-panel card" data-ops-view="rutas">${renderRutasPanel()}</div>
    <div class="ops-panel card" data-ops-view="flota">${renderFlotaPanel()}</div>
    <div class="ops-panel card" data-ops-view="incidencias">${renderIncidenciasPanel()}</div>
    <div class="ops-panel card" data-ops-view="estadisticas">${renderEstadisticasPanel()}</div>
  </section>`;
}
function renderVehicleList() { return trucks.map((truck) => `<button class="row selectable${truck.id === selectedTruckId ? ' selected' : ''}" data-truck="${truck.id}"><span>${truckIcon(truck)} ${truck.unit}<br>${driverName(truck.driverId)}</span>${pill(truck.state)}</button>`).join(''); }
// SW-032: the "Crear cuenta de acceso" button only makes sense once Supabase is configured (it
// calls a real Edge Function, see supabase/functions/create-driver-account) and only for a driver
// that has an email on file and no account yet — readSupabaseConfig() is the same opt-in check
// frontend/auth-gate.js already uses, reused here rather than reimplemented.
function renderDriverList() {
  const supabaseConfigured = Boolean(readSupabaseConfig());
  return drivers.map((driver) => {
    const canProvision = supabaseConfigured && driver.email && driver.real_id && !driver.profile_id;
    const accountButton = canProvision ? `<button type="button" class="btn-primary" data-fleet-driver-account="${driver.id}">Crear cuenta de acceso</button>` : '';
    // SW-050 (revisión): for a driver that already has an account, resets their password to a new
    // temporary one shown here on screen — no link/email involved, so nothing to lose or expire;
    // usable anytime the dispatcher needs to hand the driver working credentials again.
    const resendButton = (supabaseConfigured && driver.real_id && driver.profile_id)
      ? `<button type="button" data-fleet-driver-resend="${driver.id}">Restablecer contraseña</button>`
      : '';
    const accountPill = driver.profile_id ? pill('active') : '';
    return `<div class="row"><span>${driver.name}<br>${driver.phone || 'Sin teléfono'}</span>${pill(driver.status === 'Disponible' ? 'active' : 'assigned')}${accountPill}${accountButton}${resendButton}</div>`;
  }).join('');
}
// SW-031: fixes the original gap — there was no screen anywhere to register a new vehicle or
// driver; both were hardcoded arrays in shared/demo-data.js, so operationsAdapter.createVehicle/
// createDriver existed only on the Supabase adapter and had no demo equivalent at all. This
// registers against the adapter (for parity with how routes/route_stops are already written here)
// and mirrors the result into the imported trucks/drivers arrays, same dual-write pattern
// finishCreateRoute() already uses for routes (operationsAdapter.createRoute() + routes.push()) —
// every existing render function already reads trucks/drivers directly, not through the adapter.
// Driver login accounts are a separate, Supabase-only concern (see docs/TECHNICAL_DEBT_REGISTER.md);
// a driver created here has no access account yet, only a record.
// SW-054: driver list moved out to renderFlotaPanel() (now lives alongside the vehicle list, both
// below the forms) — this function is creation-only now, matching its own heading.
function renderFleetManagement() {
  return `<div class="card" id="fleetManagement">
    <h3>Registrar nuevo vehículo o chofer</h3>
    <p class="demo">${demoNotice} · El chofer queda registrado sin cuenta de acceso todavía.</p>
    <div class="panel-grid two-col">
      <div>
        <h4>Nuevo vehículo</h4>
        <div class="controls"><input id="fleetVehicleUnit" placeholder="Unidad (p. ej. SW-LS-07)"><input id="fleetVehiclePlate" placeholder="Matrícula"><input id="fleetVehicleMaxStops" type="number" min="1" placeholder="Paradas máx. por viaje" value="20"></div>
        <div class="controls"><button type="button" class="btn-primary" data-fleet="create-vehicle">Registrar vehículo</button></div>
        <p id="fleetVehicleStatus" class="demo"></p>
      </div>
      <div>
        <h4>Nuevo chofer</h4>
        <div class="controls"><input id="fleetDriverName" placeholder="Nombre del chofer"><input id="fleetDriverPhone" placeholder="Teléfono"><input id="fleetDriverEmail" type="email" placeholder="Correo (para cuenta de acceso, opcional)"></div>
        <div class="controls"><button type="button" class="btn-primary" data-fleet="create-driver">Registrar chofer</button></div>
        <p id="fleetDriverStatus" class="demo"></p>
      </div>
    </div>
  </div>`;
}
function refreshFleetSelects() {
  const createRouteVehicleSelect = $('#createRouteVehicle');
  if (createRouteVehicleSelect) createRouteVehicleSelect.innerHTML = `<option value="">Sin vehículo asignado (asignar después)</option>${trucks.filter(isTruckAvailable).map((truck) => `<option value="${truck.id}">${truck.unit}</option>`).join('')}`;
  const vehicleList = $('#vehicleList');
  if (vehicleList) vehicleList.innerHTML = renderVehicleList();
  const driverList = $('#driverList');
  if (driverList) driverList.innerHTML = renderDriverList();
  // SW-043: routeFocusSelect()'s dropdown must pick up routes created/hydrated after page load —
  // outerHTML (not innerHTML) since routeFocusSelect() also decides whether the element is disabled.
  const simVehicleSelect = $('#simVehicle');
  if (simVehicleSelect) simVehicleSelect.outerHTML = routeFocusSelect();
}
// SW-034: best-effort mirror of a mutation to the real adapter, on top of the existing demo-
// adapter write every mutation handler already does first (unchanged, so the UI still updates
// instantly regardless of network latency or whether Supabase is configured at all). Appends a
// note to the given status element only on failure — success stays silent since the optimistic
// demo update already told the user it worked. Returns the real row's data on success (null
// otherwise) so callers that need the real id (e.g. to later link a driver's login account) can
// keep it — the demo id and the real id are never the same value.
async function mirrorToRealAdapter(promise, status) {
  if (!realAdapter) return null;
  try {
    const result = await promise;
    if (!result?.ok) { if (status) status.textContent += ` (no se pudo sincronizar con Supabase: ${result?.error?.message ?? 'error desconocido'})`; return null; }
    return result.data;
  } catch (error) {
    if (status) status.textContent += ` (no se pudo sincronizar con Supabase: ${error.message})`;
    return null;
  }
}
// Extraído de createVehicleFromForm/createDriverFromForm (antes duplicaban la escritura dual +
// real_id linking inline) para que el wizard de configuración inicial (renderOnboardingOverlay()
// más abajo) pueda crear el primer vehículo/chofer sin reimplementar esa lógica ni depender de los
// ids del formulario de Flota, que viven en otro panel del DOM.
async function createVehicle({ unit, plate = '', maxStops = DEFAULT_MAX_STOPS }, status) {
  const created = operationsAdapter.createVehicle({ unit, name: unit, plate, max_stops: maxStops });
  trucks.push(created);
  refreshFleetSelects();
  // Same real-id linking as createDriver() below — a real vehicles row gets its own Postgres id,
  // kept on the demo-shaped truck object so a later route assignment can reference the real row too.
  const realVehicle = await mirrorToRealAdapter(realAdapter?.createVehicle({ code: unit, plate, max_stops: maxStops }), status);
  if (realVehicle) created.real_id = realVehicle.id;
  return created;
}
async function createDriver({ name, phone = '', email } = {}, status) {
  const created = operationsAdapter.createDriver({ name, phone, email });
  drivers.push(created);
  refreshFleetSelects();
  // The real drivers row gets its own id (a Postgres uuid, never the same as the demo id above) —
  // createDriverAccount() needs THAT id to call the Edge Function against a row that actually
  // exists in Supabase, so it's kept on the demo-shaped object rather than discarded.
  // SW-050: email is now persisted on the real drivers row too (supabase/migrations/
  // 202607150014_sw050_driver_email.sql) — before this it only lived on `created` above, in this
  // browser tab's memory, so "Crear cuenta de acceso" silently stopped being possible forever the
  // moment the page reloaded and re-hydrated this driver from Supabase without an email.
  const realDriver = await mirrorToRealAdapter(realAdapter?.createDriver({ display_name: name, email }), status);
  if (realDriver) created.real_id = realDriver.id;
  return created;
}
async function createVehicleFromForm() {
  const unitInput = $('#fleetVehicleUnit'); const plateInput = $('#fleetVehiclePlate'); const maxStopsInput = $('#fleetVehicleMaxStops'); const status = $('#fleetVehicleStatus');
  const unit = unitInput?.value.trim();
  if (!unit) { if (status) status.textContent = 'Ingresa una unidad para el vehículo.'; return; }
  const created = await createVehicle({ unit, plate: plateInput?.value.trim() ?? '', maxStops: Number(maxStopsInput?.value) || DEFAULT_MAX_STOPS }, status);
  if (unitInput) unitInput.value = ''; if (plateInput) plateInput.value = ''; if (maxStopsInput) maxStopsInput.value = '20';
  if (status) status.textContent = `Vehículo "${created.unit}" registrado.`;
}
async function createDriverFromForm() {
  const nameInput = $('#fleetDriverName'); const phoneInput = $('#fleetDriverPhone'); const emailInput = $('#fleetDriverEmail'); const status = $('#fleetDriverStatus');
  const name = nameInput?.value.trim();
  if (!name) { if (status) status.textContent = 'Ingresa un nombre para el chofer.'; return; }
  const created = await createDriver({ name, phone: phoneInput?.value.trim() ?? '', email: emailInput?.value.trim() || undefined }, status);
  if (nameInput) nameInput.value = ''; if (phoneInput) phoneInput.value = ''; if (emailInput) emailInput.value = '';
  if (status) status.textContent = `Chofer "${created.name}" registrado (sin cuenta de acceso todavía).`;
}
function renderOnboardingOverlay() {
  const step = !onboardingVehicle ? 1 : !onboardingDriver ? 2 : 3;
  return `<div id="onboardingOverlay" class="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Configuración inicial">
    <div class="onboarding-card card">
      <p class="eyebrow">Configuración inicial · Municipio real</p>
      <h2>Arranquemos con tu primera ruta</h2>
      <p class="demo">Sin datos demo — lo que registres acá es real y queda en Supabase. Dos pasos rápidos (vehículo, chofer); el tercero es dibujar tu primera ruta en el mapa normal, ya con todo pre-seleccionado.</p>
      <ol class="onboarding-steps">
        <li class="${step > 1 ? 'done' : 'active'}">1. Vehículo</li>
        <li class="${step > 2 ? 'done' : step === 2 ? 'active' : ''}">2. Chofer</li>
        <li class="${step === 3 ? 'active' : ''}">3. Primera ruta</li>
      </ol>
      ${step === 1 ? renderOnboardingVehicleStep() : renderOnboardingDriverStep()}
    </div>
  </div>`;
}
function renderOnboardingVehicleStep() {
  return `<div class="controls"><input id="onboardVehicleUnit" placeholder="Unidad (p. ej. SW-LS-01)"><input id="onboardVehiclePlate" placeholder="Matrícula"><input id="onboardVehicleMaxStops" type="number" min="1" value="20" placeholder="Paradas máx. por viaje"></div>
    <p id="onboardVehicleStatus" class="demo"></p>
    <div class="controls"><button type="button" class="btn-primary" data-onboard="vehicle">Siguiente: chofer</button></div>`;
}
function renderOnboardingDriverStep() {
  return `<p class="demo">Vehículo registrado: <b>${onboardingVehicle.unit}</b></p>
    <div class="controls"><input id="onboardDriverName" placeholder="Nombre del chofer"><input id="onboardDriverPhone" placeholder="Teléfono"><input id="onboardDriverEmail" type="email" placeholder="Correo (para cuenta de acceso, opcional)"></div>
    <p id="onboardDriverStatus" class="demo"></p>
    <div class="controls"><button type="button" class="btn-primary" data-onboard="driver">Siguiente: primera ruta</button></div>`;
}
function showOnboardingOverlay() {
  if ($('#onboardingOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', renderOnboardingOverlay());
}
async function onboardVehicleStep() {
  const unitInput = $('#onboardVehicleUnit'); const plateInput = $('#onboardVehiclePlate'); const maxStopsInput = $('#onboardVehicleMaxStops'); const status = $('#onboardVehicleStatus');
  const unit = unitInput?.value.trim();
  if (!unit) { if (status) status.textContent = 'Ingresa una unidad para el vehículo.'; return; }
  if (status) status.textContent = 'Registrando vehículo…';
  onboardingVehicle = await createVehicle({ unit, plate: plateInput?.value.trim() ?? '', maxStops: Number(maxStopsInput?.value) || DEFAULT_MAX_STOPS }, status);
  const overlay = $('#onboardingOverlay');
  if (overlay) overlay.outerHTML = renderOnboardingOverlay();
}
async function onboardDriverStep() {
  const nameInput = $('#onboardDriverName'); const phoneInput = $('#onboardDriverPhone'); const emailInput = $('#onboardDriverEmail'); const status = $('#onboardDriverStatus');
  const name = nameInput?.value.trim();
  if (!name) { if (status) status.textContent = 'Ingresa un nombre para el chofer.'; return; }
  if (status) status.textContent = 'Registrando chofer…';
  // SW-044: el paso de chofer del wizard no tenía campo de email — sin él, "Crear cuenta de
  // acceso" (renderDriverList(), requiere driver.email) nunca aparecía para un chofer dado de alta
  // acá, a diferencia del formulario normal de Flota (createDriverFromForm()) que sí lo pide.
  onboardingDriver = await createDriver({ name, phone: phoneInput?.value.trim() ?? '', email: emailInput?.value.trim() || undefined }, status);
  finishOnboardingHandoff();
}
// Cierra el wizard y entrega el control al flujo de "Crear ruta" que ya existe (mismo mapa/OSRM/
// generación de paradas que usa cualquier ruta creada a mano) — nada nuevo que mantener para el
// paso 3, solo lo dejamos abierto y con el vehículo recién creado ya seleccionado.
function finishOnboardingHandoff() {
  needsOnboarding = false;
  $('#onboardingOverlay')?.remove();
  location.hash = 'operaciones/rutas';
  requestAnimationFrame(() => {
    const toggle = $('#createRouteToggle');
    if (toggle && !toggle.open) toggle.open = true;
    const vehicleSelect = $('#createRouteVehicle');
    if (vehicleSelect && onboardingVehicle) vehicleSelect.value = onboardingVehicle.id;
    const status = $('#createRouteStatus');
    if (status) status.textContent = `Vehículo "${onboardingVehicle.unit}" y chofer "${onboardingDriver.name}" listos. Dibuja al menos 2 puntos en el mapa para tu primera ruta real.`;
    toggle?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
// SW-032/SW-034: calls the supabase/functions/create-driver-account Edge Function with the
// currently signed-in session (getAuthClient(), set by auth-gate.js) — never touches service_role
// from here. Only reachable in real Supabase mode (renderDriverList() only shows the button then).
// Note this operates on real Supabase driver rows specifically — a driver registered through the
// form above only gets one once its own createDriver mirror (just above) has succeeded.
async function createDriverAccount(driverId) {
  const status = $('#fleetDriverStatus');
  const client = getAuthClient();
  if (!client) { if (status) status.textContent = 'No hay sesión de Supabase activa.'; return; }
  const driver = drivers.find((item) => item.id === driverId);
  if (!driver) return;
  if (!driver.real_id) { if (status) status.textContent = `"${driver.name}" todavía no está sincronizado con Supabase — espera a que la sincronización termine e intenta de nuevo.`; return; }
  if (status) status.textContent = `Creando cuenta de acceso para "${driver.name}"...`;
  const { data, error } = await client.functions.invoke('create-driver-account', { body: { driver_id: driver.real_id, email: driver.email } });
  if (error) { if (status) status.textContent = `No se pudo crear la cuenta: ${error.message}`; return; }
  driver.profile_id = data.profile_id;
  // SW-050 (revisión): create-driver-account now returns a temporary_password (set directly via
  // auth.admin.createUser, email_confirm:true) instead of an invite link — Supabase's invite/
  // recovery links proved unreliable in staging (instant "invalid or expired", redirect config
  // dependent). The driver logs in with this password through the existing email+password form.
  if (status) status.textContent = data.temporary_password ? `Cuenta creada para "${driver.name}". Contraseña temporal: ${data.temporary_password} — compartísela al chofer para que inicie sesión con su email y esta contraseña.` : `Cuenta creada para "${driver.name}".`;
  refreshFleetSelects();
}
// SW-050 (revisión): calls the supabase/functions/resend-driver-invite Edge Function for a driver
// who already has an account (driver.profile_id set) — resets their password to a fresh temporary
// one shown here, instead of the earlier invite-link approach (same reliability issues as above).
async function resendDriverInvite(driverId) {
  const status = $('#fleetDriverStatus');
  const client = getAuthClient();
  if (!client) { if (status) status.textContent = 'No hay sesión de Supabase activa.'; return; }
  const driver = drivers.find((item) => item.id === driverId);
  if (!driver) return;
  if (!driver.real_id) return;
  if (status) status.textContent = `Restableciendo la contraseña de "${driver.name}"...`;
  const { data, error } = await client.functions.invoke('resend-driver-invite', { body: { driver_id: driver.real_id } });
  if (error) { if (status) status.textContent = `No se pudo restablecer la contraseña: ${error.message}`; return; }
  if (status) status.textContent = `Nueva contraseña temporal para "${driver.name}": ${data.temporary_password} — compartísela para que inicie sesión con su email y esta contraseña.`;
}
// SW-027: municipal_admin/supervisor/dispatcher only in real Supabase (RLS: tenant_insert_staff on
// routes and, per 202607150009_sw027_route_paths.sql, on route_paths too — same 3 roles as
// route_stops writes). This demo UI has no live Supabase session/role gating (frontend/app.js has
// always used the in-memory operationsAdapter, never createSupabaseOperationsAdapter — see
// supabase/README.md), so there's nothing here to restrict by role client-side; the restriction is
// real once this UI is pointed at Supabase.
function renderCreateRoute() {
  const availableTrucks = trucks.filter(isTruckAvailable);
  return `<div class="card" id="createRoute">
    <h3>Crear ruta</h3>
    <p class="demo">${demoNotice} · Clic en el mapa para agregar puntos al trazo, en orden. Al finalizar se intenta ajustar el trazo a calles reales (OSRM); si no es posible, se usa línea recta entre los puntos. Opcionalmente, puedes optimizar el orden de las paradas (excepto la primera) para minimizar la distancia recorrida antes de ajustar a calles.</p>
    <div class="controls"><input id="createRouteName" placeholder="Nombre de la ruta"><select id="createRouteVehicle"><option value="">Sin vehículo asignado (asignar después)</option>${availableTrucks.map((t) => `<option value="${t.id}">${t.unit}</option>`).join('')}</select></div>
    <div class="controls"><label><input type="checkbox" id="createRouteOptimize"> Optimizar orden de paradas (mantiene el primer punto como inicio)</label></div>
    <div id="createRouteMap" class="real-map driver-map" role="application" aria-label="Dibujar trazo de ruta nueva"></div>
    <div class="controls"><button type="button" class="btn-ghost" data-create-route="undo">Deshacer último punto</button><button type="button" class="btn-primary" data-create-route="finish">Finalizar y guardar</button></div>
    <p id="createRouteStatus" class="demo">${drawnRoutePoints.length} punto(s) trazado(s).</p>
    <p id="createRouteTripPreview" class="demo"></p>
  </div>`;
}
// SW-044 (revisión tras pruebas en staging): el flujo principal es 100% del chofer — "Iniciar
// recorrido" arranca la ruta Y prende el GPS real en un solo toque; "Finalizar recorrido" la
// completa Y apaga el GPS. Admin/dispatcher conservan sus propios botones en
// renderRouteDetail() (startAction/completeAction) como respaldo para una emergencia (chofer sin
// señal, celular sin batería) — esos NUNCA deben tocar el GPS de otra persona, por eso son
// atributos [data-driver-*] separados con sus propios handlers (driverStartRoute()/
// driverCompleteRoute() más abajo), no los mismos [data-start-route]/[data-complete-route] que usa
// el panel de admin.
function driverRouteLifecycleControl(truck) {
  const route = truck?.routeId ? routeById(truck.routeId) : null;
  if (!route) return '';
  if (route.status === 'assigned') return `<div class="controls"><button type="button" class="btn-primary" data-driver-start-route="${route.id}">Iniciar recorrido</button></div>`;
  if (['started', 'in_progress', 'delayed'].includes(route.status)) return `<div class="controls"><button type="button" class="btn-primary" data-driver-complete-route="${route.id}">Finalizar recorrido</button></div>`;
  return '';
}
function renderDriverMobile() {
  const truck = trucks.find((item) => item.id === driverVehicleId);
  // Defensivo (Codex review PR #54): driverVehicleId puede quedar en null cuando el wizard de
  // onboarding vacía trucks para un municipio real recién conectado — sin esto, un truck.state
  // sobre undefined tumbaría esta vista si algo la volviera a invocar antes de que exista un
  // vehículo real.
  const routeInfoLine = truck ? `${pill(truck.state)} ${routeName(truck.routeId)} · ${truck.progress}% completado` : 'Sin vehículo real asignado todavía.';
  return `<div class="mobile" id="driverMobile">
    <select id="driverVehicleSelect" aria-label="Vehículo del conductor">${trucksWithRoute.map((t) => `<option value="${t.id}" ${t.id === driverVehicleId ? 'selected' : ''}>${t.unit}</option>`).join('')}</select>
    <p id="driverRouteInfo">${routeInfoLine}</p>
    <div id="driverRouteLifecycleControl">${driverRouteLifecycleControl(truck)}</div>
    <p id="driverStopsProgress"></p>
    <div id="driverMap" class="real-map driver-map" role="application" aria-label="Posición y trazo del vehículo (demo)"></div>
    <p class="demo">${simulationNotice} · trazo histórico vía polling cada ${DRIVER_POLL_INTERVAL_MS / 1000}s (sin Realtime, ver docs/TECHNICAL_DEBT_REGISTER.md #14)</p>
    ${backendMode !== 'DEMO_ONLY' ? renderDriverGpsControl() : ''}
  </div>`;
}
function renderDriverGpsControl() {
  return `<div class="controls"><button type="button" class="btn-primary" data-driver-gps="${driverGpsWatchId ? 'stop' : 'start'}">${driverGpsWatchId ? 'Detener GPS real' : 'Compartir mi ubicación real'}</button></div><p id="driverGpsStatus" class="demo"></p>`;
}
// Roadmap item 3 ("GPS real"): opt-in — only reachable via the button above, which only renders
// once a real backend is configured (backendMode !== 'DEMO_ONLY'). Persists the driver's own
// browser/phone location to Supabase (source: browser_geolocation); does not touch the simulation
// engine or any map rendering (drawDriverPositions/drawMapLayers stay demo-driven, by design —
// showing real GPS on a live map is a separate, later milestone).
async function startDriverGps() {
  const status = $('#driverGpsStatus');
  if (!navigator.geolocation) { if (status) status.textContent = 'Este navegador no soporta geolocalización.'; return; }
  if (!realAdapter || !driverAuthContext) { if (status) status.textContent = 'GPS real requiere una sesión conectada a Supabase.'; return; }
  if (status) status.textContent = 'Buscando tu vehículo asignado…';
  const assignment = await realAdapter.findOwnVehicleAssignment(driverAuthContext.user_id);
  if (!assignment.ok) { if (status) status.textContent = `No se pudo activar el GPS real: ${assignment.error.message}`; return; }
  const vehicleId = assignment.data.vehicle_id;
  const client = getAuthClient();
  const telemetry = createTelemetryIngestionAdapter(client, { municipality_id: driverAuthContext.municipality_id });
  let lastSentAt = 0;
  driverGpsWatchId = navigator.geolocation.watchPosition(async (geoPosition) => {
    const now = Date.now();
    if (!shouldSendPosition(lastSentAt, now)) return;
    lastSentAt = now;
    const position = positionFromGeolocationEvent(geoPosition, { vehicle_id: vehicleId, municipality_id: driverAuthContext.municipality_id });
    const result = await telemetry.ingest(position);
    const currentStatus = $('#driverGpsStatus');
    if (currentStatus) currentStatus.textContent = result.ok ? `Última posición real enviada: ${new Date().toLocaleTimeString()}` : `No se pudo enviar la posición real: ${result.error?.message ?? 'error desconocido'}`;
  }, (error) => {
    const currentStatus = $('#driverGpsStatus');
    if (currentStatus) currentStatus.textContent = `No se pudo obtener tu ubicación: ${error.message}`;
    stopDriverGps();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
  const button = document.querySelector('[data-driver-gps]');
  if (button) { button.dataset.driverGps = 'stop'; button.textContent = 'Detener GPS real'; }
}
function stopDriverGps() {
  if (driverGpsWatchId != null) navigator.geolocation.clearWatch(driverGpsWatchId);
  driverGpsWatchId = null;
  const button = document.querySelector('[data-driver-gps]');
  if (button) { button.dataset.driverGps = 'start'; button.textContent = 'Compartir mi ubicación real'; }
}
// Ítem #12 de docs/TECHNICAL_DEBT_REGISTER.md: la vista móvil del conductor vivía embebida como un
// <div class="mobile"> de unas pocas líneas dentro de renderMunicipal() — sin sección propia ni
// enlace de navegación propio, a pesar de que el README la promete como una vista dedicada. Ahora
// es su propia <section id="conductor">, con el mismo contenido (renderDriverMobile() sin cambios)
// solo movido a un lugar de primer nivel, gateado a los mismos roles que ya veían Municipal
// (municipal_admin/dispatcher/driver — frontend/auth-gate.js's SECTION_ROLES).
function renderDriverSection() { return `<section id="conductor" class="section card"><h2>Vista móvil conductor</h2><p class="demo">${demoNotice} · Posición y trazo del vehículo asignado.</p>${renderDriverMobile()}</section>`; }
// SW-054: every route row shared the exact same flat background (only the currently-selected one
// stood out) — the Project Owner reported the list was hard to scan. `route-status-${status}` adds
// a left-border tint per status (CSS, `.list.compact .row[class*="route-status-"]`), reusing the
// same status keyword `pill()` already renders (no new vocabulary, just a second surface for it).
function renderRoutes(items) { return items.map((route) => { const status = routeReadinessStage(route, trucks.find((truck) => truck.routeId === route.id)) ?? routeStatus(route); return `<article class="row selectable route-status-${status}${route.id === selectedRouteId ? ' selected' : ''}" data-route="${route.id}"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ETA ${route.eta}<br>${progress(route.progress)}</div><div>${pill(status)}<br>${route.covered}/${route.stops} paradas</div></article>`; }).join(''); }
// SW-058: real citizen reports get their own block (only ever populated when a real backend is
// connected — hydrateCitizenReports()) instead of being merged into the existing "Incidencias
// abiertas" block, which stays 100% demo (`incidents` array — an unrelated concept, see
// docs/TECHNICAL_DEBT_REGISTER.md #23). Keeps the demo path byte-identical (rule 5).
//
// Codex review (PR #75, P1): #supervisor is only ever visible to role 'supervisor'
// (frontend/auth-gate.js's SECTION_ROLES), but that's CSS-only gating — it doesn't stop
// hydrateCitizenReports() from fetching report data (description, folio) into a driver's or
// dispatcher's browser/module state regardless. The actual restriction has to live in
// hydrateCitizenReports() itself (role check before the fetch even happens), not here — this
// function only decides what to render *given* whatever realCitizenReports already holds. Always
// renders the wrapping div (even empty) so refreshCitizenReportsBlock() below always has an
// element to replace, regardless of backendMode/role at the time #supervisor was last built.
function renderCitizenReportsBlock() {
  if (backendMode === 'DEMO_ONLY') return '<div id="citizenReportsBlock"></div>';
  return `<div id="citizenReportsBlock"><h3>Reportes ciudadanos reales</h3>${realCitizenReports.length ? realCitizenReports.map((report) => `<article class="row"><div><strong>${escapeHtml(report.type)}</strong><br>Folio ${escapeHtml(report.folio)}${report.description ? ` · ${escapeHtml(report.description)}` : ''}</div><div>${pill('open')}<button class="btn-primary" data-resolve-citizen-report="${report.id}">Marcar resuelto</button></div></article>`).join('') : '<p>Sin reportes ciudadanos reales pendientes.</p>'}</div>`;
}
// Codex review (PR #75, P2): hydrateCitizenReports() only ran once, at login bootstrap — a report
// submitted afterward never appeared without a full page reload. Re-fetches + re-renders just this
// block (not the whole #supervisor section, which would re-trigger showSection() and risk a loop
// with the hook in showSection() below that calls this on every entry into "supervisor").
async function refreshCitizenReportsBlock() {
  await hydrateCitizenReports();
  const el = document.getElementById('citizenReportsBlock');
  if (el) el.outerHTML = renderCitizenReportsBlock();
}
function renderSupervisor() {
  const pendingVerification = routes.filter((route) => route.status === 'completed');
  const openIncidents = incidents.filter((incident) => incident.status !== 'Cerrada');
  return `<section id="supervisor" class="section card"><h2>Panel de supervisor</h2><p class="demo">${demoNotice} · Verificación de rutas completadas y gestión de incidencias. "Verificar" ruta escribe contra Supabase cuando hay backend real conectado; "Marcar resuelta" una incidencia demo sigue siendo solo local, pero los reportes ciudadanos reales (abajo) sí escriben contra Supabase.</p><div class="panel-grid">
    <div><h3>Rutas pendientes de verificación</h3>${pendingVerification.length ? pendingVerification.map((route) => `<article class="row"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ${route.progress}% completado</div><div>${pill('completed')}<button class="btn-primary" data-verify-route="${route.id}">Verificar</button></div></article>`).join('') : '<p>No hay rutas completadas pendientes de verificación.</p>'}</div>
    <div><h3>Incidencias abiertas</h3>${openIncidents.length ? openIncidents.map((incident) => `<article class="row"><div><strong>${incident.type}</strong><br>${incident.sector} · ${incident.priority}</div><div>${pill('open')}<button class="btn-primary" data-resolve-incident="${incident.code}">Marcar resuelta</button></div></article>`).join('') : '<p>Sin incidencias abiertas.</p>'}</div>
    ${renderCitizenReportsBlock()}
  </div></section>`;
}
function renderCitizen() { return `<section id="ciudadania" class="section card"><h2>Portal ciudadano</h2><p class="demo">${demoNotice}</p><div class="panel-grid"><div><h3>Consulta de recogida</h3><select id="citizenSector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><p id="pickupResult"></p><h3>Avisos municipales</h3>${notifications.map((n) => `<div class="row">🔔 ${n}</div>`).join('')}</div><form id="incidentForm"><h3>Reportar incidencia</h3><select name="type"><option>Basura no recogida</option><option>Vertedero improvisado</option></select><select name="sector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><textarea name="description" placeholder="Descripción demo"></textarea><input id="manualAddress" name="address" placeholder="Dirección manual si no usa GPS"><button type="button" id="useGeo">Usar ubicación GPS del navegador</button><p id="geoStatus" class="demo">GPS requiere permiso del usuario.</p><input id="evidence" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" aria-label="Adjuntar evidencia demo"><p id="evidencePreview" class="demo">Evidencia local; no upload real verificado.</p><button class="btn-primary">Obtener folio</button><p id="folio"></p></form><div><h3>Consultar estado</h3><input id="folioSearch" value="SW-FOLIO-1001"><button id="checkFolio">Consultar</button><p id="folioStatus"></p><h3>Futura relación</h3><p>Preparado para Chatbot Municipal: preguntas frecuentes, folios y avisos por sector.</p></div></div></section>`; }

const money = (value) => `RD$ ${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
const num = (value, suffix = '') => `${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 1 })}${suffix}`;
function bar(value, max = 100) { return `<span class="mini-bar"><i style="width:${Math.min(100, Math.max(0, (value / max) * 100))}%"></i></span>`; }
// UX cleanup (SW-037): Impacto y Ahorros dumped ~50 piezas de contenido (34 tarjetas KPI + 4
// artículos de resumen + supuestos + economía + gráficos + antes/después + lectura de sectores) en
// un solo scroll continuo — la mayor fuente de "demasiada data en pantalla". Reorganizado en 4
// pestañas de nivel superior (mismo patrón ops-nav/ops-tab que ya usa Operaciones) para que solo se
// vea una porción enfocada a la vez; los filtros quedan fuera de las pestañas porque afectan a las 4.
// impactTab/impactKpiGroup son estado de módulo (no del hash, a diferencia de las sub-vistas de
// Operaciones) porque esta sección no necesita enlaces profundos propios — mismo patrón que
// selectedRouteId.
const IMPACT_TABS = ['resumen', 'uso', 'metricas', 'economia', 'analisis'];
const IMPACT_TAB_LABELS = { resumen: 'Resumen', uso: 'Uso', metricas: 'Métricas', economia: 'Economía', analisis: 'Análisis' };
let impactTab = IMPACT_TABS[0];
const IMPACT_KPI_GROUPS = [
  { id: 'servicio', label: 'Servicio', build: (m) => [
    ['Rutas planificadas', m.routes.planned], ['Asignadas', m.routes.assigned], ['Iniciadas', m.routes.started], ['En progreso', m.routes.inProgress], ['Retrasadas', m.routes.delayed], ['Completadas', m.routes.completed], ['Verificadas', m.routes.verified], ['Cumplimiento', `${m.routes.complianceRate}%`], ['Puntualidad', `${m.routes.punctualityRate}%`], ['Progreso promedio', `${m.routes.progressAverage}%`],
    ['Sectores planificados', m.coverage.plannedSectors], ['Sectores atendidos', m.coverage.attendedSectors], ['Cobertura', `${m.coverage.coverageRate}%`], ['Pendientes', m.coverage.pendingSectors]
  ] },
  { id: 'flota', label: 'Flota', build: (m) => [
    ['Vehículos totales', m.fleet.total], ['Activos', m.fleet.active], ['Detenidos', m.fleet.stopped], ['Retrasados', m.fleet.delayed], ['Offline', m.fleet.offline], ['Mantenimiento', m.fleet.maintenance], ['Disponibilidad', `${m.fleet.availabilityRate}%`], ['Utilización', `${m.fleet.utilizationRate}%`]
  ] },
  { id: 'incidencias', label: 'Incidencias', build: (m) => [
    ['Incidencias abiertas', m.incidents.open], ['Incidencias resueltas', m.incidents.resolved], ['Resolución promedio', `${m.incidents.avgResolutionHours} h`], ['Reincidencias demo', m.incidents.recurrenceDemo]
  ] },
  { id: 'operacion', label: 'Operación', build: (m) => [
    ['Km recorridos', `${m.operation.distanceKm} km`], ['Km productivos est.', `${m.operation.productiveKm} km`], ['Km potencialmente evitados', `${m.operation.avoidedKm} km`], ['Horas operativas', `${m.operation.operatingHours} h`], ['Tiempo detenido', `${m.operation.stoppedHours} h`], ['Tiempo improductivo est.', `${m.operation.unproductiveHours} h`]
  ] }
];
let impactKpiGroup = IMPACT_KPI_GROUPS[0].id;
function renderImpactKpiCards(groupId, metrics) {
  const group = IMPACT_KPI_GROUPS.find((g) => g.id === groupId) ?? IMPACT_KPI_GROUPS[0];
  return group.build(metrics).map(([name, value]) => `<div class="kpi"><strong>${value}</strong><br>${name}</div>`).join('');
}
// Pedido del Project Owner: priorizar estadísticas de USO (paradas × min/parada + distancia/
// velocidad) por encima de "ahorro" — con eso las autoridades ya tienen con qué decidir cómo bajar
// costos, aunque todavía sea una estimación por fórmula (no un tiempo real medido — no hay
// timestamps de inicio/fin de ruta persistidos hoy, ver item #4 del debt register). La idea es
// empezar a recoger esta estimación corrida a corrida y afinar minutesPerStop/avgSpeedKmh con el
// tiempo, no reportar un número ya exacto — de ahí el aviso explícito abajo.
function renderUsagePanel(metrics) {
  const usage = metrics.usage;
  const vehicleRows = usage.byVehicle.map((v) => `<p><b>${trucks.find((t) => t.id === v.truckId)?.unit ?? v.truckId}</b><span>${v.routes} ruta(s) · ${v.totalMinutes} min (${v.totalHours} h) estimados</span></p>`).join('') || '<p>Sin vehículos con ruta asignada.</p>';
  const routeRows = usage.byRoute.map((r) => `<p><b>${r.name}</b><span>${r.stops} paradas · ${r.distanceKm} km · ${r.totalMinutes} min estimados (${r.stopMinutes} recolección + ${r.travelMinutes} traslado)</span></p>`).join('') || '<p>Sin rutas.</p>';
  return `<p class="impact-notice small">Estimado, no medido: paradas × minutos/parada + distancia ÷ velocidad promedio. Sirve para empezar a recoger uso por corrida y afinar los supuestos con el tiempo.</p>
    <div class="impact-grid">
      <article><h3>Supuestos de uso</h3><label>Minutos por parada <input id="minutesPerStop" type="number" step="0.1" min="0" value="${usage.minutesPerStop}"></label><label>Velocidad promedio km/h <input id="avgSpeedKmh" type="number" step="0.5" min="1" value="${usage.avgSpeedKmh}"></label></article>
      <article><h3>Uso total estimado hoy</h3><p><b>${usage.totalHours} h</b> de flota en uso estimadas · ${usage.byRoute.length} ruta(s) · ${usage.byVehicle.length} vehículo(s) con ruta.</p></article>
    </div>
    <div class="impact-grid"><article><h3>Por vehículo</h3><div class="comparison-table">${vehicleRows}</div></article><article><h3>Por ruta</h3><div class="comparison-table">${routeRows}</div></article></div>`;
}
function renderImpactCenter(assumptions = defaultImpactAssumptions, filters = {}) {
  const metrics = calculateImpactMetrics(assumptions, filters);
  return `<section id="impacto" class="section impact-center card">
    <div class="impact-hero"><div><p class="eyebrow">Centro de Impacto Operacional</p><h2>Impacto y Ahorros</h2><p class="impact-notice">${IMPACT_DEMO_NOTICE}</p></div><div><strong>Ahorro potencial estimado mensual</strong><b>${money(metrics.economics.monthlyPotentialAvoided)}</b><span>Proyección anual demo: ${money(metrics.economics.annualProjectionDemo)}</span></div></div>
    <div class="impact-filters" aria-label="Filtros demo"><select id="impactPeriod"><option>Hoy</option><option>Últimos 7 días</option><option>Últimos 30 días</option><option>Trimestre</option><option>Año</option><option>Rango personalizado preparado</option></select><select id="impactSector"><option value="">Todos los sectores</option>${sectors.map((s)=>`<option>${s.name}</option>`).join('')}</select><select id="impactRoute"><option value="">Todas las rutas</option>${routes.map((r)=>`<option value="${r.id}">${r.name}</option>`).join('')}</select><select id="impactVehicle"><option value="">Todos los vehículos</option>${trucks.map((t)=>`<option value="${t.id}">${t.unit}</option>`).join('')}</select><select id="impactStatus"><option value="">Todos los estados</option>${['assigned','in_progress','delayed','completed','verified','active','stopped','offline'].map((st)=>`<option value="${st}">${label(st)}</option>`).join('')}</select></div>
    <div class="ops-nav" role="tablist" aria-label="Secciones de Impacto y Ahorros">${IMPACT_TABS.map((t) => `<button type="button" class="ops-tab${t === impactTab ? ' active' : ''}" data-impact-tab="${t}" role="tab">${IMPACT_TAB_LABELS[t]}</button>`).join('')}</div>
    <div class="impact-panel${impactTab === 'resumen' ? '' : ' hidden'}" data-impact-tab-panel="resumen">
      <div class="municipal-360"><article><h3>Servicio</h3><p>${metrics.routes.planned} rutas · ${metrics.coverage.coverageRate}% cobertura · ${metrics.routes.complianceRate}% cumplimiento · ${metrics.coverage.attendedSectors} sectores atendidos.</p></article><article><h3>Operación</h3><p>${metrics.fleet.total} vehículos · ${metrics.operation.distanceKm} km · ${metrics.routes.delayed} retrasos · ${metrics.incidents.open} incidencias abiertas.</p></article><article><h3>Eficiencia</h3><p>${metrics.efficiency.optimizedHours} h optimizadas · ${metrics.efficiency.avoidedKm} km potencialmente evitados · ${metrics.efficiency.fuelSavedLiters} L potencialmente optimizados.</p></article><article><h3>Impacto económico</h3><p>${money(metrics.economics.monthlyPotentialAvoided)} mensual potencial · ${money(metrics.economics.annualProjectionDemo)} anual demo · supuestos en la pestaña Economía.</p></article></div>
    </div>
    <div class="impact-panel${impactTab === 'uso' ? '' : ' hidden'}" data-impact-tab-panel="uso">
      ${renderUsagePanel(metrics)}
    </div>
    <div class="impact-panel${impactTab === 'metricas' ? '' : ' hidden'}" data-impact-tab-panel="metricas">
      <div class="ops-nav" role="tablist" aria-label="Categorías de métricas">${IMPACT_KPI_GROUPS.map((g) => `<button type="button" class="ops-tab${g.id === impactKpiGroup ? ' active' : ''}" data-impact-kpi-group="${g.id}" role="tab">${g.label}</button>`).join('')}</div>
      <div class="kpis impact-kpis" id="impactKpis">${renderImpactKpiCards(impactKpiGroup, metrics)}</div>
    </div>
    <div class="impact-panel${impactTab === 'economia' ? '' : ' hidden'}" data-impact-tab-panel="economia">
      <div class="impact-grid"><article><h3>Supuestos configurables</h3><label>Precio combustible RD$/L <input id="fuelPrice" type="number" value="${metrics.assumptions.fuelPrice}"></label><label>Rendimiento km/L <input id="fuelEfficiency" type="number" step="0.1" value="${metrics.assumptions.fuelEfficiency}"></label><label>Días operativos <input id="operatingDays" type="number" value="${metrics.assumptions.operatingDays}"></label><label>Costo operativo por hora <input id="hourlyCost" type="number" value="${metrics.assumptions.hourlyCost}"></label><p class="demo">Distancia base: ${metrics.assumptions.baseDistanceKm} km · distancia actual simulada: ${metrics.assumptions.currentDistanceKm} km · horas operativas: ${metrics.assumptions.operatingHours} h.</p></article><article id="impactEconomics">${renderImpactEconomics(metrics)}</article></div>
    </div>
    <div class="impact-panel${impactTab === 'analisis' ? '' : ' hidden'}" data-impact-tab-panel="analisis">
      <div class="impact-grid"><article><h3>Visualizaciones operativas</h3>${renderImpactBars(metrics)}</article><article><h3>Antes del sistema vs. con SmartWaste</h3><p class="impact-notice small">${IMPACT_SCENARIO_NOTICE}</p>${renderBeforeAfter(metrics)}</article></div>
      <div class="impact-grid"><article><h3>Integración futura con datos reales</h3>${Object.entries(metricReadiness).map(([k,v])=>`<p><b>${k}</b>: ${v.join(', ')}</p>`).join('')}</article><article><h3>Incidencias y sectores</h3><p>Categorías: ${Object.entries(metrics.incidents.byCategory).map(([k,v])=>`${k} (${v})`).join(' · ')}</p><p>Sectores: ${Object.entries(metrics.incidents.bySector).map(([k,v])=>`${k} (${v})`).join(' · ')}</p><p>Zonas con más incidencias: ${metrics.coverage.topIncidentZones.map((z)=>`${z.name} (${z.incidents})`).join(' · ')}</p></article></div>
    </div>
  </section>`;
}
function currentImpactAssumptions(){ return { ...defaultImpactAssumptions, fuelPrice: Number($('#fuelPrice')?.value ?? defaultImpactAssumptions.fuelPrice), fuelEfficiency: Number($('#fuelEfficiency')?.value ?? defaultImpactAssumptions.fuelEfficiency), operatingDays: Number($('#operatingDays')?.value ?? defaultImpactAssumptions.operatingDays), hourlyCost: Number($('#hourlyCost')?.value ?? defaultImpactAssumptions.hourlyCost), minutesPerStop: Number($('#minutesPerStop')?.value ?? defaultImpactAssumptions.minutesPerStop), avgSpeedKmh: Number($('#avgSpeedKmh')?.value ?? defaultImpactAssumptions.avgSpeedKmh) }; }
function currentImpactFilters(){ return { sector: $('#impactSector')?.value || '', route: $('#impactRoute')?.value || '', vehicle: $('#impactVehicle')?.value || '', status: $('#impactStatus')?.value || '', period: $('#impactPeriod')?.value || 'Hoy' }; }
function renderImpactEconomics(m){return `<h3>Impacto económico estimado</h3><p><b>${num(m.efficiency.fuelSavedLiters,' L')}</b> combustible potencialmente optimizado.</p><p><b>${money(m.economics.monthlyPotentialAvoided)}</b> costo mensual potencialmente evitado.</p><p><b>${money(m.economics.annualProjectionDemo)}</b> proyección anual demo.</p><p><b>${num(m.efficiency.avoidedKm,' km')}</b> kilómetros potencialmente evitados · <b>${num(m.efficiency.optimizedHours,' h')}</b> horas operativas potencialmente optimizadas.</p><p><b>${money(m.economics.incidentCostAvoided)}</b> costo potencial por incidencias evitadas con supuesto configurable válido.</p><p class="demo">Ahorro potencial estimado; no es ahorro garantizado ni resultado real.</p>`}
function renderImpactBars(m){return [...m.coverage.bySector.map((s)=>`${s.name} cobertura ${s.coverage}% ${bar(s.coverage)}`),`Cumplimiento rutas ${m.routes.complianceRate}% ${bar(m.routes.complianceRate)}`,`Estado flota activa ${m.fleet.availabilityRate}% ${bar(m.fleet.availabilityRate)}`,`Kilómetros productivos ${m.operation.productiveKm}/${m.operation.distanceKm} ${bar(m.operation.productiveKm,m.operation.distanceKm)}`,`Combustible optimizado ${m.efficiency.fuelSavedLiters} L ${bar(m.efficiency.fuelSavedLiters,3)}`,`Ahorro mensual/anual ${money(m.economics.monthlyPotentialAvoided)} / ${money(m.economics.annualProjectionDemo)} ${bar(m.economics.monthlyPotentialAvoided,m.economics.annualProjectionDemo/6)}`].map(x=>`<p>${x}</p>`).join('')}
function renderBeforeAfter(m){return `<div class="comparison-table">${m.beforeAfter.map((r)=>`<p><b>${r.label}</b><span>Antes: ${r.before} ${r.unit} · SmartWaste: ${r.after} ${r.unit}</span><small>Diferencia: ${r.absolute} ${r.unit} · variación: ${r.variation}%${r.reduction!==null?` · reducción: ${r.reduction}%`:''}${r.points!==null?` · ${r.points} puntos porcentuales`:''}</small></p>`).join('')}</div>`}

function renderMaster() { return `<section id="master" class="section card"><h2>Master Admin MT IT Services</h2><p class="demo">${demoNotice}</p><div class="panel-grid">${municipalities.map((m) => `<article class="card"><h3>${m.name}</h3><p>Plan: ${m.plan}</p><p>Camiones: ${m.trucks} · Rutas: ${m.routes} · Usuarios: ${m.users}</p>${pill(m.status.toLowerCase().includes('operativo') ? 'active' : 'assigned')}<button class="btn-primary" data-onboarding="${m.id}">Onboarding demo</button><p class="demo" data-onboarding-status="${m.id}"></p></article>`).join('')}</div><h3>Arquitectura futura</h3><p>${pilotMunicipality.integrationsReady.join(' · ')}</p></section>`; }

// SW-049 (roadmap SW-048's opción E, evaluada y confirmada con el Project Owner): preferencia de
// operador, no un dato del municipio — se guarda en localStorage del navegador, no en Supabase, así
// que cada despachador la elige para su propio equipo sin afectar a los demás. Apagada por defecto:
// sin tocar esto, el flujo de asignación de ruta se comporta exactamente igual que en SW-048.
function renderConfiguracion() {
  return `<section id="configuracion" class="section card"><h2>Configuración</h2><p class="demo">${demoNotice} · Preferencias de este navegador/operador, no del municipio.</p>
    <div class="controls"><label><input type="checkbox" id="guidedAssignmentToggle"${guidedAssignmentEnabled ? ' checked' : ''}> Activar flujo guiado "Poner en marcha" en el detalle de ruta</label></div>
    <p class="demo">Con esta opción activa, el detalle de una ruta sin vehículo o sin chofer muestra un solo formulario y un solo botón para asignar todo lo que falte e iniciarla de una vez, en vez de los pasos separados (asignar vehículo, luego asignar chofer, luego iniciar).</p></section>`;
}

app.innerHTML = `${renderSummary()}${renderOperations()}${renderSupervisor()}${renderDriverSection()}${renderCitizen()}${renderImpactCenter()}${renderConfiguracion()}${renderMaster()}`;

// initMap() and initDriverMap() both call this at page load, before window.L exists yet — without
// caching the in-flight promise, the second call would inject a second <script> tag, and whichever
// one resolves last silently replaces window.L out from under the map already built with the first
// instance (Leaflet ID collisions, layers detached from the visible map). Cache it so every caller
// awaits the same load.
let leafletLoadPromise = null;
function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.append(css);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.onload = () => resolve(window.L); script.onerror = reject; document.head.append(script);
  }).catch((error) => { leafletLoadPromise = null; throw error; }); // allow a retry later instead of caching a permanent failure
  return leafletLoadPromise;
}
function initMap() {
  loadLeaflet().then((L) => {
    mapReady = true;
    map = L.map('realMap', { zoomControl: true }).setView(pilotMunicipality.center, pilotMunicipality.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    drawMapLayers(L);
  }).catch(() => $('#realMap').classList.add('fallback-active'));
}
// When a route is selected (selectRoute()), the map focuses on just that route — its own polyline/
// stops, its assigned truck, and only the incidents tied to it — instead of the whole fleet.
// Selecting a truck/incident or closing the detail drawer clears selectedRouteId (see
// selectTruck()/selectIncident()/closeDetail() below) and returns to showing everything.
function drawMapLayers(L = window.L) {
  if (!mapReady) return;
  [...routeLayers, ...truckMarkers, ...incidentMarkers].forEach((layer) => layer.remove()); routeLayers = []; truckMarkers = []; incidentMarkers = [];
  const focusRoute = selectedRouteId ? routeById(selectedRouteId) : null;
  const visibleRoutes = focusRoute ? [focusRoute] : routes;
  const visibleTrucks = focusRoute ? trucks.filter((truck) => truck.routeId === focusRoute.id) : trucks;
  const visibleIncidents = focusRoute ? incidents.filter((incident) => focusRoute.incidents.includes(incident.code)) : incidents;
  visibleRoutes.forEach((route) => {
    const path = routeGeometry(route.id); const cut = Math.max(1, Math.round((path.length - 1) * (route.progress / 100)));
    routeLayers.push(L.polyline(path.slice(0, cut + 1), { color: '#0f7b4f', weight: 7, opacity: .9 }).addTo(map));
    routeLayers.push(L.polyline(path.slice(cut), { color: '#155eef', weight: 6, opacity: .45, dashArray: '8 10' }).addTo(map).on('click', () => selectRoute(route.id)));
    routeLayers.push(...path.map((point, index) => L.circleMarker(point, { radius: index <= cut ? 5 : 4, color: index <= cut ? '#0f7b4f' : '#155eef', fillOpacity: .85 }).addTo(map)));
  });
  let focusTruckPosition = null;
  visibleTrucks.forEach((truck) => {
    // SW-036: a fresh real GPS position (polled from vehicle_positions, see fetchRealPositions())
    // wins over the simulation entirely — bypasses simState/positionIndex, same "explicit position
    // beats derived one" priority routePosition() already gives truck.position. Stale (past
    // REAL_GPS_FRESHNESS_MS) or missing real data falls straight back to today's simulated path,
    // zero behavior change for every truck without real GPS active.
    const real = truck.real_id ? realPositions[truck.real_id] : null;
    const isFreshReal = Boolean(real && (Date.now() - real.capturedAt) < REAL_GPS_FRESHNESS_MS);
    const markerPosition = isFreshReal ? [real.latitude, real.longitude] : routePosition({ ...truck, positionIndex: simState[truck.id]?.index ?? truck.positionIndex });
    const marker = L.marker(markerPosition, { icon: L.divIcon({ className: 'leaflet-truck', html: truckIcon(truck, isFreshReal), iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map).on('click', () => selectTruck(truck.id));
    truckMarkers.push(marker);
    if (focusRoute) focusTruckPosition = markerPosition;
  });
  visibleIncidents.forEach((incident) => { incidentMarkers.push(L.marker(incident.position, { icon: L.divIcon({ className: 'leaflet-incident', html: `<span>⚠<small>${incident.type}</small></span>`, iconSize: [90, 34] }) }).addTo(map).on('click', () => selectIncident(incident.code))); });
  // SW-043: keep the truck centered while a single route is focused, instead of re-fitting the
  // whole route's bounds on every redraw (which recenters on the path's static bounding box, not
  // where the truck actually is — most of a route's length is usually still ahead of it). fitBounds
  // once when a route is FIRST focused (so the initial zoom level shows the entire trajectory), then
  // panTo() the truck's live position on every subsequent redraw at that same zoom level — this
  // runs on every drawMapLayers() call, including the GPS polling tick (fetchRealPositions()), so a
  // real vehicle's marker stays centered as new positions arrive.
  if (focusRoute) {
    if (mapFocusRouteId !== focusRoute.id) { map.fitBounds(routeGeometry(focusRoute.id), { padding: [40, 40] }); mapFocusRouteId = focusRoute.id; }
    else if (focusTruckPosition) map.panTo(focusTruckPosition, { animate: true });
  } else {
    mapFocusRouteId = null;
  }
}

// Fullscreens #realMap itself (not the whole map-card), so the header/KPIs/detail drawer step
// aside and just the map fills the screen. Standard Fullscreen API — no library.
function toggleMapFullscreen() {
  const el = $('#realMap');
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.();
}
// Entering/exiting fullscreen resizes #realMap's actual pixel dimensions, which Leaflet doesn't
// pick up on its own — invalidateSize() makes it recalculate and re-tile correctly either way.
document.addEventListener('fullscreenchange', () => {
  if (mapReady) requestAnimationFrame(() => map.invalidateSize());
  const button = document.querySelector('[data-sim="fullscreen"]');
  if (button) button.textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
});

function initDriverMap() {
  loadLeaflet().then((L) => {
    driverMapReady = true;
    driverMap = L.map('driverMap', { zoomControl: false, attributionControl: false }).setView(pilotMunicipality.center, pilotMunicipality.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(driverMap);
    drawDriverPositions();
  }).catch(() => { const el = $('#driverMap'); if (el) { el.classList.add('fallback-active'); el.innerHTML = '<div class="map-fallback"><strong>Mapa externo no disponible.</strong></div>'; } });
}
// Reads positionHistory (the demo stand-in for a `select * from vehicle_positions where
// vehicle_id=$1 order by captured_at` query) and redraws: planned route as a base line, the
// traveled trail as a solid line, and the most recent point as a distinct marker. Called on every
// poll tick and immediately on vehicle switch — cheap enough (a handful of points) to just redraw
// everything each time, same approach drawMapLayers() already uses for the main operational map.
function drawDriverPositions() {
  if (!driverMapReady) return;
  const L = window.L;
  const truck = trucks.find((item) => item.id === driverVehicleId);
  if (!truck?.routeId) return;
  // Keep the route/status text current on every poll, not just when the vehicle selector changes —
  // startSimulation() (the main operational map's simulation) mutates truck.progress/state on its
  // own timer, so a driver who stays on one vehicle would otherwise keep seeing a stale percentage.
  const routeInfo = $('#driverRouteInfo');
  if (routeInfo) routeInfo.innerHTML = `${pill(truck.state)} ${routeName(truck.routeId)} · ${truck.progress}% completado`;
  const startRouteControl = $('#driverRouteLifecycleControl');
  if (startRouteControl) startRouteControl.innerHTML = driverRouteLifecycleControl(truck);
  if (driverPlannedLayer) driverPlannedLayer.remove();
  driverPlannedLayer = L.polyline(routeGeometry(truck.routeId), { color: '#94a3b8', weight: 4, opacity: .6, dashArray: '6 8' }).addTo(driverMap);

  const history = positionHistory.listPositions(driverVehicleId);
  const trail = history.map((point) => [point.latitude, point.longitude]);
  if (driverTrailLayer) driverTrailLayer.remove();
  driverTrailLayer = trail.length > 1 ? L.polyline(trail, { color: '#0f7b4f', weight: 5, opacity: .9 }).addTo(driverMap) : null;

  // SW-026: route_stops seeded at load time (top of this file) rendered as markers colored by
  // deriveStopStatus() against this same recorded trail (`history`, above) — no separate query or
  // refresh mechanism, reuses the polling this function is already called from.
  if (driverStopsLayer) driverStopsLayer.remove();
  const stopsWithStatus = operationsAdapter.listRouteStops(truck.routeId).map((stop) => ({ ...stop, status: deriveStopStatus(stop, history) }));
  driverStopsLayer = L.layerGroup(stopsWithStatus.map((stop) => L.circleMarker([stop.latitude, stop.longitude], {
    radius: 5,
    weight: 2,
    color: stop.status === 'recolectado' ? '#0f7b4f' : '#f59e0b',
    fillColor: stop.status === 'recolectado' ? '#0f7b4f' : '#f59e0b',
    fillOpacity: .85
  }).bindTooltip(`${stop.label} · ${stop.status}`))).addTo(driverMap);
  const stopsProgress = $('#driverStopsProgress');
  if (stopsProgress) {
    const collected = stopsWithStatus.filter((stop) => stop.status === 'recolectado').length;
    stopsProgress.textContent = stopsWithStatus.length ? `${collected}/${stopsWithStatus.length} recolectados` : '';
  }

  if (driverCurrentMarker) driverCurrentMarker.remove();
  const last = history[history.length - 1];
  if (last) {
    driverCurrentMarker = L.circleMarker([last.latitude, last.longitude], { radius: 9, color: '#155eef', weight: 3, fillColor: '#155eef', fillOpacity: .9 }).addTo(driverMap);
    driverMap.panTo([last.latitude, last.longitude]);
  }
}
function startDriverPolling() { if (driverPollTimer) return; drawDriverPositions(); driverPollTimer = setInterval(drawDriverPositions, DRIVER_POLL_INTERVAL_MS); }
function stopDriverPolling() { clearInterval(driverPollTimer); driverPollTimer = null; }
// Every section is always in the DOM (single scrolling page, nav links just jump to an anchor —
// see frontend/index.html), so "navigate away from the view" means scrolled out of the viewport,
// not unmounted. IntersectionObserver starts/stops polling accordingly, so it doesn't run forever
// in the background once the driver never scrolls back to it.
function initDriverPolling() {
  const target = $('#driverMobile');
  if (!target) return;
  if (!('IntersectionObserver' in window)) { startDriverPolling(); return; }
  new IntersectionObserver((entries) => entries.forEach((entry) => (entry.isIntersecting ? startDriverPolling() : stopDriverPolling())), { threshold: .15 }).observe(target);
}
// SW-036: same start/stop/visibility-gated pattern as startDriverPolling()/stopDriverPolling()/
// initDriverPolling() just above, for the dispatcher's real-GPS overlay on the Operations map
// instead of the driver's own view. fetchRealPositions() is a safe no-op until realAdapter exists
// (Supabase configured and bootstrapRealBackend() resolved) — same guard every other real-adapter
// call in this file already uses, so this can start unconditionally at module init.
async function fetchRealPositions() {
  if (!realAdapter) return;
  const result = await realAdapter.listLatestPositions();
  if (result.ok) {
    const next = {};
    result.data.forEach((row) => { next[row.vehicle_id] = { latitude: row.latitude, longitude: row.longitude, capturedAt: new Date(row.captured_at).getTime() }; });
    realPositions = next;
  }
  // Codex review on PR #52: freshness (REAL_GPS_FRESHNESS_MS) is only evaluated inside
  // drawMapLayers() itself — an already-rendered real-GPS marker never "ages out" on its own, it
  // only does so the next time it's redrawn. Redraw on every poll tick regardless of success/
  // failure (never blocks/breaks the map either way — rule 5), so a sustained Supabase outage
  // doesn't leave a stale position on screen still flagged as live GPS forever.
  if (mapReady) drawMapLayers();
}
function startOpsGpsPolling() { if (opsGpsPollTimer) return; fetchRealPositions(); opsGpsPollTimer = setInterval(fetchRealPositions, OPS_GPS_POLL_INTERVAL_MS); }
function stopOpsGpsPolling() { clearInterval(opsGpsPollTimer); opsGpsPollTimer = null; }
function initOpsGpsPolling() {
  const target = document.querySelector('[data-ops-view="mapa"]');
  if (!target) return;
  if (!('IntersectionObserver' in window)) { startOpsGpsPolling(); return; }
  new IntersectionObserver((entries) => entries.forEach((entry) => (entry.isIntersecting ? startOpsGpsPolling() : stopOpsGpsPolling())), { threshold: .15 }).observe(target);
}

// SW-027: registers a truck the driver view didn't know about at page load (one just assigned to a
// newly created route) — same DeviceSimulator/positionHistory machinery every other truck already
// goes through, just triggered later instead of at module load.
function registerDriverSimulator(truck) {
  if (driverSimulators[truck.id]) return;
  const simulator = new DeviceSimulator(truck.id, { getPath: () => routeGeometry(truck.routeId) });
  simulator.index = truck.positionIndex ?? 0;
  driverSimulators[truck.id] = simulator;
  if (!trucksWithRoute.some((item) => item.id === truck.id)) trucksWithRoute.push(truck);
  // SW-044: driverVehicleId is only ever picked once, at module init (line ~143) — with
  // SUPABASE_HIDE_DEMO=true or a real municipality starting empty, trucks is [] at that point, so
  // it starts out null. Nothing set it afterward when the first real vehicle-with-a-route showed
  // up: the <select> below re-renders with a real option and the browser defaults to showing it
  // (a <select> always visually shows its first option when none has the `selected` attribute),
  // but driverVehicleId itself stayed null — renderDriverMobile()'s trucks.find(...) then failed
  // to match, showing "Sin vehículo real asignado todavía." for a vehicle that was right there in
  // the dropdown. Only defaults when nothing is currently selected — never overrides an existing
  // (possibly user-chosen) selection.
  if (!driverVehicleId) driverVehicleId = truck.id;
  positionHistory.record(simulator.start());
  const select = $('#driverVehicleSelect');
  if (select) select.innerHTML = trucksWithRoute.map((item) => `<option value="${item.id}" ${item.id === driverVehicleId ? 'selected' : ''}>${item.unit}</option>`).join('');
  const routeInfo = $('#driverRouteInfo');
  if (routeInfo && driverVehicleId === truck.id) routeInfo.innerHTML = `${pill(truck.state)} ${routeName(truck.routeId)} · ${truck.progress}% completado`;
  const lifecycleControl = $('#driverRouteLifecycleControl');
  if (lifecycleControl && driverVehicleId === truck.id) lifecycleControl.innerHTML = driverRouteLifecycleControl(truck);
}
// Single place that assigns a vehicle to a route — used both by finishCreateRoute() (assignment at
// creation time) and assignVehicleToExistingRoute() (below, for a route created without one). Fixes
// a real bug found while adding the latter: route.truckId was never actually set on assignment
// (only truck.routeId was), so the detail panel always showed "Sin asignar" even for routes
// assigned at creation.
async function assignTruckToRoute(route, truck) {
  // Guard added alongside SW-042/044's equivalent fixes: operationsAdapter's own internal demo
  // state (a clone taken at module init) never learns about a route hydrated from Supabase after a
  // page reload — calling operationsAdapter.assignVehicle() for one throws "Route not found"
  // synchronously, uncaught here, silently killing this whole async function with nothing visible
  // to the user ("Asignar vehículo" does nothing). Same as assignDriverToTruck()/
  // startRouteManually()/completeRouteManually() already do.
  if (!route.real_id) operationsAdapter.assignVehicle(route.id, truck.id);
  route.truckId = truck.unit;
  // SW-052: real routes repeat 2-3x/week with the same vehicle — the backend already opens a
  // brand-new route_run when one gets (re)assigned after the previous one finished
  // (findOrCreateActiveRouteRun, shared/operations-adapter.js), but this local route object only
  // ever advanced status forward (planned->assigned) and never reset when reassigning a vehicle to
  // an already-completed/verified route. Left alone, the UI kept showing the OLD corrida's
  // status/timing forever — no "Iniciar ruta" button, stale medido duration/distance — even though
  // a fresh route_run was correctly waiting server-side. Clearing these local fields is what makes
  // this read as a new corrida instead of a permanently "done" route.
  const isRepeat = route.status === 'completed' || route.status === 'verified';
  if (route.status === 'planned' || isRepeat) route.status = 'assigned';
  if (isRepeat) {
    route.started_at = undefined;
    route.completed_at = undefined;
    route.real_distance_meters = undefined;
    route.progress = 0;
  }
  truck.routeId = route.id; truck.state = 'active'; truck.positionIndex = 0; truck.progress = 0; truck.sector = route.sector ?? truck.sector; truck.updatedAt = 'Recién asignado';
  simState[truck.id] = { index: 0, progress: 0 };
  registerDriverSimulator(truck);
  if (truck.real_id) {
    const realRouteId = route.real_id ?? route.id;
    await mirrorToRealAdapter(realAdapter?.assignVehicle(realRouteId, truck.real_id));
  }
}
// Triggered from renderRouteDetail()'s "Asignar vehículo" action (route created without one).
async function assignVehicleToExistingRoute(routeId, vehicleId) {
  const route = routeById(routeId);
  const truck = trucks.find((item) => item.id === vehicleId);
  if (!route || !truck) return;
  await assignTruckToRoute(route, truck);
  showToast(`${truck.unit} asignado a "${route.name}".`);
  selectRoute(routeId); // re-render the detail panel so it reflects the new assignment immediately
  $('#routeList').innerHTML = renderRoutes(routes);
  refreshFleetSelects();
  // Codex review on PR #49: #resumen's counts (rutas activas, vehículos fuera de servicio) are a
  // snapshot taken at page load — without this they'd stay stale after every mutation that changes
  // them, same reason completeRouteManually()/the verify/resolve-incident handlers below already
  // re-render #supervisor on demand.
  refreshResumen();
}
// SW-049: the guided-mode form shown in renderRouteDetail() when the operator opted in from
// Configuración. Renders a single form covering whatever's actually missing (vehicle+driver, or
// just driver) instead of the two separate step-by-step controls (assignAction/driverAssignAction).
function renderGuidedPutInMotion(route, assignedTruck, stage) {
  if (stage === 'needs_vehicle') {
    const availableTrucks = trucks.filter(isTruckAvailable);
    if (!availableTrucks.length) return '<p class="demo">No hay vehículos disponibles para asignar — <a href="#operaciones/flota" data-scroll-to="fleetManagement">registra uno en Operaciones · Flota</a>.</p>';
    // Candidate drivers can't be filtered by the chosen vehicle's real_id yet (nothing is chosen
    // until the operator picks one) — same real-vs-demo kind filter driverAssignmentControl() uses,
    // applied against the route itself instead of a truck.
    const candidateDrivers = drivers.filter((driver) => Boolean(driver.real_id) === Boolean(route.real_id));
    if (!candidateDrivers.length) return '<p class="demo">No hay choferes disponibles para asignar — <a href="#operaciones/flota" data-scroll-to="fleetManagement">registra uno en Operaciones · Flota</a>.</p>';
    return `<div class="controls"><select id="guidedVehicleSelect">${availableTrucks.map((truck) => `<option value="${truck.id}">${truck.unit}</option>`).join('')}</select><select id="guidedDriverSelect">${candidateDrivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join('')}</select><button type="button" class="btn-primary" data-guided-start="${route.id}">Poner en marcha</button></div>
      <p class="demo">Modo guiado (Configuración): asigna vehículo, chofer e inicia la ruta en un solo paso.</p>`;
  }
  if (stage === 'needs_driver' && assignedTruck) {
    const candidateDrivers = drivers.filter((driver) => Boolean(driver.real_id) === Boolean(assignedTruck.real_id));
    if (!candidateDrivers.length) return '<p class="demo">No hay choferes disponibles para asignar.</p>';
    return `<div class="controls"><select id="guidedDriverSelect">${candidateDrivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join('')}</select><button type="button" class="btn-primary" data-guided-start="${route.id}">Poner en marcha</button></div>
      <p class="demo">Modo guiado (Configuración): asigna chofer e inicia la ruta en un solo paso.</p>`;
  }
  return '';
}
// SW-049: reads both selects' values BEFORE any await — each awaited step below (assignVehicleTo
// ExistingRoute/assignDriverToTruck) re-renders this exact detail panel via selectRoute(), which
// destroys and rebuilds #guidedVehicleSelect/#guidedDriverSelect with a different candidate list
// (or removes them entirely once no longer needed) — reading them after the first await would read
// a stale or missing element instead of the operator's actual choice.
async function putRouteInMotion(routeId) {
  const route = routeById(routeId);
  if (!route) return;
  const vehicleId = $('#guidedVehicleSelect')?.value ?? null;
  const driverId = $('#guidedDriverSelect')?.value ?? null;
  let truck = trucks.find((item) => item.routeId === routeId);
  if (!truck) {
    if (!vehicleId) return;
    await assignVehicleToExistingRoute(routeId, vehicleId);
    truck = trucks.find((item) => item.routeId === routeId);
  }
  if (!truck) return; // assignment failed upstream — nothing left to chain
  if (!truck.driverId) {
    if (!driverId) return;
    await assignDriverToTruck(truck.id, driverId);
  }
  const refreshedRoute = routeById(routeId);
  if (refreshedRoute?.status === 'assigned') await startRouteManually(routeId);
}
// Triggered from renderTruckDetail()'s "Asignar chofer"/"Reasignar chofer" action (SW-042). Unlike
// assignTruckToRoute() above, this never calls operationsAdapter.assignDriverToVehicle() for a
// real/hydrated truck: operationsAdapter's own internal demo state (a clone taken at module init,
// see shared/operations-adapter.js) never learns about vehicles hydrated from Supabase, so looking
// one up there would throw "Vehicle not found" — the local write for a real truck is just this
// function's own trucks[]/drivers[] mutation below, mirrored to Supabase separately.
async function assignDriverToTruck(vehicleId, driverId) {
  const truck = trucks.find((item) => item.id === vehicleId);
  const driver = drivers.find((item) => item.id === driverId);
  if (!truck || !driver) return;
  if (truck.real_id) {
    // SW-055: a real truck paired with a driver that hasn't finished syncing (no real_id yet) used
    // to silently skip the actual Supabase write here — the local assignment below would still look
    // successful forever. Now says so instead of looking identical to a real success.
    if (driver.real_id) { await mirrorToRealAdapter(realAdapter?.assignDriverToVehicle(truck.real_id, driver.real_id)); showToast(`${driver.name} asignado a ${truck.unit}.`); }
    else showToast(`"${driver.name}" todavía no terminó de sincronizarse — la asignación quedó solo local, no en el servidor.`, { type: 'error' });
  } else {
    operationsAdapter.assignDriverToVehicle(truck.id, driver.id);
    showToast(`${driver.name} asignado a ${truck.unit}.`);
  }
  // A driver drives one truck at a time — clear them from wherever they were assigned before,
  // same constraint shared/operations-adapter.js's assignDriverToVehicle() enforces server-side.
  trucks.forEach((item) => { if (item.driverId === driver.id) item.driverId = null; });
  truck.driverId = driver.id;
  // SW-048: this is now also reachable from renderRouteDetail()'s embedded driverAssignAction —
  // re-render whichever detail panel is actually open (route or truck) instead of always jumping
  // to the truck's own panel, so assigning a driver from a route's detail keeps the dispatcher on
  // that route instead of yanking them over to Flota.
  if (selectedRouteId) selectRoute(selectedRouteId); else selectTruck(vehicleId);
  refreshFleetSelects();
}
// Triggered from renderRouteDetail()'s "Reoptimizar ruta" action (roadmap item 4, "reoptimización
// dinámica" — suggestion only, docs/TECHNICAL_DEBT_REGISTER.md #21). Computes and displays a
// suggested new order for the route's still-pending stops from the truck's current position; never
// writes to route_stops/route_paths. "Pending" is approximated as the tail of the sequence-ordered
// stop list beyond route.progress% — route.covered/route.pending are static counts never updated
// by the simulation tick, so they can't be used to know which stops are actually done.
function previewRouteReoptimization(routeId) {
  const route = routeById(routeId);
  const truck = trucks.find((item) => item.routeId === routeId);
  if (!route || !truck) return;
  // Codex review on PR #46: this used to approximate "pending" as the tail of the sequence-ordered
  // stop list beyond route.progress% — route.progress can disagree with which stops were actually
  // collected, so that slice could exclude uncollected stops or include already-collected ones.
  // Use the same real per-stop status the driver view already derives (drawDriverPositions(),
  // above) from positionHistory/deriveStopStatus() instead — populated for every truck with a
  // route (registerDriverSimulator(), called both at module init and for hydrated real routes),
  // not just the one currently shown in the driver view.
  const trail = positionHistory.listPositions(truck.id);
  // Codex review on PR #47: for a Supabase-hydrated route, hydrateRoutes() (above) already knows
  // the real per-stop status at hydration time (via listRouteStopsWithStatus()) but the trail it
  // seeds afterward is only a synthetic single point — deriving purely from that trail would forget
  // every collection recorded before this page loaded. hydrateRoutes() now also persists that
  // status onto the seeded stop (see its saveRouteStops() call), so treat 'recolectado' from either
  // source as authoritative — a stop already known collected must never be un-collected here.
  const stops = operationsAdapter.listRouteStops(routeId).map((stop) => {
    const derivedStatus = deriveStopStatus(stop, trail);
    const status = stop.status === 'recolectado' || derivedStatus === 'recolectado' ? 'recolectado' : 'pendiente';
    return { ...stop, status };
  });
  const pendingStops = stops.filter((stop) => stop.status !== 'recolectado');
  // Codex review on PR #47: this used to derive the truck's current position from simState (only
  // advanced while the map simulation is running), while pending stops above are derived from
  // positionHistory (advanced independently every 4s by tickDriverTelemetry()) — the two could
  // disagree about how far along the truck actually is. Anchor the optimization's starting point to
  // the same trail used for stop status, falling back to the simState-based position only when no
  // trail exists yet (e.g. a route just assigned, nothing emitted).
  const lastTrailPoint = trail[trail.length - 1];
  // Same pattern drawMapLayers() (above) uses for a truck's live marker position — truck.positionIndex
  // itself is never updated by the simulation tick, only simState[truck.id].index is.
  const currentPosition = lastTrailPoint
    ? [lastTrailPoint.latitude, lastTrailPoint.longitude]
    : routePosition({ ...truck, positionIndex: simState[truck.id]?.index ?? truck.positionIndex });
  routeReoptimizationPreview = { routeId, ...suggestReoptimizedOrder(currentPosition, pendingStops) };
  selectRoute(routeId);
}
// Triggered from renderRouteDetail()'s "Marcar como completada" action — startSimulation()'s tick
// caps progress at 99 (Math.min(99, ...)), so nothing else ever transitions a route to 'completed';
// without this, a route could run in the demo forever and never reach Supervisor's verification
// queue (renderSupervisor()'s pendingVerification list, gated on status === 'completed').
// SW-044: "Iniciar ruta" — previously nothing in the UI ever called operationsAdapter.startRoute()/
// realAdapter.startRoute() at all; a route jumped straight from "asignada" a "completada" sin
// ningún momento de arranque capturado, así que la duración nunca se podía medir (solo estimar por
// fórmula, ver shared/impact-center.js). Reachable both from the route detail panel (admin/
// dispatcher, renderRouteDetail() below) and from the driver's own Conductor view
// (startAssignedRoute(), further down) — either can start it, matching how either can already
// complete it (completeRouteManually()). Guards the operationsAdapter call by !route.real_id — a
// gap found while building SW-042: operationsAdapter's own internal demo state never learns about
// a route hydrated from Supabase, so calling it for one throws "Route not found"; only safe to call
// for a route this session actually created locally (no real_id yet, or a pure demo route).
async function startRouteManually(routeId) {
  const route = routeById(routeId);
  if (!route) return;
  if (!route.real_id) operationsAdapter.startRoute(routeId);
  route.status = 'started';
  if (!route.started_at) route.started_at = new Date().toISOString();
  showToast(`Ruta "${route.name}" iniciada.`);
  // Only re-opens the route detail drawer if it's already showing this route (admin/dispatcher
  // clicking "Iniciar ruta" there) — this is also reachable from the driver's own Conductor view
  // (driverRouteLifecycleControl(), via driverStartRoute() below), which must NOT get yanked into
  // the operations detail panel just because the chofer started their own route.
  if (selectedRouteId === routeId) selectRoute(routeId);
  const driverTruck = trucks.find((item) => item.id === driverVehicleId);
  const driverStartControl = $('#driverRouteLifecycleControl');
  if (driverStartControl && driverTruck?.routeId === routeId) driverStartControl.innerHTML = driverRouteLifecycleControl(driverTruck);
  $('#routeList').innerHTML = renderRoutes(routes);
  refreshResumen();
  if (realAdapter) {
    const realRouteId = route.real_id ?? routeId;
    const updated = await mirrorToRealAdapter(realAdapter.startRoute(realRouteId));
    if (!updated) showToast(`"${route.name}" se inició localmente, pero no se pudo confirmar con el servidor.`, { type: 'error' });
    if (updated?.started_at) route.started_at = updated.started_at; // el timestamp real gana sobre el sello local optimista
  }
}
// SW-044 (revisión tras pruebas en staging): ties the driver's own route lifecycle buttons
// (driverRouteLifecycleControl()) to their GPS sharing automatically — one tap to start the route
// AND start broadcasting position, one tap to finish AND stop. Confirmed with the Project Owner as
// the primary workflow. Deliberately NOT reused by admin/dispatcher's plain [data-start-route]/
// [data-complete-route] buttons in renderRouteDetail() — those are a GPS-free backup path and must
// never toggle another person's (the driver's) GPS sharing state.
async function driverStartRoute(routeId) {
  await startRouteManually(routeId);
  await startDriverGps();
}
async function driverCompleteRoute(routeId) {
  await completeRouteManually(routeId);
  stopDriverGps();
}
async function completeRouteManually(routeId) {
  const route = routeById(routeId);
  if (!route) return;
  route.status = 'completed'; route.progress = 100;
  // SW-044: only stamps if this route was actually started via startRouteManually() above —
  // completing without starting first stays possible (unchanged from before this hito, e.g.
  // skipping straight to "Completar"), it just means no measured duration, same as any demo route.
  if (route.started_at && !route.completed_at) route.completed_at = new Date().toISOString();
  // SW-055 (encontrado en vivo verificando el toast de esta misma ruta): faltaba el mismo guard que
  // ya tienen startRouteManually()/assignTruckToRoute() — operationsAdapter (el clon demo, que nunca
  // aprende sobre una ruta real hidratada) tiraba "Route not found" sin capturar, matando el resto de
  // esta función en silencio para CUALQUIER ruta real: nunca llegaba a escribir en Supabase, nunca
  // mostraba el aviso nuevo. El dato local (route.completed_at arriba) sí quedaba puesto, por eso la
  // pantalla mostraba "medido" aunque el servidor nunca se enterara — la causa real detrás de lo que
  // SW-053 solo corrigió a medias.
  if (!route.real_id) operationsAdapter.completeRoute(routeId);
  const truck = trucks.find((item) => item.routeId === routeId);
  if (truck) { truck.state = 'completed'; truck.progress = 100; }
  // SW-055: found repeatedly in staging — completing a route silently frees its vehicle
  // (isTruckAvailable() already treats a completed/verified route's truck as available again,
  // SW-044) but nothing ever said so, which is exactly what read as "los choferes no se liberan."
  showToast(truck ? `Ruta "${route.name}" completada — ${truck.unit} ya está disponible para asignar.` : `Ruta "${route.name}" completada.`);
  // SW-044: same guard as startRouteManually() — this is now also reachable from the driver's own
  // Conductor view (driverCompleteRoute() below), which must not get yanked into the operations
  // detail panel just because the chofer finished their own route.
  if (selectedRouteId === routeId) selectRoute(routeId);
  const driverTruck = trucks.find((item) => item.id === driverVehicleId);
  const driverLifecycleControl = $('#driverRouteLifecycleControl');
  if (driverLifecycleControl && driverTruck?.routeId === routeId) driverLifecycleControl.innerHTML = driverRouteLifecycleControl(driverTruck);
  $('#routeList').innerHTML = renderRoutes(routes);
  // Supervisor's "pendientes de verificación" queue is only re-rendered on demand (same as the
  // existing verify/resolve-incident handlers do) — without this it stays stale showing whatever
  // was true when #supervisor was last rendered, even though route.status just changed above.
  refreshSupervisor();
  refreshResumen();
  if (realAdapter) {
    const realRouteId = route.real_id ?? routeId;
    const updated = await mirrorToRealAdapter(realAdapter.completeRoute(realRouteId));
    if (!updated) showToast(`"${route.name}" se completó localmente, pero no se pudo confirmar con el servidor.`, { type: 'error' });
    if (updated?.completed_at) route.completed_at = updated.completed_at; // el timestamp real gana sobre el sello local optimista
    // SW-045: distance_meters solo llega si hubo suficiente rastro de GPS real durante la corrida —
    // ausente para una ruta demo o una real sin GPS activo, y ahí se sigue mostrando la distancia
    // estimada del trazo dibujado (route.distanceKm), sin cambios.
    if (updated?.distance_meters != null) route.real_distance_meters = updated.distance_meters;
    // Bug real encontrado en staging: refreshRouteDurationHistory() (disparado desde selectRoute()
    // más arriba) corría ANTES de que esta escritura terminara, así que la consulta de histórico
    // llegaba a Supabase antes de que completed_at existiera — mostraba "medido" en la fila de
    // duración (dato local optimista) pero "sin corridas medidas" en el histórico (leído de la base
    // vieja) al mismo tiempo. Repetir la consulta acá, ya con la escritura confirmada, corrige eso.
    if (selectedRouteId === routeId) refreshRouteDurationHistory(routeId);
  }
}
// SW-039 audit: Supervisor's "Verificar" button used to only set route.status directly — it never
// even called the demo adapter's own verifyRoute(), let alone mirrored to a real backend, unlike
// every other route-status transition in this file (assignTruckToRoute()/completeRouteManually()
// above). Follows the exact same demo-then-mirror pattern as completeRouteManually().
async function verifyRouteManually(routeId) {
  const route = routeById(routeId);
  if (!route) return;
  route.status = 'verified';
  // SW-055: same missing guard just found/fixed in completeRouteManually() — operationsAdapter (demo
  // clone) throws "Route not found" uncaught for any real/hydrated route, silently killing the rest
  // of this function (refreshSupervisor/refreshResumen/the real mirror write below never ran).
  if (!route.real_id) operationsAdapter.verifyRoute(routeId);
  refreshSupervisor();
  refreshResumen();
  if (realAdapter) await mirrorToRealAdapter(realAdapter.verifyRoute(route.real_id ?? routeId));
  showToast(`Ruta "${route.name}" verificada.`);
}
// SW-058: unlike the demo `incidents` "Marcar resuelta" handler (pure local mutation, no adapter),
// a real citizen report has no demo/local mirror at all — there's only ever the real write. No
// optimistic local update here for that reason; the row is removed from realCitizenReports once
// the server confirms it, not before.
async function resolveCitizenReportManually(reportId) {
  if (!realAdapter) return;
  const report = realCitizenReports.find((item) => item.id === reportId);
  if (!report) return;
  const result = await realAdapter.updateCitizenReportStatus(reportId, 'resolved');
  if (!result.ok) { showToast(`No se pudo marcar el reporte "${report.folio}" como resuelto: ${result.error.message}`, { type: 'error' }); return; }
  realCitizenReports = realCitizenReports.filter((item) => item.id !== reportId);
  refreshSupervisor();
  showToast(`Reporte "${report.folio}" marcado como resuelto.`);
}

function initCreateRouteMap() {
  loadLeaflet().then((L) => {
    createRouteMapReady = true;
    createRouteMap = L.map('createRouteMap', { zoomControl: false, attributionControl: false }).setView(pilotMunicipality.center, pilotMunicipality.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(createRouteMap);
    // Free clicks only — no snapping to real streets/routing network, by design (out of scope).
    createRouteMap.on('click', (event) => { drawnRoutePoints.push([event.latlng.lat, event.latlng.lng]); redrawCreateRouteTrace(); });
  }).catch(() => { const el = $('#createRouteMap'); if (el) { el.classList.add('fallback-active'); el.innerHTML = '<div class="map-fallback"><strong>Mapa externo no disponible.</strong></div>'; } });
}
function redrawCreateRouteTrace() {
  if (!createRouteMapReady) return;
  const L = window.L;
  if (createRoutePolyline) createRoutePolyline.remove();
  createRoutePolyline = drawnRoutePoints.length > 1 ? L.polyline(drawnRoutePoints, { color: '#155eef', weight: 4 }).addTo(createRouteMap) : null;
  createRouteMarkers.forEach((marker) => marker.remove());
  createRouteMarkers = drawnRoutePoints.map((point, index) => L.circleMarker(point, { radius: 5, color: '#155eef', fillColor: '#155eef', fillOpacity: .9 }).bindTooltip(`Punto ${index + 1}`).addTo(createRouteMap));
  const status = $('#createRouteStatus');
  if (status) status.textContent = `${drawnRoutePoints.length} punto(s) trazado(s).`;
  // Codex review on PR #31: a saved route's trip preview stayed visible while a new draft was
  // already being traced (or failed validation) — clear it as soon as the trace changes so it
  // can't be mistaken for the new draft's breakdown.
  const tripPreview = $('#createRouteTripPreview');
  if (tripPreview) tripPreview.textContent = '';
}

// SW-029: tab navigation — only one top-level section visible at a time, switched by the existing
// #hash nav links (frontend/index.html), so a reload/shared link on a specific tab still lands on
// it. Each renderXxx() call at the top of this file already produces one <section> as a direct
// child of #app, in a fixed order (resumen, operaciones, supervisor, conductor, ciudadania, impacto,
// master) — no change needed there, this only toggles which one has the existing `.hidden` class.
// Fase 3 UX extends this one level deeper for #operaciones: its hash can carry a sub-vista
// (#operaciones/mapa, #operaciones/rutas, ...), so section matching only looks at the part before
// the first "/".
const SECTION_IDS = Array.from(app.children).map((section) => section.id);
// Codex review on PR #49: 'mapa' and 'municipal' used to be their own top-level sections — any
// bookmarked/shared URL ending in one of those hashes must keep landing on the equivalent content
// instead of silently falling back to 'resumen'. 'municipal' held Rutas/Flota/Incidencias together;
// 'rutas' (its first, most prominent list) is the closest single sub-vista to redirect to.
const LEGACY_HASH_REDIRECTS = { mapa: 'operaciones/mapa', municipal: 'operaciones/rutas' };
// Rewrites a legacy hash to its new home; returns true if it did (caller should stop, since setting
// location.hash fires its own hashchange that will re-enter this whole flow with the new hash).
function redirectLegacyHash() {
  const id = location.hash.slice(1).split('/')[0];
  if (!LEGACY_HASH_REDIRECTS[id]) return false;
  location.hash = LEGACY_HASH_REDIRECTS[id];
  return true;
}
function sectionFromHash() {
  const id = location.hash.slice(1).split('/')[0];
  return SECTION_IDS.includes(id) ? id : SECTION_IDS[0];
}
function currentOpsView() {
  const [id, view] = location.hash.slice(1).split('/');
  return id === 'operaciones' && OPS_VIEWS.includes(view) ? view : OPS_VIEWS[0];
}
function showOpsView(view) {
  document.querySelectorAll('#operaciones [data-ops-view]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.opsView !== view));
  document.querySelectorAll('#operaciones [data-ops-nav]').forEach((tab) => tab.classList.toggle('active', tab.dataset.opsNav === view));
  // Same invalidateSize() rationale as showSection() below — a Leaflet map built while its
  // container was display:none (i.e. its ops-panel wasn't the active sub-vista yet) reports zero
  // size until told to recalculate.
  if (view === 'mapa' && mapReady) requestAnimationFrame(() => map.invalidateSize());
  if (view === 'rutas' && createRouteMapReady) requestAnimationFrame(() => createRouteMap.invalidateSize());
  if (view === 'estadisticas') refreshEfficiencyDashboard();
}
function showSection(id) {
  Array.from(app.children).forEach((section) => section.classList.toggle('hidden', section.id !== id));
  document.querySelectorAll('.topbar nav a').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  if (id === 'operaciones') showOpsView(currentOpsView());
  if (id === 'conductor' && driverMapReady) requestAnimationFrame(() => driverMap.invalidateSize());
  // Codex review (PR #75, P2): re-fetches real citizen reports every time Supervisor is entered
  // (same "refetch on view entry" precedent as showOpsView()'s 'estadisticas' branch above) —
  // otherwise a report submitted after login bootstrap never appeared without a full page reload.
  // refreshCitizenReportsBlock() only patches its own div, never calls showSection() itself, so this
  // can't loop back into showSection('supervisor').
  if (id === 'supervisor') refreshCitizenReportsBlock();
}
window.addEventListener('hashchange', () => { if (!redirectLegacyHash()) showSection(sectionFromHash()); });
// SW-036 fix: an outerHTML replace swaps in a brand-new element that never had the 'hidden' class
// showSection() toggles on/off — every $('#resumen').outerHTML = renderSummary()/$('#supervisor')
// .outerHTML = renderSupervisor() call site (refresh-on-mutation, added for the PR #49 Codex
// review) was silently un-hiding that section on top of whatever tab the user was actually on,
// found while verifying SW-036's polling target visibility. showSection(sectionFromHash()) after
// the replace is idempotent — it just re-applies the correct hidden state for every section.
function refreshResumen() { $('#resumen').outerHTML = renderSummary(); showSection(sectionFromHash()); }
function refreshSupervisor() { $('#supervisor').outerHTML = renderSupervisor(); showSection(sectionFromHash()); }
// Selecting a truck/route/incident updates #detail and the map, but both live inside the "mapa"
// sub-vista of #operaciones — invisible while the click came from another tab/sub-vista (e.g. the
// route list in "rutas"). Jumping to "operaciones/mapa" on selection is what actually shows the
// user the result of their click. Only called from the real click handler below, never from
// selectTruck()/selectRoute()/selectIncident() themselves, since the simulation loop re-calls those
// every tick just to refresh the open detail panel — doing it there would yank the user back to the
// map every ~2s even after they navigate away.
function goToMapTab() {
  const target = 'operaciones/mapa';
  if (location.hash.slice(1) === target) showSection('operaciones');
  else location.hash = target;
}
function undoLastRoutePoint() { drawnRoutePoints.pop(); redrawCreateRouteTrace(); }
// (a) createRoute() for the metadata, (b) persist the drawn geometry (route_paths), (c)
// generateRouteStopPoints()/saveRouteStops() — the exact same SW-025/026 functions used for the
// bundled demo routes, not reimplemented — over the freshly drawn path, so the new route gets
// collection points automatically. savePathPoints() (SW-033: no longer a routePaths[routeId] = path
// runtime mutation) is what plugs the new route into DeviceSimulator/routePosition/drawMapLayers/
// drawDriverPositions: they all read geometry through routeGeometry() (module init, above), which
// doesn't otherwise know or care whether a route is one of the 5 bundled demo ones or hand-drawn.
// SW-028: matches the default in supabase/migrations/202607150008_sw025_vehicle_capacity.sql
// (vehicles.max_stops default 20) — demo trucks (shared/demo-data.js) have no max_stops field at
// all, so this is the fallback when computing the trip preview below for a demo vehicle.
const DEFAULT_MAX_STOPS = 20;
// Pure formatting, no persistence: splitIntoTrips()'s grouping is purely informational here (see
// docs/TECHNICAL_DEBT_REGISTER.md and the architecture decision already made for SW-025/026 —
// trips are NOT their own persisted concept; route_runs remains the natural extension for that once
// there's real dispatch). Never touches route_stops/route_paths.
function formatTripPreview(trips) {
  if (trips.length <= 1) return `1 viaje, ${trips[0]?.length ?? 0} parada(s).`;
  return trips.map((trip, index) => `Viaje ${index + 1}: paradas ${trip[0].sequence}-${trip[trip.length - 1].sequence}`).join(' · ');
}
async function finishCreateRoute() {
  const status = $('#createRouteStatus');
  const tripPreview = $('#createRouteTripPreview');
  const nameInput = $('#createRouteName');
  const name = nameInput?.value.trim();
  if (tripPreview) tripPreview.textContent = '';
  if (!name) { if (status) status.textContent = 'Ingresa un nombre para la ruta.'; return; }
  if (drawnRoutePoints.length < 2) { if (status) status.textContent = 'Traza al menos 2 puntos en el mapa.'; return; }

  const routeId = `route-custom-${Date.now().toString(36)}`;
  // Roadmap item 2 ("optimización de orden de paradas"): opt-in via #createRouteOptimize,
  // unchecked by default so the default flow is byte-identical to before this feature. When
  // checked, reorders the clicked waypoints (keeping the first click fixed as the depot/start)
  // before they're sent to OSRM — the order must be decided first, since OSRM only snaps whatever
  // order it's given to real streets, it doesn't re-decide visiting order.
  const optimizeOrder = $('#createRouteOptimize')?.checked ?? false;
  const clickOrderPath = drawnRoutePoints.slice();
  // "Trazado inteligente" (roadmap item 1): try to snap the (possibly reordered) waypoints to real
  // street geometry via OSRM. Any failure (network, timeout, malformed response) falls back to the
  // straight-line path in that same order — this must never block route creation (rule 5).
  const straightPath = optimizeOrder ? optimizeWaypointOrder(clickOrderPath) : clickOrderPath;
  let path = straightPath;
  let usedRoadRouting = false;
  if (status) status.textContent = optimizeOrder ? 'Optimizando orden de paradas y calculando trazo sobre calles reales…' : 'Calculando trazo sobre calles reales…';
  const roadRoute = await fetchRoadRoute(straightPath);
  if (roadRoute.ok) { path = roadRoute.path; usedRoadRouting = true; }
  const stopPoints = generateRouteStopPoints(path);
  const distanceMeters = path.slice(1).reduce((total, point, index) => total + haversineMeters(path[index], point), 0);

  const vehicleSelect = $('#createRouteVehicle');
  const vehicleId = vehicleSelect?.value;
  const truck = vehicleId ? trucks.find((item) => item.id === vehicleId) : null;

  operationsAdapter.createRoute({ id: routeId, name, municipality_id: pilotMunicipality.id, sectors: ['Ruta personalizada'], sector: 'Ruta personalizada' });
  // SW-033/item 16 (resolved): every consumer in this file reads geometry via routeGeometry()/
  // operationsAdapter.listPathPoints() — savePathPoints() below is what makes that work for a drawn
  // route. DeviceSimulator no longer needs a routePaths[routeId] runtime mutation either — it now
  // takes its path lazily via the getPath option (see registerDriverSimulator()/module-init above),
  // so this dictionary is never touched for hand-drawn routes at all anymore.
  operationsAdapter.savePathPoints(routeId, path.map(([latitude, longitude], index) => ({ sequence: index + 1, latitude, longitude })));
  operationsAdapter.saveRouteStops(routeId, stopPoints);

  const newRoute = {
    id: routeId, name, status: 'planned', sectors: ['Ruta personalizada'], sector: 'Ruta personalizada',
    truckId: 'Sin asignar', driverId: null, progress: 0, scheduled: '—', started: 'Pendiente', eta: '—',
    distanceKm: Math.round((distanceMeters / 1000) * 10) / 10, estimatedMinutes: '—',
    stops: stopPoints.length, covered: 0, pending: stopPoints.length, incidents: []
  };
  routes.push(newRoute);
  // Codex review on PR #32: initialRouteProgress was captured once at module load from the original
  // demo routes, so resetSimulation() silently skipped any route created afterward through here —
  // its truck reset to 0% but the route itself kept whatever progress the simulation had reached.
  initialRouteProgress[routeId] = 0;

  // Real route ids never match their demo counterparts (see createVehicleFromForm/
  // createDriverFromForm above) — resolve this first so real_id is already on newRoute by the time
  // assignTruckToRoute() (below) needs it to mirror the assignment too.
  const realRoute = await mirrorToRealAdapter(realAdapter?.createRoute({ name }), status);
  if (realRoute) {
    newRoute.real_id = realRoute.id;
    await mirrorToRealAdapter(realAdapter.savePathPoints(realRoute.id, path.map(([latitude, longitude], index) => ({ sequence: index + 1, latitude, longitude }))), status);
    await mirrorToRealAdapter(realAdapter.saveRouteStops(realRoute.id, stopPoints), status);
  }

  if (truck) await assignTruckToRoute(newRoute, truck);
  // UX cleanup (SW-037): a route created without a vehicle used to leave the Project Owner staring
  // at the Rutas list with no obvious next step — "Asignar vehículo" only lived in the route's own
  // detail drawer, which they'd have to know to open manually. Jump straight there, same navigation
  // (selectRoute()+goToMapTab()) already used when clicking a route row.
  if (!truck) { selectRoute(routeId); goToMapTab(); }

  drawnRoutePoints = [];
  redrawCreateRouteTrace();
  if (nameInput) nameInput.value = '';
  if (vehicleSelect) vehicleSelect.innerHTML = `<option value="">Sin vehículo asignado (asignar después)</option>${trucks.filter(isTruckAvailable).map((item) => `<option value="${item.id}">${item.unit}</option>`).join('')}`;
  $('#routeList').innerHTML = renderRoutes(routes);
  refreshResumen();
  refreshFleetSelects(); // SW-043: picks up the just-created route in routeFocusSelect()'s dropdown
  if (mapReady) drawMapLayers();
  const roadPart = usedRoadRouting
    ? 'trazado ajustado a calles reales (OSRM)'
    : 'trazo en línea recta — no se pudo calcular el ruteo por calles';
  const optimizePart = optimizeOrder ? ', orden de paradas optimizado' : '';
  const creationStatusText = `Ruta "${name}" creada con ${stopPoints.length} puntos de recolección, ${roadPart}${optimizePart}. Estimando viviendas (OpenStreetMap)…`;
  if (status) status.textContent = creationStatusText;
  if (tripPreview) tripPreview.textContent = truck ? formatTripPreview(splitIntoTrips(stopPoints, truck.max_stops ?? DEFAULT_MAX_STOPS)) : '';

  // Roadmap item 5 ("estimación de viviendas"): kept off the route-creation critical path (Codex
  // review on PR #50/#48) — the public Overpass instance has no SLA, and the route above is already
  // fully created/persisted/assigned by the time this call is even made, so a slow/unavailable
  // Overpass no longer adds up to 15s to route creation on top of the OSRM wait. Never throws (same
  // contract as fetchRoadRoute) — updates newRoute in place (routes.push() above already made it the
  // live array entry) and only touches UI that's still showing this route: the creation status line
  // (only if nothing else has overwritten it since) and the detail drawer, if still open on it.
  fetchBuildingCount(stopPoints.map((point) => [point.latitude, point.longitude])).then((buildingResult) => {
    const timeEstimate = buildingResult.ok ? estimateCollectionMinutes(buildingResult.buildingCount) : null;
    if (timeEstimate) newRoute.estimatedMinutes = timeEstimate.averageMinutes;
    newRoute.estimatedHouseholds = buildingResult.ok ? buildingResult.buildingCount : undefined;
    newRoute.estimatedMinutesRange = timeEstimate ? { min: timeEstimate.minMinutes, max: timeEstimate.maxMinutes } : undefined;
    const estimatePart = buildingResult.ok
      ? `~${buildingResult.buildingCount} viviendas estimadas (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min, OSM)`
      : 'estimación de viviendas no disponible';
    const statusEl = $('#createRouteStatus');
    if (statusEl && statusEl.textContent === creationStatusText) statusEl.textContent = `Ruta "${name}": ${estimatePart}.`;
    if (selectedRouteId === routeId) selectRoute(routeId);
  });
}

function drawerContent(content) { return `<button class="drawer-close" data-close-detail aria-label="Cerrar detalle">✕ Cerrar</button><div class="drawer-scroll">${content}</div>`; }
function openDetail(content) { const detail = $('#detail'); detail.innerHTML = drawerContent(content); detail.classList.remove('is-hidden'); detail.setAttribute('aria-hidden', 'false'); }
// Reflects the current selection on whatever [data-route]/[data-truck]/[data-incident] elements are
// in the DOM right now (list rows, map layers wired up later don't need this) — run on every
// selection change so a click gives visible feedback even though the row markup itself isn't re-rendered.
function markSelection() {
  document.querySelectorAll('[data-route]').forEach((el) => el.classList.toggle('selected', el.dataset.route === selectedRouteId));
  document.querySelectorAll('[data-truck]').forEach((el) => el.classList.toggle('selected', el.dataset.truck === selectedTruckId));
  document.querySelectorAll('[data-incident]').forEach((el) => el.classList.toggle('selected', el.dataset.incident === selectedIncidentId));
  // SW-043: keep routeFocusSelect()'s dropdown in sync when the route gets (de)selected some other
  // way — clicking its row in "Rutas", its polyline on the map, or closing the detail drawer.
  const simVehicleSelect = $('#simVehicle');
  if (simVehicleSelect) simVehicleSelect.value = selectedRouteId ?? '';
  // SW-054: mapStartAction() depends on the currently selected route — refresh it here too, same
  // trigger as the select above, so the button appears/disappears/updates without a full map re-render.
  const mapStartActionEl = $('#mapStartAction');
  if (mapStartActionEl) mapStartActionEl.innerHTML = mapStartAction();
}
function closeDetail() { const detail = $('#detail'); detail.classList.add('is-hidden'); detail.setAttribute('aria-hidden', 'true'); detail.innerHTML = ''; selectedTruckId = null; selectedRouteId = null; selectedIncidentId = null; drawMapLayers(); markSelection(); }
function selectTruck(id) { selectedTruckId = id; selectedRouteId = null; selectedIncidentId = null; const truck = trucks.find((item) => item.id === id); openDetail(renderTruckDetail(truck)); drawMapLayers(); markSelection(); }
function selectRoute(id) { if (routeReoptimizationPreview?.routeId !== id) routeReoptimizationPreview = null; selectedRouteId = id; selectedTruckId = null; selectedIncidentId = null; const route = routeById(id); openDetail(renderRouteDetail(route)); drawMapLayers(); markSelection(); refreshRouteDurationHistory(id); }
// SW-044: fills the #routeDurationHistory placeholder renderRouteDetail() leaves for a real/
// hydrated route — a network read (listRouteRuns()), so it can't run synchronously inside the
// render itself like the rest of the panel. Fire-and-forget from selectRoute(); a route switch
// before this resolves just means the stale fetch's result lands on a #routeDurationHistory that
// either doesn't exist anymore or belongs to the newly selected route — checked via the routeId
// still matching selectedRouteId before writing, same staleness guard pattern used elsewhere in
// this file for async UI updates.
async function refreshRouteDurationHistory(routeId) {
  const route = routeById(routeId);
  if (!route?.real_id || !realAdapter) return;
  const result = await realAdapter.listRouteRuns();
  if (selectedRouteId !== routeId) return; // user navigated away while this was in flight
  const el = document.getElementById('routeDurationHistory');
  if (!el) return;
  if (!result.ok) { el.textContent = 'No se pudo cargar el histórico de corridas.'; return; }
  const runsForRoute = result.data.filter((run) => run.route_id === route.real_id && run.started_at && run.completed_at);
  if (!runsForRoute.length) { el.textContent = 'Todavía no hay corridas con duración medida para esta ruta.'; return; }
  const durations = runsForRoute.map((run) => Math.max(0, Math.round((Date.parse(run.completed_at) - Date.parse(run.started_at)) / 60000)));
  const average = Math.round(durations.reduce((total, minutes) => total + minutes, 0) / durations.length);
  const durationText = `${runsForRoute.length} corrida(s) medida(s) · promedio ${formatMinutes(average)} · última ${formatMinutes(durations[durations.length - 1])}`;
  // SW-045: distancia real solo existe para las corridas que sí tuvieron GPS activo — puede ser un
  // subconjunto de runsForRoute (por eso se filtra aparte, no se asume que todas la tengan).
  const distances = runsForRoute.filter((run) => run.distance_meters != null).map((run) => Math.round(run.distance_meters / 100) / 10);
  const distanceText = distances.length
    ? ` · distancia real: ${distances.length} corrida(s) · promedio ${Math.round((distances.reduce((total, km) => total + km, 0) / distances.length) * 10) / 10} km · última ${distances[distances.length - 1]} km`
    : '';
  el.textContent = durationText + distanceText;
}
function selectIncident(code) { selectedIncidentId = code; selectedTruckId = null; selectedRouteId = null; const incident = incidents.find((item) => item.code === code); openDetail(renderIncidentDetail(incident)); drawMapLayers(); markSelection(); }
function startSimulation() { if (simulationTimer) return; simulationTimer = setInterval(() => { trucks.filter((truck) => truck.routeId && truck.state !== 'offline' && truck.state !== 'completed').forEach((truck) => { const path = routeGeometry(truck.routeId); simState[truck.id].index = (simState[truck.id].index + 1) % path.length; simState[truck.id].progress = Math.min(99, simState[truck.id].progress + 3); truck.progress = simState[truck.id].progress; truck.updatedAt = 'Ahora (simulación)'; truck.sector = routeById(truck.routeId)?.sector ?? truck.sector; const route = routeById(truck.routeId); if (route) route.progress = truck.progress; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }, 1800 / simulationSpeed); }
function pauseSimulation() { clearInterval(simulationTimer); simulationTimer = null; }
function resetSimulation() { pauseSimulation(); trucks.forEach((truck) => { const original = initialTruckState[truck.id]; simState[truck.id] = { index: original.index, progress: original.progress }; truck.progress = original.progress; truck.updatedAt = original.updatedAt; truck.sector = original.sector; }); routes.forEach((route) => { if (initialRouteProgress[route.id] !== undefined) route.progress = initialRouteProgress[route.id]; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-detail]')) { closeDetail(); return; }
  const opsNavButton = event.target.closest('[data-ops-nav]');
  if (opsNavButton) location.hash = `operaciones/${opsNavButton.dataset.opsNav}`;
  const impactTabButton = event.target.closest('[data-impact-tab]');
  if (impactTabButton) {
    impactTab = impactTabButton.dataset.impactTab;
    document.querySelectorAll('#impacto [data-impact-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.impactTab === impactTab));
    document.querySelectorAll('#impacto [data-impact-tab-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.impactTabPanel !== impactTab));
  }
  const impactKpiGroupButton = event.target.closest('[data-impact-kpi-group]');
  if (impactKpiGroupButton) {
    impactKpiGroup = impactKpiGroupButton.dataset.impactKpiGroup;
    document.querySelectorAll('#impacto [data-impact-kpi-group]').forEach((tab) => tab.classList.toggle('active', tab.dataset.impactKpiGroup === impactKpiGroup));
    const kpisEl = $('#impactKpis');
    if (kpisEl) kpisEl.innerHTML = renderImpactKpiCards(impactKpiGroup, calculateImpactMetrics(currentImpactAssumptions(), currentImpactFilters()));
  }
  // Empty-state pointers like "registra uno en Municipal · Flota y personal" used to be plain
  // text — this makes them real links: switch tab via the normal hash nav, then scroll the
  // referenced panel into view once its section is visible (a hashchange handles the tab switch
  // itself, so this only needs to wait a frame for that to settle before scrolling).
  const scrollTarget = event.target.closest('[data-scroll-to]');
  if (scrollTarget) requestAnimationFrame(() => $(`#${scrollTarget.dataset.scrollTo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const createRouteAction = event.target.closest('[data-create-route]')?.dataset.createRoute;
  if (createRouteAction === 'undo') undoLastRoutePoint();
  if (createRouteAction === 'finish') finishCreateRoute();
  const fleetAction = event.target.closest('[data-fleet]')?.dataset.fleet;
  if (fleetAction === 'create-vehicle') createVehicleFromForm();
  if (fleetAction === 'create-driver') createDriverFromForm();
  const driverAccountButton = event.target.closest('[data-fleet-driver-account]');
  if (driverAccountButton) createDriverAccount(driverAccountButton.dataset.fleetDriverAccount);
  const driverResendButton = event.target.closest('[data-fleet-driver-resend]');
  if (driverResendButton) resendDriverInvite(driverResendButton.dataset.fleetDriverResend);
  const onboardAction = event.target.closest('[data-onboard]')?.dataset.onboard;
  if (onboardAction === 'vehicle') onboardVehicleStep();
  if (onboardAction === 'driver') onboardDriverStep();
  const truckButton = event.target.closest('[data-truck]'); if (truckButton) { selectTruck(truckButton.dataset.truck); goToMapTab(); }
  const routeButton = event.target.closest('[data-route]'); if (routeButton?.dataset.route) { selectRoute(routeButton.dataset.route); goToMapTab(); }
  const incidentButton = event.target.closest('[data-incident]'); if (incidentButton) { selectIncident(incidentButton.dataset.incident); goToMapTab(); }
  const verifyButton = event.target.closest('[data-verify-route]');
  if (verifyButton) verifyRouteManually(verifyButton.dataset.verifyRoute);
  const assignVehicleButton = event.target.closest('[data-assign-vehicle]');
  if (assignVehicleButton) { const vehicleId = $('#assignVehicleSelect')?.value; if (vehicleId) assignVehicleToExistingRoute(assignVehicleButton.dataset.assignVehicle, vehicleId); }
  const assignDriverButton = event.target.closest('[data-assign-driver]');
  if (assignDriverButton) { const driverId = $('#assignDriverSelect')?.value; if (driverId) assignDriverToTruck(assignDriverButton.dataset.assignDriver, driverId); }
  const guidedStartButton = event.target.closest('[data-guided-start]');
  if (guidedStartButton) putRouteInMotion(guidedStartButton.dataset.guidedStart);
  const startRouteButton = event.target.closest('[data-start-route]');
  if (startRouteButton) startRouteManually(startRouteButton.dataset.startRoute);
  const completeRouteButton = event.target.closest('[data-complete-route]');
  if (completeRouteButton) completeRouteManually(completeRouteButton.dataset.completeRoute);
  const driverStartRouteButton = event.target.closest('[data-driver-start-route]');
  if (driverStartRouteButton) driverStartRoute(driverStartRouteButton.dataset.driverStartRoute);
  const driverCompleteRouteButton = event.target.closest('[data-driver-complete-route]');
  if (driverCompleteRouteButton) driverCompleteRoute(driverCompleteRouteButton.dataset.driverCompleteRoute);
  const reoptimizeButton = event.target.closest('[data-reoptimize-route]');
  if (reoptimizeButton) previewRouteReoptimization(reoptimizeButton.dataset.reoptimizeRoute);
  const resolveButton = event.target.closest('[data-resolve-incident]');
  if (resolveButton) { const incident = incidents.find((item) => item.code === resolveButton.dataset.resolveIncident); if (incident) { incident.status = 'Cerrada'; refreshSupervisor(); refreshResumen(); } }
  const resolveReportButton = event.target.closest('[data-resolve-citizen-report]');
  if (resolveReportButton) resolveCitizenReportManually(resolveReportButton.dataset.resolveCitizenReport);
  const onboardButton = event.target.closest('[data-onboarding]');
  if (onboardButton) { const status = document.querySelector(`[data-onboarding-status="${onboardButton.dataset.onboarding}"]`); if (status) status.textContent = 'Onboarding demo iniciado — flujo completo en desarrollo.'; }
  if (event.target.id === 'useGeo') { requestGeolocation(); }
  const driverGpsAction = event.target.closest('[data-driver-gps]')?.dataset.driverGps;
  if (driverGpsAction === 'start') startDriverGps();
  if (driverGpsAction === 'stop') stopDriverGps();
  if (event.target.id === 'checkFolio') { const found = findIncidentStatus($('#folioSearch').value); $('#folioStatus').textContent = found ? `${found.type}: ${found.status}` : 'Folio demo no encontrado'; }
  const sim = event.target.dataset.sim; if (sim === 'start') startSimulation(); if (sim === 'pause') pauseSimulation(); if (sim === 'reset') resetSimulation(); if (sim === 'fullscreen') toggleMapFullscreen(); if (sim === 'speed') { simulationSpeed = simulationSpeed === 1 ? 2 : simulationSpeed === 2 ? 4 : 1; event.target.textContent = `${simulationSpeed}×`; if (simulationTimer) { pauseSimulation(); startSimulation(); } }
});
// Extendido a inputs numéricos (antes solo <select>) para que los supuestos configurables —
// incluyendo minutesPerStop/avgSpeedKmh de la pestaña Uso — recalculen al perder foco, no solo los
// filtros. 'change' (no 'input') ya evita recalcular en cada tecla.
document.addEventListener('change', (event) => { if (event.target.closest('#impacto') && event.target.matches('select, input[type="number"]')) { $('#impacto').outerHTML = renderImpactCenter(currentImpactAssumptions(), currentImpactFilters()); } });
// SW-043: routeFocusSelect()'s change handler — selecting a route from the sim-controls dropdown
// focuses the map on it exactly like clicking its row/polyline does. goToMapTab() so picking one
// while on a different Operaciones sub-vista (Rutas, Flota) actually switches to Mapa to show it.
document.addEventListener('change', (event) => { if (event.target.id === 'simVehicle' && event.target.value) { selectRoute(event.target.value); goToMapTab(); } });
// SW-049: no re-render needed here beyond the checkbox itself — the next time a route detail is
// opened/re-rendered, renderRouteDetail() reads the module-level guidedAssignmentEnabled fresh.
document.addEventListener('change', (event) => { if (event.target.id === 'guidedAssignmentToggle') setGuidedAssignmentPreference(event.target.checked); });
// UX cleanup (SW-037): "Crear ruta" now lives collapsed behind a <details> ("+ Nueva ruta") instead
// of always taking up space in the Rutas panel. Its Leaflet map (#createRouteMap) is built once at
// module init regardless of visibility (see initCreateRouteMap() below), so — same as
// showOpsView()'s invalidateSize() call for the 'rutas' ops-tab — it needs an explicit
// invalidateSize() once the <details> actually opens, or it renders with zero size. The native
// `toggle` event doesn't bubble, so this must listen on the capture phase to reach it via delegation.
document.addEventListener('toggle', (event) => {
  if (event.target.id === 'createRouteToggle' && event.target.open && createRouteMapReady) requestAnimationFrame(() => createRouteMap.invalidateSize());
}, true);
$('#search').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); $('#routeList').innerHTML = renderRoutes(routes.filter((route) => JSON.stringify(route).toLowerCase().includes(term))); });
$('#sectorFilter').addEventListener('change', (event) => { $('#routeList').innerHTML = renderRoutes(routes.filter((route) => !event.target.value || route.sectors.includes(event.target.value))); });
$('#citizenSector').addEventListener('change', (event) => { const service = findSectorService(event.target.value); $('#pickupResult').textContent = service ? `${service.pickupDay} · Estado: ${service.status}` : 'Sector demo no encontrado'; });
$('#citizenSector').dispatchEvent(new Event('change'));
// SW-039: real submission when a municipality-specific deployment is configured
// (SMARTWASTE_SUPABASE_CONFIG.municipality_id — see frontend/auth-gate.js's readSupabaseConfig()),
// demo folio otherwise (rule 5 — never breaks the approved demo when no real backend is set).
// `sector` isn't sent in real mode: the dropdown's options come from shared/demo-data.js's
// hardcoded sectors, whose ids don't correspond to real Supabase sectors rows — sending one would
// violate citizen_reports.sector_id's foreign key. citizen_reports.sector_id is nullable, so a real
// report is simply created without one for now; hydrating real sector data into this dropdown is a
// separate, not-yet-built piece of work (SW-035 hydrates vehicles/drivers/routes, never sectors).
$('#incidentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const config = readSupabaseConfig();
  const client = getAuthClient();
  const folioEl = $('#folio');
  if (client && config?.municipality_id) {
    if (folioEl) folioEl.textContent = 'Enviando reporte…';
    const form = event.target;
    const evidenceFile = $('#evidence')?.files?.[0] || null;
    const result = await submitCitizenReport(client, {
      municipality_id: config.municipality_id,
      type: form.type.value,
      description: form.description.value,
      evidenceFile
    });
    if (folioEl) folioEl.textContent = result.ok ? `Folio generado: ${result.folio} (reporte real)` : `No se pudo enviar el reporte: ${result.error.message}`;
    if (result.ok) form.reset();
    return;
  }
  if (folioEl) folioEl.textContent = `Folio generado: ${createDemoFolio(citizenFolioSequence)} (demo · sin upload real)`;
  citizenFolioSequence += 1;
});
document.querySelectorAll('#fuelPrice,#fuelEfficiency,#operatingDays,#hourlyCost').forEach((input) => input.addEventListener('input', () => { const assumptions = { ...defaultImpactAssumptions, fuelPrice: Number($('#fuelPrice').value), fuelEfficiency: Number($('#fuelEfficiency').value), operatingDays: Number($('#operatingDays').value), hourlyCost: Number($('#hourlyCost').value) }; $('#impactEconomics').innerHTML = renderImpactEconomics(calculateImpactMetrics(assumptions)); }));
// SW-039: the upload itself only happens on submit (submitCitizenReport, above) — this handler
// only validates + previews, so the note here just needs to say what will happen next.
$('#evidence').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  const result = validateEvidenceFile(file);
  const uploadNote = (getAuthClient() && readSupabaseConfig()?.municipality_id) ? 'se sube al enviar el formulario' : 'sin upload real (modo demo)';
  $('#evidencePreview').textContent = result.ok ? `${file?.name ?? 'Sin archivo'} · ${result.reason === 'no_file' ? 'sin archivo' : uploadNote}` : `Evidencia rechazada: ${result.reason}`;
});
$('#driverVehicleSelect').addEventListener('change', (event) => {
  driverVehicleId = event.target.value;
  drawDriverPositions(); // also refreshes #driverRouteInfo for the newly selected vehicle
});
function requestGeolocation() { const target = $('#geoStatus'); if (!navigator.geolocation) { target.textContent = 'Ubicación no disponible en este navegador.'; return; } target.textContent = 'Solicitando permiso de ubicación...'; navigator.geolocation.getCurrentPosition((pos) => { target.textContent = `Ubicación recibida localmente: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (no enviada)`; }, (err) => { target.textContent = `Permiso denegado, timeout o ubicación no disponible: ${err.message}`; }, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 }); }
if (!redirectLegacyHash()) showSection(sectionFromHash());
initMap();
initDriverMap();
initDriverPolling();
initOpsGpsPolling();
initCreateRouteMap();
// SW-035 fase A: pulls vehicles/drivers that already existed in Supabase before this page loaded
// and appends them to trucks/drivers — additive, never replaces/clears those arrays, so
// simState/driverSimulators/trucksWithRoute (all derived once from trucks/routes at module load,
// see the comment on `let realAdapter` near the top of this file) stay exactly as valid as they
// were before. A hydrated vehicle/driver has no route yet (routeId: null), so none of that
// derived simulation state needs to know about it at all — it only needs to render in lists and
// selects, same shape createVehicleFromForm()/createDriverFromForm() already build for a
// freshly-created one, with `real_id` set to the row's actual Supabase id (idempotency key, and
// what assignVehicleToExistingRoute()/createDriverAccount() already use to reach the real row).
// Route hydration (with real vehicle/driver assignment and progress from route_runs) is a separate,
// larger follow-up (fase B, docs/TECHNICAL_DEBT_REGISTER.md item 17) — not attempted here.
// Devuelve si AMBAS lecturas realmente llegaron a Supabase (Codex review en PR #54, P1): un fallo
// transitorio de red/RLS deja vehiclesResult.ok/driversResult.ok en false sin agregar ningún
// real_id, lo cual antes era indistinguible de "este municipio no tiene nada todavía" — el caller
// (bootstrapRealBackend()) solo debe declarar el municipio vacío y activar el wizard cuando esto
// devuelve true, nunca cuando la lectura simplemente falló.
async function hydrateVehiclesAndDrivers() {
  if (!realAdapter) return false;
  const vehiclesResult = await realAdapter.listVehicles();
  if (vehiclesResult.ok) {
    vehiclesResult.data.forEach((row) => {
      if (trucks.some((truck) => truck.real_id === row.id)) return;
      trucks.push({
        id: row.id, real_id: row.id, unit: row.code, name: row.code, plate: row.plate ?? '',
        state: row.state ?? 'offline', driverId: null, routeId: null, progress: 0, speedKmh: 0,
        updatedAt: 'Sincronizado desde Supabase', sector: 'Sin asignar', nextStop: 'Sin asignar',
        loadLevel: 0, positionIndex: 0, max_stops: row.max_stops
      });
    });
  }
  const driversResult = await realAdapter.listDrivers();
  if (driversResult.ok) {
    const DRIVER_STATUS_LABELS = { available: 'Disponible', assigned: 'Asignado', off_duty: 'Fuera de turno', suspended: 'Suspendido' };
    driversResult.data.forEach((row) => {
      if (drivers.some((driver) => driver.real_id === row.id)) return;
      // SW-050: email now hydrates from the real row (supabase/migrations/
      // 202607150014_sw050_driver_email.sql) instead of only ever existing in the tab that created
      // it — this is what keeps "Crear cuenta de acceso" available across a page reload.
      drivers.push({ id: row.id, real_id: row.id, name: row.display_name, phone: '', email: row.email ?? null, status: DRIVER_STATUS_LABELS[row.status] ?? row.status, profile_id: row.profile_id ?? null });
    });
  }
  // SW-042 (docs/TECHNICAL_DEBT_REGISTER.md #24): the two pushes above always hardcoded
  // driverId: null on a hydrated truck — vehicle_assignments (the actual link) was never
  // consulted, so the truck detail panel showed "Conductor: Sin asignar" even for a vehicle that
  // did have a driver assigned server-side. Cosmetic-only (findOwnVehicleAssignment(), used by the
  // driver's own GPS button, always read vehicle_assignments directly and was never affected), but
  // real enough to cause confusion during interactive testing — see SW-040's staging verification.
  const assignmentsResult = await realAdapter.listVehicleAssignments();
  if (assignmentsResult.ok) {
    assignmentsResult.data.forEach((assignment) => {
      const truck = trucks.find((item) => item.real_id === assignment.vehicle_id);
      const driver = drivers.find((item) => item.real_id === assignment.driver_id);
      if (truck && driver) truck.driverId = driver.id;
    });
  }
  refreshFleetSelects();
  return vehiclesResult.ok && driversResult.ok;
}
// SW-035 fase B: hydrates routes with their real assignment/progress. Must run AFTER
// hydrateVehiclesAndDrivers() (above) — matches a route's vehicle_id/driver_id (from route_runs,
// the only place that assignment actually lives — routes itself has no vehicle_id/driver_id/
// progress column, see the comment on assignVehicle() in shared/operations-adapter.js) against the
// already-hydrated trucks/drivers by real_id. Reuses the exact geometry/stops seeding pattern the
// module-init block above already uses for the 5 bundled demo routes (operationsAdapter.
// savePathPoints/saveRouteStops, guarded so it never duplicates) so routeGeometry()/drawMapLayers()/
// the driver view work for a hydrated route exactly like they do for a demo one. A hydrated route
// with an assigned vehicle also gets a driverSimulators entry (registerDriverSimulator(), same as
// finishCreateRoute() already does) and a simState entry, so it can participate in
// startSimulation()'s tick like every other route — additive, doesn't touch demo trucks/routes.
async function hydrateRoutes() {
  if (!realAdapter) return false;
  const routesResult = await realAdapter.listRoutes();
  if (!routesResult.ok) return false;
  const routeRunsResult = await realAdapter.listRouteRuns();
  const latestRunByRouteId = {};
  // Real bug found in staging during SW-044 verification: reassigning a vehicle from an old,
  // already-finished route to a brand new one, then reloading, kept showing the OLD route in the
  // driver's own Conductor view. Root cause was the `truck.routeId = row.id` assignment below —
  // routesResult.data is ordered oldest-first (listRoutes()'s own .order('created_at')), and that
  // assignment only checked "is this truck still unclaimed", not "is this route actually the
  // vehicle's most recent one" — so whichever route the vehicle had EVER been on first always won,
  // even a completed one from weeks ago. latestRunByVehicleId (new, below) tracks each vehicle's
  // truly most recent route_run across every route, so the assignment can check the right thing.
  const latestRunByVehicleId = {};
  // Ordered oldest-first by the adapter — overwriting as we iterate leaves the most recent
  // route_run per route_id/vehicle_id, same "most recent" intent transitionRouteRun() applies per-route.
  if (routeRunsResult.ok) routeRunsResult.data.forEach((run) => {
    latestRunByRouteId[run.route_id] = run;
    if (run.vehicle_id) latestRunByVehicleId[run.vehicle_id] = run;
  });

  for (const row of routesResult.data) {
    if (routes.some((route) => route.real_id === row.id)) continue;
    const run = latestRunByRouteId[row.id] ?? null;
    const truck = run?.vehicle_id ? trucks.find((item) => item.real_id === run.vehicle_id) : null;
    const driver = run?.driver_id ? drivers.find((item) => item.real_id === run.driver_id) : null;

    const stopsResult = truck ? await realAdapter.listRouteStopsWithStatus(row.id, truck.real_id) : await realAdapter.listRouteStops(row.id);
    const stopPoints = stopsResult.ok ? stopsResult.data : [];
    const covered = stopPoints.filter((stop) => stop.status === 'recolectado').length;

    // SW-044: routes.status only ever advances once, from 'planned' to 'assigned' (see
    // assignToRouteRun() in shared/operations-adapter.js) — every later transition (started,
    // in_progress, delayed, completed, verified) writes to route_runs.status only, never back to
    // routes. Reading row.status here (as this did before) left a hydrated already-started/
    // completed route stuck showing "Asignada" forever after a page reload, which would also have
    // hidden the new "Iniciar ruta" button behind the wrong condition. run.status wins whenever a
    // run exists; row.status only matters for the no-run-yet ('planned') case.
    const newRoute = {
      id: row.id, real_id: row.id, name: row.name, status: run?.status ?? row.status ?? 'planned',
      sectors: ['Sincronizado desde Supabase'], sector: 'Sincronizado desde Supabase',
      truckId: truck ? truck.unit : 'Sin asignar', driverId: driver ? driver.id : null,
      progress: run?.progress ?? 0, scheduled: '—', started: run ? 'Sincronizado' : 'Pendiente', eta: '—',
      distanceKm: 0, estimatedMinutes: '—', stops: stopPoints.length, covered, pending: stopPoints.length - covered, incidents: [],
      // SW-044: carries the real timestamps over so a route hydrated already-started/completed
      // shows a measured duration immediately, instead of looking exactly like a route that never
      // ran through startRouteManually()/completeRouteManually() this session.
      started_at: run?.started_at ?? null, completed_at: run?.completed_at ?? null,
      // SW-045: real GPS-derived distance for this run, if one was computed (transitionRouteRun()
      // in shared/operations-adapter.js, only on completion, only when there was a GPS trail).
      real_distance_meters: run?.distance_meters ?? null
    };
    routes.push(newRoute);
    initialRouteProgress[row.id] = newRoute.progress;

    const pathResult = await realAdapter.listPathPoints(row.id);
    if (pathResult.ok && pathResult.data.length && operationsAdapter.listPathPoints(row.id).length === 0) {
      operationsAdapter.savePathPoints(row.id, pathResult.data.map((point) => ({ sequence: point.sequence, latitude: point.latitude, longitude: point.longitude })));
    }
    if (stopPoints.length && operationsAdapter.listRouteStops(row.id).length === 0) {
      // Codex review on PR #47: stopPoints.status here is the real per-stop status
      // listRouteStopsWithStatus() just resolved from actual recorded vehicle_positions — carry it
      // onto the seeded stop (the demo adapter's saveRouteStops() spreads extra fields through) so
      // previewRouteReoptimization() (below) has a real "already collected" floor for this route,
      // instead of only what the synthetic single-point trail registerDriverSimulator() seeds next
      // would derive on its own.
      operationsAdapter.saveRouteStops(row.id, stopPoints.map((stop) => ({ sequence: stop.sequence, label: stop.label, latitude: stop.latitude, longitude: stop.longitude, status: stop.status })));
    }

    // Only claims this route for the truck if it's truly the vehicle's most recent route_run
    // (see latestRunByVehicleId above) — not just "the first route in creation order this truck
    // happens to appear on and hasn't been claimed by yet".
    if (truck && !truck.routeId && latestRunByVehicleId[truck.real_id]?.route_id === row.id) {
      truck.routeId = row.id;
      truck.state = newRoute.status === 'completed' ? 'completed' : newRoute.status === 'delayed' ? 'delayed' : 'active';
      truck.progress = newRoute.progress;
      truck.positionIndex = 0;
      simState[truck.id] = { index: 0, progress: newRoute.progress };
      registerDriverSimulator(truck);
    }
  }
  $('#routeList').innerHTML = renderRoutes(routes);
  refreshFleetSelects();
  if (mapReady) drawMapLayers();
  return true;
}
// SW-034: once a real session resolves (municipality_id known), builds the real adapter that
// createVehicleFromForm/createDriverFromForm/finishCreateRoute mirror their writes to. Patches only
// the "fuente desacoplada" label directly (not a full section re-render) so the already-initialized
// Leaflet map instance is never touched by this.
// SW-058: brings real citizen_reports (still open/unresolved) into Supervisor — nothing did this
// before, so a real citizen report had no way to ever reach a dispatcher (see
// docs/TECHNICAL_DEBT_REGISTER.md #23). Same never-block-the-page posture as every other real
// hydrate call: a failed fetch just leaves the list empty rather than surfacing an error.
//
// Codex review (PR #75, P1): #supervisor is only ever visible to role 'supervisor'
// (SECTION_ROLES), but that's a CSS class, not a network boundary — without this check, a signed-in
// driver's or dispatcher's browser would still fetch and hold every citizen report's description/
// evidence_path in module state (and on the wire) even though they can never see the section that
// displays it. The `tenant_read` RLS policy itself stays broader (shared across 13 tables by
// migration 202607150004_sw014_auth_rls_policies.sql's role loop, not specific to citizen_reports)
// — narrowing that is a separate, pre-existing piece of schema work, out of scope here; this closes
// the concrete leak this hito introduced (an unconditional fetch), not the underlying RLS grant.
async function hydrateCitizenReports() {
  if (!realAdapter || driverAuthContext?.role !== 'supervisor') return;
  const result = await realAdapter.listCitizenReports();
  if (result.ok) realCitizenReports = result.data;
}
async function bootstrapRealBackend(ctx) {
  const client = getAuthClient();
  if (!client || !ctx?.municipality_id) return;
  realAdapter = resolveOperationsAdapter({ client, municipality_id: ctx.municipality_id });
  backendMode = realAdapter.mode;
  driverAuthContext = ctx;
  const sourceLabel = document.querySelector('.sim-controls span');
  if (sourceLabel) sourceLabel.textContent = `${simulationNotice} · fuente desacoplada: ${backendMode}`;
  // Codex review on PR #54 (P1): un fallo transitorio de red/RLS deja *Result.ok en false sin
  // agregar ningún real_id — antes eso era indistinguible de "este municipio no tiene nada
  // todavía", así que un error de lectura podía vaciar datos reales ya existentes y ofrecer
  // onboarding, permitiendo crear vehículos/choferes/rutas duplicados. Solo se declara vacío cuando
  // AMBAS hidrataciones realmente resolvieron (ok), no cuando fallaron.
  const vehiclesAndDriversHydrated = await hydrateVehiclesAndDrivers();
  const routesHydrated = await hydrateRoutes();
  await hydrateCitizenReports();
  refreshSupervisor();
  // Onboarding en vacío: si la hidratación de arriba resolvió bien y no trajo NINGÚN vehículo/
  // chofer/ruta real, este municipio nunca operó en Supabase — mostrarle los 5 datos demo
  // sembrados al cargar el módulo (module-init, antes de que se supiera si habría backend real) lo
  // confundiría pensando que es operación real. Solo corre con backend real conectado (nunca en
  // DEMO_ONLY — regla 5); vacía los arrays y activa el wizard en vez de la UI normal.
  if (vehiclesAndDriversHydrated && routesHydrated && !trucks.some((t) => t.real_id) && !drivers.some((d) => d.real_id) && !routes.some((r) => r.real_id)) {
    trucks.length = 0; drivers.length = 0; routes.length = 0; incidents.length = 0;
    needsOnboarding = true;
    // Codex review on PR #54 (P1): trucksWithRoute/driverSimulators/driverVehicleId son estado
    // derivado, calculado UNA VEZ a partir de los 5 camiones demo al cargar el módulo — vaciar
    // trucks/drivers/routes arriba no los toca (son arrays/valor independientes), así que sin esto
    // registerDriverSimulator() (al asignar la primera ruta real) reconstruye el selector del
    // conductor mezclando los 5 camiones demo (todavía en trucksWithRoute) con el vehículo real
    // nuevo — justo lo que el wizard promete que no va a pasar.
    trucksWithRoute.length = 0;
    Object.keys(driverSimulators).forEach((key) => delete driverSimulators[key]);
    driverVehicleId = null;
    const driverSelect = $('#driverVehicleSelect');
    if (driverSelect) driverSelect.innerHTML = '';
    const driverRouteInfo = $('#driverRouteInfo');
    if (driverRouteInfo) driverRouteInfo.textContent = 'Sin vehículo real asignado todavía.';
    const driverStopsProgress = $('#driverStopsProgress');
    if (driverStopsProgress) driverStopsProgress.textContent = '';
    const incidenciasPanel = document.querySelector('[data-ops-view="incidencias"]');
    if (incidenciasPanel) incidenciasPanel.innerHTML = renderIncidenciasPanel();
    $('#routeList') && ($('#routeList').innerHTML = renderRoutes(routes));
    refreshFleetSelects();
  }
  // Codex review on PR #49: #resumen is built synchronously at page load, before either hydrate
  // call above resolves — without this refresh, every route/vehicle pulled from Supabase stays
  // invisible to the landing KPIs and "Necesita tu atención" list even after hydration succeeds.
  refreshResumen();
  if (needsOnboarding) showOnboardingOverlay();
  // renderDriverMobile() already renders the GPS control conditionally, but that render happened
  // synchronously at page load, before this async function resolved backendMode — the driver view
  // is already in the DOM by then. Insert the control now instead of re-rendering #driverMobile
  // wholesale, which would tear down and lose the live #driverMap Leaflet instance and the
  // #driverVehicleSelect change listener wired once at module init.
  const driverMobile = document.getElementById('driverMobile');
  if (driverMobile && backendMode !== 'DEMO_ONLY' && !driverMobile.querySelector('[data-driver-gps]')) {
    driverMobile.insertAdjacentHTML('beforeend', renderDriverGpsControl());
  }
}
// No-ops entirely (leaves every section visible, same as before this line existed) unless the
// page sets window.SMARTWASTE_SUPABASE_CONFIG — see frontend/auth-gate.js and CLAUDE.md rule 5.
initAuthGate().then((ctx) => { if (ctx) bootstrapRealBackend(ctx); });

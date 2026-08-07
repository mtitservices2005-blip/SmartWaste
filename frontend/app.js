import { demoNotice, simulationNotice, pilotMunicipality, trucks, routes, sectors, drivers, incidents, notifications, municipalities, routeFlow, routePaths, stateLabels } from '../shared/demo-data.js';
import { operationsAdapter, resolveOperationsAdapter } from '../shared/operations-adapter.js';
import { DeviceSimulator, createDemoPositionHistory, createTelemetryIngestionAdapter } from '../shared/telemetry-simulator.js';
import { validateEvidenceFile } from '../shared/channel-contracts.js';
import { createDemoFolio, findSectorService, findIncidentStatus } from '../shared/citizen-portal.js';
import { generateRouteStopPoints, deriveStopStatus, haversineMeters, splitIntoTrips } from '../shared/route-engine.js';
import { fetchRoadRoute } from '../shared/osrm-routing.js';
import { fetchBuildingCount, estimateCollectionMinutes } from '../shared/overpass-buildings.js';
import { optimizeWaypointOrder } from '../shared/route-optimizer.js';
import { positionFromGeolocationEvent, shouldSendPosition } from '../shared/browser-geolocation.js';
import { suggestReoptimizedOrder } from '../shared/route-reoptimizer.js';
import { IMPACT_DEMO_NOTICE, IMPACT_SCENARIO_NOTICE, defaultImpactAssumptions, metricReadiness, calculateImpactMetrics } from '../shared/impact-center.js';
import { initAuthGate, readSupabaseConfig, getAuthClient } from './auth-gate.js';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const driverName = (id) => drivers.find((driver) => driver.id === id)?.name ?? 'Sin asignar';
const routeById = (id) => routes.find((route) => route.id === id);
const routeName = (id) => routeById(id)?.name ?? 'Sin ruta asignada';
const label = (state) => stateLabels[state] ?? state;
const routePosition = (truck) => truck.position ?? routeGeometry(truck.routeId)[truck.positionIndex ?? 0] ?? pilotMunicipality.center;
let selectedTruckId = null;
let selectedRouteId = null;
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
// Roadmap item 3 ("GPS real"): the signed-in session's context (user_id/municipality_id, from
// initAuthGate()/bootstrapRealBackend() below), kept around so the driver GPS button can resolve
// "my own real vehicle" on demand. driverGpsWatchId is the navigator.geolocation.watchPosition()
// handle while GPS sharing is active, null otherwise.
let driverAuthContext = null;
let driverGpsWatchId = null;
let map;
let mapReady = false;
let routeLayers = [];
let truckMarkers = [];
let incidentMarkers = [];
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
let driverVehicleId = trucksWithRoute[0]?.id ?? trucks[0].id;
let driverMap;
let driverMapReady = false;
let driverPlannedLayer = null;
let driverTrailLayer = null;
let driverCurrentMarker = null;
let driverPollTimer = null;
let driverStopsLayer = null;
const DRIVER_POLL_INTERVAL_MS = 7000; // dentro del rango pedido de 5-10s

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

function progress(value) { return `<div class="progress" aria-label="${value}% completado"><i style="width:${value}%"></i></div>`; }
function pill(state) { return `<span class="pill ${state}">${label(state)}</span>`; }
function routeStatus(route) { return route.status === 'completed' || route.status === 'verified' ? 'completed' : route.status; }
function truckIcon(truck) {
  // Codex review on PR #39: real vehicles can legitimately be 'maintenance' (shared/contracts.js's
  // VEHICLE_STATES / the DB check constraint both allow it), which this map didn't cover — a
  // hydrated vehicle in that state rendered with an undefined icon.
  const shapes = { active: '▶', stopped: '■', delayed: '!', offline: '×', completed: '✓', maintenance: '🔧' };
  return `<span class="truck-icon ${truck.state}"><b>${shapes[truck.state] ?? '?'}</b><small>${truck.unit.replace('SW-LS-', '')}</small></span>`;
}
function kpiValue(predicate) { return trucks.filter(predicate).length; }
function operationalKpis() {
  const completedRoutes = routes.filter((route) => ['completed', 'verified'].includes(route.status)).length;
  const openIncidents = incidents.filter((incident) => incident.status !== 'Cerrada').length;
  const compliance = Math.round(routes.reduce((total, route) => total + route.progress, 0) / routes.length);
  return [
    ['Camiones activos', kpiValue((truck) => truck.state === 'active')],
    ['Camiones detenidos', kpiValue((truck) => truck.state === 'stopped')],
    ['Camiones retrasados', kpiValue((truck) => truck.state === 'delayed')],
    ['Camiones offline', kpiValue((truck) => truck.state === 'offline')],
    ['Rutas en progreso', routes.filter((route) => route.status === 'in_progress' || route.status === 'delayed').length],
    ['Rutas completadas', completedRoutes],
    ['Cumplimiento del día', `${compliance}%`],
    ['Incidencias abiertas', openIncidents]
  ];
}

function renderMap() {
  return `<section id="mapa" class="operations-shell">
    <div class="map-card">
      <div class="map-header">
        <div><p class="eyebrow">${pilotMunicipality.branding.label}</p><h1>Mapa operativo real de ${pilotMunicipality.name}</h1><p class="demo">${demoNotice} · Las rutas son simuladas, no oficiales del ayuntamiento.</p></div>
        <div class="sim-controls" aria-label="Controles de simulación"><span>${simulationNotice} · fuente desacoplada: ${backendMode}</span><select id="simVehicle">${trucks.map((t) => `<option value="${t.id}">${t.unit}</option>`).join('')}</select><button data-sim="start">Iniciar</button><button data-sim="pause">Pausar</button><button data-sim="reset">Reiniciar</button><button data-sim="speed">${simulationSpeed}×</button><button data-sim="fullscreen">Pantalla completa</button></div>
      </div>
      <div class="kpis compact">${operationalKpis().map(([name, value]) => `<div class="kpi"><strong>${value}</strong><br>${name}</div>`).join('')}</div>
      <div id="realMap" class="real-map" role="application" aria-label="Mapa OpenStreetMap de Laguna Salada"><div class="map-fallback"><strong>Mapa externo no disponible.</strong><span>Fallback operativo demo: use listas, paneles y coordenadas simuladas.</span></div></div>
    </div>
    <aside class="detail-drawer is-hidden" id="detail" aria-hidden="true"></aside>
  </section>`;
}

function renderTruckDetail(truck) {
  const route = routeById(truck.routeId);
  const relatedIncidents = route ? incidents.filter((incident) => route.incidents.includes(incident.code)) : [];
  return `<div class="drawer-head"><p class="eyebrow">Detalle del camión</p><h2>${truck.unit} · ${truck.name}</h2>${pill(truck.state)}</div>
    <div class="detail-grid"><p><b>Conductor</b><span>${driverName(truck.driverId)}</span></p><p><b>Matrícula demo</b><span>${truck.plate}</span></p><p><b>Ruta</b><span>${routeName(truck.routeId)}</span></p><p><b>Velocidad demo</b><span>${truck.speedKmh} km/h</span></p><p><b>Última actualización</b><span>${truck.updatedAt}</span></p><p><b>Sector actual</b><span>${truck.sector}</span></p><p><b>Próxima parada</b><span>${truck.nextStop}</span></p><p><b>Nivel de carga demo</b><span>${truck.loadLevel}%</span></p></div>
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
  const availableTrucks = trucks.filter((truck) => !truck.routeId);
  const assignAction = (!route.truckId || route.truckId === 'Sin asignar')
    ? (availableTrucks.length
      ? `<div class="controls"><select id="assignVehicleSelect">${availableTrucks.map((truck) => `<option value="${truck.id}">${truck.unit}</option>`).join('')}</select><button type="button" data-assign-vehicle="${route.id}">Asignar vehículo</button></div>`
      : '<p class="demo">No hay vehículos disponibles para asignar — registra uno en Municipal · Flota y personal.</p>')
    : '';
  const completeAction = (route.truckId && route.truckId !== 'Sin asignar' && route.status !== 'completed' && route.status !== 'verified')
    ? `<div class="controls"><button type="button" data-complete-route="${route.id}">Marcar como completada</button></div>`
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
  return `<div class="drawer-head"><p class="eyebrow">Detalle de ruta</p><h2>${route.name}</h2>${pill(routeStatus(route))}</div>
    <div class="detail-grid"><p><b>Unidad asignada</b><span>${route.truckId}</span></p><p><b>Conductor</b><span>${driverName(route.driverId)}</span></p><p><b>Sectores</b><span>${route.sectors.join(', ')}</span></p><p><b>Inicio</b><span>${route.started}</span></p><p><b>Programada</b><span>${route.scheduled}</span></p><p><b>Tiempo estimado</b><span>${route.estimatedMinutes} min</span></p><p><b>Distancia demo</b><span>${route.distanceKm} km</span></p><p><b>Paradas</b><span>${route.covered} completadas · ${route.pending} pendientes</span></p>${householdEstimateRow}</div>
    ${assignAction}${completeAction}${reoptimizeAction}
    ${progress(route.progress)}<p><strong>${route.progress}%</strong> completado</p><h3>Incidencias</h3>${relatedIncidents.map((incident) => `<button class="incident-row" data-incident="${incident.code}">${incident.type} · ${incident.status}</button>`).join('') || '<p>Sin incidencias demo.</p>'}
    <h3>Timeline operativo</h3><div class="timeline">${routeFlow.map((step) => `<p>${step === route.status ? '●' : '○'} ${label(step)}</p>`).join('')}</div>
    ${reoptimizationPreview}`;
}
function renderIncidentDetail(incident) { return `<div class="drawer-head"><p class="eyebrow">Incidencia operativa demo</p><h2>${incident.type}</h2>${pill('open')}</div><p><b>Folio:</b> ${incident.id}</p><p><b>Sector:</b> ${incident.sector}</p><p><b>Prioridad:</b> ${incident.priority}</p><p><b>Estado:</b> ${incident.status}</p><p>${incident.detail}</p><p class="demo">${demoNotice}</p>`; }

function renderMunicipal() { return `<section id="municipal" class="section card"><h2>Panel municipal</h2><p class="demo">${demoNotice} · Municipio piloto configurable: ${pilotMunicipality.name}, ${pilotMunicipality.country}</p><div class="controls"><input id="search" placeholder="Buscar ruta, camión o sector"><select id="sectorFilter"><option value="">Todos los sectores</option>${sectors.map((s) => `<option>${s.name}</option>`).join('')}</select></div><div class="panel-grid"><div><h3>Rutas del día</h3><div class="list" id="routeList">${renderRoutes(routes)}</div></div><div><h3>Vehículos demo</h3><div id="vehicleList">${renderVehicleList()}</div></div><div><h3>Incidencias en mapa</h3>${incidents.map((incident) => `<button class="row selectable${incident.code === selectedIncidentId ? ' selected' : ''}" data-incident="${incident.code}"><span>${incident.type}<br>${incident.sector}</span>${pill('open')}</button>`).join('')}</div></div>${renderFleetManagement()}${renderCreateRoute()}</section>`; }
function renderVehicleList() { return trucks.map((truck) => `<button class="row selectable${truck.id === selectedTruckId ? ' selected' : ''}" data-truck="${truck.id}"><span>${truckIcon(truck)} ${truck.unit}<br>${driverName(truck.driverId)}</span>${pill(truck.state)}</button>`).join(''); }
// SW-032: the "Crear cuenta de acceso" button only makes sense once Supabase is configured (it
// calls a real Edge Function, see supabase/functions/create-driver-account) and only for a driver
// that has an email on file and no account yet — readSupabaseConfig() is the same opt-in check
// frontend/auth-gate.js already uses, reused here rather than reimplemented.
function renderDriverList() {
  const supabaseConfigured = Boolean(readSupabaseConfig());
  return drivers.map((driver) => {
    const canProvision = supabaseConfigured && driver.email && driver.real_id && !driver.profile_id;
    const accountButton = canProvision ? `<button type="button" data-fleet-driver-account="${driver.id}">Crear cuenta de acceso</button>` : '';
    const accountPill = driver.profile_id ? pill('active') : '';
    return `<div class="row"><span>${driver.name}<br>${driver.phone || 'Sin teléfono'}</span>${pill(driver.status === 'Disponible' ? 'active' : 'assigned')}${accountPill}${accountButton}</div>`;
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
function renderFleetManagement() {
  return `<div class="card" id="fleetManagement">
    <h3>Flota y personal</h3>
    <p class="demo">${demoNotice} · Alta de vehículos y choferes. El chofer queda registrado sin cuenta de acceso todavía.</p>
    <div class="panel-grid">
      <div>
        <h4>Nuevo vehículo</h4>
        <div class="controls"><input id="fleetVehicleUnit" placeholder="Unidad (p. ej. SW-LS-07)"><input id="fleetVehiclePlate" placeholder="Matrícula"><input id="fleetVehicleMaxStops" type="number" min="1" placeholder="Paradas máx. por viaje" value="20"></div>
        <div class="controls"><button type="button" data-fleet="create-vehicle">Registrar vehículo</button></div>
        <p id="fleetVehicleStatus" class="demo"></p>
      </div>
      <div>
        <h4>Nuevo chofer</h4>
        <div class="controls"><input id="fleetDriverName" placeholder="Nombre del chofer"><input id="fleetDriverPhone" placeholder="Teléfono"><input id="fleetDriverEmail" type="email" placeholder="Correo (para cuenta de acceso, opcional)"></div>
        <div class="controls"><button type="button" data-fleet="create-driver">Registrar chofer</button></div>
        <p id="fleetDriverStatus" class="demo"></p>
        <div class="list" id="driverList">${renderDriverList()}</div>
      </div>
    </div>
  </div>`;
}
function refreshFleetSelects() {
  const createRouteVehicleSelect = $('#createRouteVehicle');
  if (createRouteVehicleSelect) createRouteVehicleSelect.innerHTML = `<option value="">Sin vehículo asignado (asignar después)</option>${trucks.filter((truck) => !truck.routeId).map((truck) => `<option value="${truck.id}">${truck.unit}</option>`).join('')}`;
  const vehicleList = $('#vehicleList');
  if (vehicleList) vehicleList.innerHTML = renderVehicleList();
  const driverList = $('#driverList');
  if (driverList) driverList.innerHTML = renderDriverList();
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
async function createVehicleFromForm() {
  const unitInput = $('#fleetVehicleUnit'); const plateInput = $('#fleetVehiclePlate'); const maxStopsInput = $('#fleetVehicleMaxStops'); const status = $('#fleetVehicleStatus');
  const unit = unitInput?.value.trim();
  if (!unit) { if (status) status.textContent = 'Ingresa una unidad para el vehículo.'; return; }
  const plate = plateInput?.value.trim() ?? ''; const maxStops = Number(maxStopsInput?.value) || DEFAULT_MAX_STOPS;
  const created = operationsAdapter.createVehicle({ unit, name: unit, plate, max_stops: maxStops });
  trucks.push(created);
  if (unitInput) unitInput.value = ''; if (plateInput) plateInput.value = ''; if (maxStopsInput) maxStopsInput.value = '20';
  if (status) status.textContent = `Vehículo "${created.unit}" registrado.`;
  refreshFleetSelects();
  // Same real-id linking as drivers below — a real vehicles row gets its own Postgres id, kept on
  // the demo-shaped truck object so a later route assignment can reference the real row too.
  const realVehicle = await mirrorToRealAdapter(realAdapter?.createVehicle({ code: unit, plate, max_stops: maxStops }), status);
  if (realVehicle) created.real_id = realVehicle.id;
}
async function createDriverFromForm() {
  const nameInput = $('#fleetDriverName'); const phoneInput = $('#fleetDriverPhone'); const emailInput = $('#fleetDriverEmail'); const status = $('#fleetDriverStatus');
  const name = nameInput?.value.trim();
  if (!name) { if (status) status.textContent = 'Ingresa un nombre para el chofer.'; return; }
  const email = emailInput?.value.trim() || undefined;
  const created = operationsAdapter.createDriver({ name, phone: phoneInput?.value.trim() ?? '', email });
  drivers.push(created);
  if (nameInput) nameInput.value = ''; if (phoneInput) phoneInput.value = ''; if (emailInput) emailInput.value = '';
  if (status) status.textContent = `Chofer "${created.name}" registrado (sin cuenta de acceso todavía).`;
  refreshFleetSelects();
  // The real drivers row gets its own id (a Postgres uuid, never the same as the demo id above) —
  // createDriverAccount() needs THAT id to call the Edge Function against a row that actually
  // exists in Supabase, so it's kept on the demo-shaped object rather than discarded.
  const realDriver = await mirrorToRealAdapter(realAdapter?.createDriver({ display_name: name }), status);
  if (realDriver) created.real_id = realDriver.id;
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
  if (status) status.textContent = data.invite_action_link ? `Cuenta creada para "${driver.name}". Enlace de invitación: ${data.invite_action_link}` : `Cuenta creada para "${driver.name}".`;
  refreshFleetSelects();
}
// SW-027: municipal_admin/supervisor/dispatcher only in real Supabase (RLS: tenant_insert_staff on
// routes and, per 202607150009_sw027_route_paths.sql, on route_paths too — same 3 roles as
// route_stops writes). This demo UI has no live Supabase session/role gating (frontend/app.js has
// always used the in-memory operationsAdapter, never createSupabaseOperationsAdapter — see
// supabase/README.md), so there's nothing here to restrict by role client-side; the restriction is
// real once this UI is pointed at Supabase.
function renderCreateRoute() {
  const availableTrucks = trucks.filter((truck) => !truck.routeId);
  return `<div class="card" id="createRoute">
    <h3>Crear ruta</h3>
    <p class="demo">${demoNotice} · Clic en el mapa para agregar puntos al trazo, en orden. Al finalizar se intenta ajustar el trazo a calles reales (OSRM); si no es posible, se usa línea recta entre los puntos. Opcionalmente, puedes optimizar el orden de las paradas (excepto la primera) para minimizar la distancia recorrida antes de ajustar a calles.</p>
    <div class="controls"><input id="createRouteName" placeholder="Nombre de la ruta"><select id="createRouteVehicle"><option value="">Sin vehículo asignado (asignar después)</option>${availableTrucks.map((t) => `<option value="${t.id}">${t.unit}</option>`).join('')}</select></div>
    <div class="controls"><label><input type="checkbox" id="createRouteOptimize"> Optimizar orden de paradas (mantiene el primer punto como inicio)</label></div>
    <div id="createRouteMap" class="real-map driver-map" role="application" aria-label="Dibujar trazo de ruta nueva"></div>
    <div class="controls"><button type="button" data-create-route="undo">Deshacer último punto</button><button type="button" data-create-route="finish">Finalizar y guardar</button></div>
    <p id="createRouteStatus" class="demo">${drawnRoutePoints.length} punto(s) trazado(s).</p>
    <p id="createRouteTripPreview" class="demo"></p>
  </div>`;
}
function renderDriverMobile() {
  const truck = trucks.find((item) => item.id === driverVehicleId);
  return `<div class="mobile" id="driverMobile">
    <select id="driverVehicleSelect" aria-label="Vehículo del conductor">${trucksWithRoute.map((t) => `<option value="${t.id}" ${t.id === driverVehicleId ? 'selected' : ''}>${t.unit}</option>`).join('')}</select>
    <p id="driverRouteInfo">${pill(truck.state)} ${routeName(truck.routeId)} · ${truck.progress}% completado</p>
    <p id="driverStopsProgress"></p>
    <div id="driverMap" class="real-map driver-map" role="application" aria-label="Posición y trazo del vehículo (demo)"></div>
    <p class="demo">${simulationNotice} · trazo histórico vía polling cada ${DRIVER_POLL_INTERVAL_MS / 1000}s (sin Realtime, ver docs/TECHNICAL_DEBT_REGISTER.md #14)</p>
    ${backendMode !== 'DEMO_ONLY' ? renderDriverGpsControl() : ''}
  </div>`;
}
function renderDriverGpsControl() {
  return `<div class="controls"><button type="button" data-driver-gps="${driverGpsWatchId ? 'stop' : 'start'}">${driverGpsWatchId ? 'Detener GPS real' : 'Compartir mi ubicación real'}</button></div><p id="driverGpsStatus" class="demo"></p>`;
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
    const result = await telemetry.ingest(position, { correlation_id: `gps-${now.toString(36)}` });
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
function renderRoutes(items) { return items.map((route) => `<article class="row selectable${route.id === selectedRouteId ? ' selected' : ''}" data-route="${route.id}"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ETA ${route.eta}<br>${progress(route.progress)}</div><div>${pill(routeStatus(route))}<br>${route.covered}/${route.stops} paradas</div></article>`).join(''); }
function renderSupervisor() {
  const pendingVerification = routes.filter((route) => route.status === 'completed');
  const openIncidents = incidents.filter((incident) => incident.status !== 'Cerrada');
  return `<section id="supervisor" class="section card"><h2>Panel de supervisor</h2><p class="demo">${demoNotice} · Verificación de rutas completadas y gestión de incidencias. Acciones de esta vista son demo local (no escriben contra Supabase todavía).</p><div class="panel-grid">
    <div><h3>Rutas pendientes de verificación</h3>${pendingVerification.length ? pendingVerification.map((route) => `<article class="row"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ${route.progress}% completado</div><div>${pill('completed')}<button data-verify-route="${route.id}">Verificar</button></div></article>`).join('') : '<p>No hay rutas completadas pendientes de verificación.</p>'}</div>
    <div><h3>Incidencias abiertas</h3>${openIncidents.length ? openIncidents.map((incident) => `<article class="row"><div><strong>${incident.type}</strong><br>${incident.sector} · ${incident.priority}</div><div>${pill('open')}<button data-resolve-incident="${incident.code}">Marcar resuelta</button></div></article>`).join('') : '<p>Sin incidencias abiertas.</p>'}</div>
  </div></section>`;
}
function renderCitizen() { return `<section id="ciudadania" class="section card"><h2>Portal ciudadano</h2><p class="demo">${demoNotice}</p><div class="panel-grid"><div><h3>Consulta de recogida</h3><select id="citizenSector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><p id="pickupResult"></p><h3>Avisos municipales</h3>${notifications.map((n) => `<div class="row">🔔 ${n}</div>`).join('')}</div><form id="incidentForm"><h3>Reportar incidencia</h3><select name="type"><option>Basura no recogida</option><option>Vertedero improvisado</option></select><select name="sector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><textarea name="description" placeholder="Descripción demo"></textarea><input id="manualAddress" name="address" placeholder="Dirección manual si no usa GPS"><button type="button" id="useGeo">Usar ubicación GPS del navegador</button><p id="geoStatus" class="demo">GPS requiere permiso del usuario.</p><input id="evidence" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" aria-label="Adjuntar evidencia demo"><p id="evidencePreview" class="demo">Evidencia local; no upload real verificado.</p><button>Obtener folio</button><p id="folio"></p></form><div><h3>Consultar estado</h3><input id="folioSearch" value="SW-FOLIO-1001"><button id="checkFolio">Consultar</button><p id="folioStatus"></p><h3>Futura relación</h3><p>Preparado para Chatbot Municipal: preguntas frecuentes, folios y avisos por sector.</p></div></div></section>`; }

const money = (value) => `RD$ ${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
const num = (value, suffix = '') => `${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 1 })}${suffix}`;
function bar(value, max = 100) { return `<span class="mini-bar"><i style="width:${Math.min(100, Math.max(0, (value / max) * 100))}%"></i></span>`; }
function renderImpactCenter(assumptions = defaultImpactAssumptions, filters = {}) {
  const metrics = calculateImpactMetrics(assumptions, filters);
  const kpis = [
    ['Rutas planificadas', metrics.routes.planned], ['Asignadas', metrics.routes.assigned], ['Iniciadas', metrics.routes.started], ['En progreso', metrics.routes.inProgress], ['Retrasadas', metrics.routes.delayed], ['Completadas', metrics.routes.completed], ['Verificadas', metrics.routes.verified], ['Cumplimiento', `${metrics.routes.complianceRate}%`], ['Puntualidad', `${metrics.routes.punctualityRate}%`], ['Progreso promedio', `${metrics.routes.progressAverage}%`],
    ['Sectores planificados', metrics.coverage.plannedSectors], ['Sectores atendidos', metrics.coverage.attendedSectors], ['Cobertura', `${metrics.coverage.coverageRate}%`], ['Pendientes', metrics.coverage.pendingSectors],
    ['Vehículos totales', metrics.fleet.total], ['Activos', metrics.fleet.active], ['Detenidos', metrics.fleet.stopped], ['Retrasados', metrics.fleet.delayed], ['Offline', metrics.fleet.offline], ['Mantenimiento', metrics.fleet.maintenance], ['Disponibilidad', `${metrics.fleet.availabilityRate}%`], ['Utilización', `${metrics.fleet.utilizationRate}%`],
    ['Incidencias abiertas', metrics.incidents.open], ['Incidencias resueltas', metrics.incidents.resolved], ['Resolución promedio', `${metrics.incidents.avgResolutionHours} h`], ['Reincidencias demo', metrics.incidents.recurrenceDemo],
    ['Km recorridos', `${metrics.operation.distanceKm} km`], ['Km productivos est.', `${metrics.operation.productiveKm} km`], ['Km potencialmente evitados', `${metrics.operation.avoidedKm} km`], ['Horas operativas', `${metrics.operation.operatingHours} h`], ['Tiempo detenido', `${metrics.operation.stoppedHours} h`], ['Tiempo improductivo est.', `${metrics.operation.unproductiveHours} h`]
  ];
  return `<section id="impacto" class="section impact-center card">
    <div class="impact-hero"><div><p class="eyebrow">Centro de Impacto Operacional</p><h2>Impacto y Ahorros</h2><p class="impact-notice">${IMPACT_DEMO_NOTICE}</p></div><div><strong>Ahorro potencial estimado mensual</strong><b>${money(metrics.economics.monthlyPotentialAvoided)}</b><span>Proyección anual demo: ${money(metrics.economics.annualProjectionDemo)}</span></div></div>
    <div class="impact-filters" aria-label="Filtros demo"><select id="impactPeriod"><option>Hoy</option><option>Últimos 7 días</option><option>Últimos 30 días</option><option>Trimestre</option><option>Año</option><option>Rango personalizado preparado</option></select><select id="impactSector"><option value="">Todos los sectores</option>${sectors.map((s)=>`<option>${s.name}</option>`).join('')}</select><select id="impactRoute"><option value="">Todas las rutas</option>${routes.map((r)=>`<option value="${r.id}">${r.name}</option>`).join('')}</select><select id="impactVehicle"><option value="">Todos los vehículos</option>${trucks.map((t)=>`<option value="${t.id}">${t.unit}</option>`).join('')}</select><select id="impactStatus"><option value="">Todos los estados</option>${['assigned','in_progress','delayed','completed','verified','active','stopped','offline'].map((st)=>`<option value="${st}">${label(st)}</option>`).join('')}</select></div>
    <div class="kpis impact-kpis">${kpis.map(([name,value])=>`<div class="kpi"><strong>${value}</strong><br>${name}</div>`).join('')}</div>
    <div class="municipal-360"><article><h3>Servicio</h3><p>${metrics.routes.planned} rutas · ${metrics.coverage.coverageRate}% cobertura · ${metrics.routes.complianceRate}% cumplimiento · ${metrics.coverage.attendedSectors} sectores atendidos.</p></article><article><h3>Operación</h3><p>${metrics.fleet.total} vehículos · ${metrics.operation.distanceKm} km · ${metrics.routes.delayed} retrasos · ${metrics.incidents.open} incidencias abiertas.</p></article><article><h3>Eficiencia</h3><p>${metrics.efficiency.optimizedHours} h optimizadas · ${metrics.efficiency.avoidedKm} km potencialmente evitados · ${metrics.efficiency.fuelSavedLiters} L potencialmente optimizados.</p></article><article><h3>Impacto económico</h3><p>${money(metrics.economics.monthlyPotentialAvoided)} mensual potencial · ${money(metrics.economics.annualProjectionDemo)} anual demo · supuestos visibles abajo.</p></article></div>
    <div class="impact-grid"><article><h3>Supuestos configurables</h3><label>Precio combustible RD$/L <input id="fuelPrice" type="number" value="${defaultImpactAssumptions.fuelPrice}"></label><label>Rendimiento km/L <input id="fuelEfficiency" type="number" step="0.1" value="${defaultImpactAssumptions.fuelEfficiency}"></label><label>Días operativos <input id="operatingDays" type="number" value="${defaultImpactAssumptions.operatingDays}"></label><label>Costo operativo por hora <input id="hourlyCost" type="number" value="${defaultImpactAssumptions.hourlyCost}"></label><p class="demo">Distancia base: ${defaultImpactAssumptions.baseDistanceKm} km · distancia actual simulada: ${defaultImpactAssumptions.currentDistanceKm} km · horas operativas: ${defaultImpactAssumptions.operatingHours} h.</p></article><article id="impactEconomics">${renderImpactEconomics(metrics)}</article></div>
    <div class="impact-grid"><article><h3>Visualizaciones operativas</h3>${renderImpactBars(metrics)}</article><article><h3>Antes del sistema vs. con SmartWaste</h3><p class="impact-notice small">${IMPACT_SCENARIO_NOTICE}</p>${renderBeforeAfter(metrics)}</article></div>
    <div class="impact-grid"><article><h3>Integración futura con datos reales</h3>${Object.entries(metricReadiness).map(([k,v])=>`<p><b>${k}</b>: ${v.join(', ')}</p>`).join('')}</article><article><h3>Incidencias y sectores</h3><p>Categorías: ${Object.entries(metrics.incidents.byCategory).map(([k,v])=>`${k} (${v})`).join(' · ')}</p><p>Sectores: ${Object.entries(metrics.incidents.bySector).map(([k,v])=>`${k} (${v})`).join(' · ')}</p><p>Zonas con más incidencias: ${metrics.coverage.topIncidentZones.map((z)=>`${z.name} (${z.incidents})`).join(' · ')}</p></article></div>
  </section>`;
}
function currentImpactAssumptions(){ return { ...defaultImpactAssumptions, fuelPrice: Number($('#fuelPrice')?.value ?? defaultImpactAssumptions.fuelPrice), fuelEfficiency: Number($('#fuelEfficiency')?.value ?? defaultImpactAssumptions.fuelEfficiency), operatingDays: Number($('#operatingDays')?.value ?? defaultImpactAssumptions.operatingDays), hourlyCost: Number($('#hourlyCost')?.value ?? defaultImpactAssumptions.hourlyCost) }; }
function currentImpactFilters(){ return { sector: $('#impactSector')?.value || '', route: $('#impactRoute')?.value || '', vehicle: $('#impactVehicle')?.value || '', status: $('#impactStatus')?.value || '', period: $('#impactPeriod')?.value || 'Hoy' }; }
function renderImpactEconomics(m){return `<h3>Impacto económico estimado</h3><p><b>${num(m.efficiency.fuelSavedLiters,' L')}</b> combustible potencialmente optimizado.</p><p><b>${money(m.economics.monthlyPotentialAvoided)}</b> costo mensual potencialmente evitado.</p><p><b>${money(m.economics.annualProjectionDemo)}</b> proyección anual demo.</p><p><b>${num(m.efficiency.avoidedKm,' km')}</b> kilómetros potencialmente evitados · <b>${num(m.efficiency.optimizedHours,' h')}</b> horas operativas potencialmente optimizadas.</p><p><b>${money(m.economics.incidentCostAvoided)}</b> costo potencial por incidencias evitadas con supuesto configurable válido.</p><p class="demo">Ahorro potencial estimado; no es ahorro garantizado ni resultado real.</p>`}
function renderImpactBars(m){return [...m.coverage.bySector.map((s)=>`${s.name} cobertura ${s.coverage}% ${bar(s.coverage)}`),`Cumplimiento rutas ${m.routes.complianceRate}% ${bar(m.routes.complianceRate)}`,`Estado flota activa ${m.fleet.availabilityRate}% ${bar(m.fleet.availabilityRate)}`,`Kilómetros productivos ${m.operation.productiveKm}/${m.operation.distanceKm} ${bar(m.operation.productiveKm,m.operation.distanceKm)}`,`Combustible optimizado ${m.efficiency.fuelSavedLiters} L ${bar(m.efficiency.fuelSavedLiters,3)}`,`Ahorro mensual/anual ${money(m.economics.monthlyPotentialAvoided)} / ${money(m.economics.annualProjectionDemo)} ${bar(m.economics.monthlyPotentialAvoided,m.economics.annualProjectionDemo/6)}`].map(x=>`<p>${x}</p>`).join('')}
function renderBeforeAfter(m){return `<div class="comparison-table">${m.beforeAfter.map((r)=>`<p><b>${r.label}</b><span>Antes: ${r.before} ${r.unit} · SmartWaste: ${r.after} ${r.unit}</span><small>Diferencia: ${r.absolute} ${r.unit} · variación: ${r.variation}%${r.reduction!==null?` · reducción: ${r.reduction}%`:''}${r.points!==null?` · ${r.points} puntos porcentuales`:''}</small></p>`).join('')}</div>`}

function renderMaster() { return `<section id="master" class="section card"><h2>Master Admin MT IT Services</h2><p class="demo">${demoNotice}</p><div class="panel-grid">${municipalities.map((m) => `<article class="card"><h3>${m.name}</h3><p>Plan: ${m.plan}</p><p>Camiones: ${m.trucks} · Rutas: ${m.routes} · Usuarios: ${m.users}</p>${pill(m.status.toLowerCase().includes('operativo') ? 'active' : 'assigned')}<button data-onboarding="${m.id}">Onboarding demo</button><p class="demo" data-onboarding-status="${m.id}"></p></article>`).join('')}</div><h3>Arquitectura futura</h3><p>${pilotMunicipality.integrationsReady.join(' · ')}</p></section>`; }

app.innerHTML = `${renderMap()}${renderMunicipal()}${renderSupervisor()}${renderDriverSection()}${renderCitizen()}${renderImpactCenter()}${renderMaster()}`;

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
  visibleTrucks.forEach((truck) => {
    const marker = L.marker(routePosition({ ...truck, positionIndex: simState[truck.id]?.index ?? truck.positionIndex }), { icon: L.divIcon({ className: 'leaflet-truck', html: truckIcon(truck), iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map).on('click', () => selectTruck(truck.id));
    truckMarkers.push(marker);
  });
  visibleIncidents.forEach((incident) => { incidentMarkers.push(L.marker(incident.position, { icon: L.divIcon({ className: 'leaflet-incident', html: `<span>⚠<small>${incident.type}</small></span>`, iconSize: [90, 34] }) }).addTo(map).on('click', () => selectIncident(incident.code))); });
  if (focusRoute) map.fitBounds(routeGeometry(focusRoute.id), { padding: [40, 40] });
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

// SW-027: registers a truck the driver view didn't know about at page load (one just assigned to a
// newly created route) — same DeviceSimulator/positionHistory machinery every other truck already
// goes through, just triggered later instead of at module load.
function registerDriverSimulator(truck) {
  if (driverSimulators[truck.id]) return;
  const simulator = new DeviceSimulator(truck.id, { getPath: () => routeGeometry(truck.routeId) });
  simulator.index = truck.positionIndex ?? 0;
  driverSimulators[truck.id] = simulator;
  if (!trucksWithRoute.some((item) => item.id === truck.id)) trucksWithRoute.push(truck);
  positionHistory.record(simulator.start());
  const select = $('#driverVehicleSelect');
  if (select) select.innerHTML = trucksWithRoute.map((item) => `<option value="${item.id}" ${item.id === driverVehicleId ? 'selected' : ''}>${item.unit}</option>`).join('');
}
// Single place that assigns a vehicle to a route — used both by finishCreateRoute() (assignment at
// creation time) and assignVehicleToExistingRoute() (below, for a route created without one). Fixes
// a real bug found while adding the latter: route.truckId was never actually set on assignment
// (only truck.routeId was), so the detail panel always showed "Sin asignar" even for routes
// assigned at creation.
async function assignTruckToRoute(route, truck) {
  operationsAdapter.assignVehicle(route.id, truck.id);
  route.truckId = truck.unit;
  if (route.status === 'planned') route.status = 'assigned';
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
  selectRoute(routeId); // re-render the detail panel so it reflects the new assignment immediately
  $('#routeList').innerHTML = renderRoutes(routes);
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
  const stops = operationsAdapter.listRouteStops(routeId);
  const doneCount = Math.floor(stops.length * (route.progress ?? 0) / 100);
  const pendingStops = stops.slice(doneCount);
  // Same pattern drawMapLayers() (above) uses for a truck's live marker position — truck.positionIndex
  // itself is never updated by the simulation tick, only simState[truck.id].index is.
  const currentPosition = routePosition({ ...truck, positionIndex: simState[truck.id]?.index ?? truck.positionIndex });
  routeReoptimizationPreview = { routeId, ...suggestReoptimizedOrder(currentPosition, pendingStops) };
  selectRoute(routeId);
}
// Triggered from renderRouteDetail()'s "Marcar como completada" action — startSimulation()'s tick
// caps progress at 99 (Math.min(99, ...)), so nothing else ever transitions a route to 'completed';
// without this, a route could run in the demo forever and never reach Supervisor's verification
// queue (renderSupervisor()'s pendingVerification list, gated on status === 'completed').
async function completeRouteManually(routeId) {
  const route = routeById(routeId);
  if (!route) return;
  route.status = 'completed'; route.progress = 100;
  operationsAdapter.completeRoute(routeId);
  const truck = trucks.find((item) => item.routeId === routeId);
  if (truck) { truck.state = 'completed'; truck.progress = 100; }
  selectRoute(routeId);
  $('#routeList').innerHTML = renderRoutes(routes);
  // Supervisor's "pendientes de verificación" queue is only re-rendered on demand (same as the
  // existing verify/resolve-incident handlers do) — without this it stays stale showing whatever
  // was true when #supervisor was last rendered, even though route.status just changed above.
  $('#supervisor').outerHTML = renderSupervisor();
  if (realAdapter) {
    const realRouteId = route.real_id ?? routeId;
    await mirrorToRealAdapter(realAdapter.completeRoute(realRouteId));
  }
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
// child of #app, in a fixed order (mapa, municipal, supervisor, ciudadania, impacto, master) — no
// change needed there, this only toggles which one has the existing `.hidden` class.
const SECTION_IDS = Array.from(app.children).map((section) => section.id);
function sectionFromHash() {
  const id = location.hash.slice(1);
  return SECTION_IDS.includes(id) ? id : SECTION_IDS[0];
}
function showSection(id) {
  Array.from(app.children).forEach((section) => section.classList.toggle('hidden', section.id !== id));
  document.querySelectorAll('.topbar nav a').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  // Leaflet sizes itself against its container's dimensions at creation time; a container that was
  // display:none when its map was built reports zero size, leaving the map visibly cut off/blank
  // until told to recalculate. invalidateSize() on every switch into a tab (not just the first)
  // keeps it correct regardless of load order/timing.
  if (id === 'mapa' && mapReady) requestAnimationFrame(() => map.invalidateSize());
  // driverMap moved out of #municipal into its own #conductor section (item #12) — createRouteMap
  // stayed put, so this split into two separate checks.
  if (id === 'municipal' && createRouteMapReady) requestAnimationFrame(() => createRouteMap.invalidateSize());
  if (id === 'conductor' && driverMapReady) requestAnimationFrame(() => driverMap.invalidateSize());
}
window.addEventListener('hashchange', () => showSection(sectionFromHash()));
// Selecting a truck/route/incident updates #detail and the map, but both live inside the "mapa"
// section — invisible while the click came from another tab (e.g. the route list in "municipal").
// Jumping to "mapa" on selection is what actually shows the user the result of their click. Only
// called from the real click handler below, never from selectTruck()/selectRoute()/selectIncident()
// themselves, since the simulation loop re-calls those every tick just to refresh the open detail
// panel — doing it there would yank the user back to "mapa" every ~2s even after they navigate away.
function goToMapTab() {
  if (location.hash.slice(1) === 'mapa') showSection('mapa');
  else location.hash = 'mapa';
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

  drawnRoutePoints = [];
  redrawCreateRouteTrace();
  if (nameInput) nameInput.value = '';
  if (vehicleSelect) vehicleSelect.innerHTML = `<option value="">Sin vehículo asignado (asignar después)</option>${trucks.filter((item) => !item.routeId).map((item) => `<option value="${item.id}">${item.unit}</option>`).join('')}`;
  $('#routeList').innerHTML = renderRoutes(routes);
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
}
function closeDetail() { const detail = $('#detail'); detail.classList.add('is-hidden'); detail.setAttribute('aria-hidden', 'true'); detail.innerHTML = ''; selectedTruckId = null; selectedRouteId = null; selectedIncidentId = null; drawMapLayers(); markSelection(); }
function selectTruck(id) { selectedTruckId = id; selectedRouteId = null; selectedIncidentId = null; const truck = trucks.find((item) => item.id === id); openDetail(renderTruckDetail(truck)); drawMapLayers(); markSelection(); }
function selectRoute(id) { if (routeReoptimizationPreview?.routeId !== id) routeReoptimizationPreview = null; selectedRouteId = id; selectedTruckId = null; selectedIncidentId = null; const route = routeById(id); openDetail(renderRouteDetail(route)); drawMapLayers(); markSelection(); }
function selectIncident(code) { selectedIncidentId = code; selectedTruckId = null; selectedRouteId = null; const incident = incidents.find((item) => item.code === code); openDetail(renderIncidentDetail(incident)); drawMapLayers(); markSelection(); }
function startSimulation() { if (simulationTimer) return; simulationTimer = setInterval(() => { trucks.filter((truck) => truck.routeId && truck.state !== 'offline' && truck.state !== 'completed').forEach((truck) => { const path = routeGeometry(truck.routeId); simState[truck.id].index = (simState[truck.id].index + 1) % path.length; simState[truck.id].progress = Math.min(99, simState[truck.id].progress + 3); truck.progress = simState[truck.id].progress; truck.updatedAt = 'Ahora (simulación)'; truck.sector = routeById(truck.routeId)?.sector ?? truck.sector; const route = routeById(truck.routeId); if (route) route.progress = truck.progress; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }, 1800 / simulationSpeed); }
function pauseSimulation() { clearInterval(simulationTimer); simulationTimer = null; }
function resetSimulation() { pauseSimulation(); trucks.forEach((truck) => { const original = initialTruckState[truck.id]; simState[truck.id] = { index: original.index, progress: original.progress }; truck.progress = original.progress; truck.updatedAt = original.updatedAt; truck.sector = original.sector; }); routes.forEach((route) => { if (initialRouteProgress[route.id] !== undefined) route.progress = initialRouteProgress[route.id]; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-detail]')) { closeDetail(); return; }
  const createRouteAction = event.target.closest('[data-create-route]')?.dataset.createRoute;
  if (createRouteAction === 'undo') undoLastRoutePoint();
  if (createRouteAction === 'finish') finishCreateRoute();
  const fleetAction = event.target.closest('[data-fleet]')?.dataset.fleet;
  if (fleetAction === 'create-vehicle') createVehicleFromForm();
  if (fleetAction === 'create-driver') createDriverFromForm();
  const driverAccountButton = event.target.closest('[data-fleet-driver-account]');
  if (driverAccountButton) createDriverAccount(driverAccountButton.dataset.fleetDriverAccount);
  const truckButton = event.target.closest('[data-truck]'); if (truckButton) { selectTruck(truckButton.dataset.truck); goToMapTab(); }
  const routeButton = event.target.closest('[data-route]'); if (routeButton?.dataset.route) { selectRoute(routeButton.dataset.route); goToMapTab(); }
  const incidentButton = event.target.closest('[data-incident]'); if (incidentButton) { selectIncident(incidentButton.dataset.incident); goToMapTab(); }
  const verifyButton = event.target.closest('[data-verify-route]');
  if (verifyButton) { const route = routeById(verifyButton.dataset.verifyRoute); if (route) { route.status = 'verified'; $('#supervisor').outerHTML = renderSupervisor(); } }
  const assignVehicleButton = event.target.closest('[data-assign-vehicle]');
  if (assignVehicleButton) { const vehicleId = $('#assignVehicleSelect')?.value; if (vehicleId) assignVehicleToExistingRoute(assignVehicleButton.dataset.assignVehicle, vehicleId); }
  const completeRouteButton = event.target.closest('[data-complete-route]');
  if (completeRouteButton) completeRouteManually(completeRouteButton.dataset.completeRoute);
  const reoptimizeButton = event.target.closest('[data-reoptimize-route]');
  if (reoptimizeButton) previewRouteReoptimization(reoptimizeButton.dataset.reoptimizeRoute);
  const resolveButton = event.target.closest('[data-resolve-incident]');
  if (resolveButton) { const incident = incidents.find((item) => item.code === resolveButton.dataset.resolveIncident); if (incident) { incident.status = 'Cerrada'; $('#supervisor').outerHTML = renderSupervisor(); } }
  const onboardButton = event.target.closest('[data-onboarding]');
  if (onboardButton) { const status = document.querySelector(`[data-onboarding-status="${onboardButton.dataset.onboarding}"]`); if (status) status.textContent = 'Onboarding demo iniciado — flujo completo en desarrollo.'; }
  if (event.target.id === 'useGeo') { requestGeolocation(); }
  const driverGpsAction = event.target.closest('[data-driver-gps]')?.dataset.driverGps;
  if (driverGpsAction === 'start') startDriverGps();
  if (driverGpsAction === 'stop') stopDriverGps();
  if (event.target.id === 'checkFolio') { const found = findIncidentStatus($('#folioSearch').value); $('#folioStatus').textContent = found ? `${found.type}: ${found.status}` : 'Folio demo no encontrado'; }
  const sim = event.target.dataset.sim; if (sim === 'start') startSimulation(); if (sim === 'pause') pauseSimulation(); if (sim === 'reset') resetSimulation(); if (sim === 'fullscreen') toggleMapFullscreen(); if (sim === 'speed') { simulationSpeed = simulationSpeed === 1 ? 2 : simulationSpeed === 2 ? 4 : 1; event.target.textContent = `${simulationSpeed}×`; if (simulationTimer) { pauseSimulation(); startSimulation(); } }
});
document.addEventListener('change', (event) => { if (event.target.closest('#impacto') && event.target.matches('select')) { $('#impacto').outerHTML = renderImpactCenter(currentImpactAssumptions(), currentImpactFilters()); } });
$('#search').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); $('#routeList').innerHTML = renderRoutes(routes.filter((route) => JSON.stringify(route).toLowerCase().includes(term))); });
$('#sectorFilter').addEventListener('change', (event) => { $('#routeList').innerHTML = renderRoutes(routes.filter((route) => !event.target.value || route.sectors.includes(event.target.value))); });
$('#citizenSector').addEventListener('change', (event) => { const service = findSectorService(event.target.value); $('#pickupResult').textContent = service ? `${service.pickupDay} · Estado: ${service.status}` : 'Sector demo no encontrado'; });
$('#citizenSector').dispatchEvent(new Event('change'));
$('#incidentForm').addEventListener('submit', (event) => { event.preventDefault(); $('#folio').textContent = `Folio generado: ${createDemoFolio(citizenFolioSequence)} (demo · sin upload real)`; citizenFolioSequence += 1; });
document.querySelectorAll('#fuelPrice,#fuelEfficiency,#operatingDays,#hourlyCost').forEach((input) => input.addEventListener('input', () => { const assumptions = { ...defaultImpactAssumptions, fuelPrice: Number($('#fuelPrice').value), fuelEfficiency: Number($('#fuelEfficiency').value), operatingDays: Number($('#operatingDays').value), hourlyCost: Number($('#hourlyCost').value) }; $('#impactEconomics').innerHTML = renderImpactEconomics(calculateImpactMetrics(assumptions)); }));
$('#evidence').addEventListener('change', (event) => { const file = event.target.files?.[0]; const result = validateEvidenceFile(file); $('#evidencePreview').textContent = result.ok ? `${file?.name ?? 'Sin archivo'} · ${result.reason}` : `Evidencia rechazada: ${result.reason}`; });
$('#driverVehicleSelect').addEventListener('change', (event) => {
  driverVehicleId = event.target.value;
  drawDriverPositions(); // also refreshes #driverRouteInfo for the newly selected vehicle
});
function requestGeolocation() { const target = $('#geoStatus'); if (!navigator.geolocation) { target.textContent = 'Ubicación no disponible en este navegador.'; return; } target.textContent = 'Solicitando permiso de ubicación...'; navigator.geolocation.getCurrentPosition((pos) => { target.textContent = `Ubicación recibida localmente: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (no enviada)`; }, (err) => { target.textContent = `Permiso denegado, timeout o ubicación no disponible: ${err.message}`; }, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 }); }
showSection(sectionFromHash());
initMap();
initDriverMap();
initDriverPolling();
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
async function hydrateVehiclesAndDrivers() {
  if (!realAdapter) return;
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
      drivers.push({ id: row.id, real_id: row.id, name: row.display_name, phone: '', status: DRIVER_STATUS_LABELS[row.status] ?? row.status, profile_id: row.profile_id ?? null });
    });
  }
  refreshFleetSelects();
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
  if (!realAdapter) return;
  const routesResult = await realAdapter.listRoutes();
  if (!routesResult.ok) return;
  const routeRunsResult = await realAdapter.listRouteRuns();
  const latestRunByRouteId = {};
  // Ordered oldest-first by the adapter — overwriting as we iterate leaves the most recent
  // route_run per route_id, same "most recent" intent transitionRouteRun() applies per-route.
  if (routeRunsResult.ok) routeRunsResult.data.forEach((run) => { latestRunByRouteId[run.route_id] = run; });

  for (const row of routesResult.data) {
    if (routes.some((route) => route.real_id === row.id)) continue;
    const run = latestRunByRouteId[row.id] ?? null;
    const truck = run?.vehicle_id ? trucks.find((item) => item.real_id === run.vehicle_id) : null;
    const driver = run?.driver_id ? drivers.find((item) => item.real_id === run.driver_id) : null;

    const stopsResult = truck ? await realAdapter.listRouteStopsWithStatus(row.id, truck.real_id) : await realAdapter.listRouteStops(row.id);
    const stopPoints = stopsResult.ok ? stopsResult.data : [];
    const covered = stopPoints.filter((stop) => stop.status === 'recolectado').length;

    const newRoute = {
      id: row.id, real_id: row.id, name: row.name, status: row.status ?? 'planned',
      sectors: ['Sincronizado desde Supabase'], sector: 'Sincronizado desde Supabase',
      truckId: truck ? truck.unit : 'Sin asignar', driverId: driver ? driver.id : null,
      progress: run?.progress ?? 0, scheduled: '—', started: run ? 'Sincronizado' : 'Pendiente', eta: '—',
      distanceKm: 0, estimatedMinutes: '—', stops: stopPoints.length, covered, pending: stopPoints.length - covered, incidents: []
    };
    routes.push(newRoute);
    initialRouteProgress[row.id] = newRoute.progress;

    const pathResult = await realAdapter.listPathPoints(row.id);
    if (pathResult.ok && pathResult.data.length && operationsAdapter.listPathPoints(row.id).length === 0) {
      operationsAdapter.savePathPoints(row.id, pathResult.data.map((point) => ({ sequence: point.sequence, latitude: point.latitude, longitude: point.longitude })));
    }
    if (stopPoints.length && operationsAdapter.listRouteStops(row.id).length === 0) {
      operationsAdapter.saveRouteStops(row.id, stopPoints.map((stop) => ({ sequence: stop.sequence, label: stop.label, latitude: stop.latitude, longitude: stop.longitude })));
    }

    if (truck && !truck.routeId) {
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
}
// SW-034: once a real session resolves (municipality_id known), builds the real adapter that
// createVehicleFromForm/createDriverFromForm/finishCreateRoute mirror their writes to. Patches only
// the "fuente desacoplada" label directly (not a full section re-render) so the already-initialized
// Leaflet map instance is never touched by this.
async function bootstrapRealBackend(ctx) {
  const client = getAuthClient();
  if (!client || !ctx?.municipality_id) return;
  realAdapter = resolveOperationsAdapter({ client, municipality_id: ctx.municipality_id });
  backendMode = realAdapter.mode;
  driverAuthContext = ctx;
  const sourceLabel = document.querySelector('.sim-controls span');
  if (sourceLabel) sourceLabel.textContent = `${simulationNotice} · fuente desacoplada: ${backendMode}`;
  await hydrateVehiclesAndDrivers();
  await hydrateRoutes();
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

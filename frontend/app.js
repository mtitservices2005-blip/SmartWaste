import { demoNotice, simulationNotice, pilotMunicipality, trucks, routes, sectors, drivers, incidents, notifications, municipalities, routeFlow, routePaths, stateLabels } from '../shared/demo-data.js';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const driverName = (id) => drivers.find((driver) => driver.id === id)?.name ?? 'Sin asignar';
const routeById = (id) => routes.find((route) => route.id === id);
const routeName = (id) => routeById(id)?.name ?? 'Sin ruta asignada';
const label = (state) => stateLabels[state] ?? state;
const routePosition = (truck) => truck.position ?? routePaths[truck.routeId]?.[truck.positionIndex ?? 0] ?? pilotMunicipality.center;
let selectedTruckId = trucks[0].id;
let selectedRouteId = trucks[0].routeId;
let selectedIncidentId = null;
let map;
let mapReady = false;
let routeLayers = [];
let truckMarkers = [];
let incidentMarkers = [];
let simulationTimer = null;
let simulationSpeed = 1;
const initialTruckState = Object.fromEntries(trucks.map((truck) => [truck.id, { index: truck.positionIndex ?? 0, progress: truck.progress, updatedAt: truck.updatedAt, sector: truck.sector }]));
const simState = Object.fromEntries(trucks.map((truck) => [truck.id, { index: truck.positionIndex ?? 0, progress: truck.progress }]));

function progress(value) { return `<div class="progress" aria-label="${value}% completado"><i style="width:${value}%"></i></div>`; }
function pill(state) { return `<span class="pill ${state}">${label(state)}</span>`; }
function routeStatus(route) { return route.status === 'completed' || route.status === 'verified' ? 'completed' : route.status; }
function truckIcon(truck) {
  const shapes = { active: '▶', stopped: '■', delayed: '!', offline: '×', completed: '✓' };
  return `<span class="truck-icon ${truck.state}"><b>${shapes[truck.state]}</b><small>${truck.unit.replace('SW-LS-', '')}</small></span>`;
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
        <div class="sim-controls" aria-label="Controles de simulación"><span>${simulationNotice}</span><button data-sim="start">Iniciar</button><button data-sim="pause">Pausar</button><button data-sim="reset">Reiniciar</button><button data-sim="speed">${simulationSpeed}×</button></div>
      </div>
      <div class="kpis compact">${operationalKpis().map(([name, value]) => `<div class="kpi"><strong>${value}</strong><br>${name}</div>`).join('')}</div>
      <div id="realMap" class="real-map" role="application" aria-label="Mapa OpenStreetMap de Laguna Salada"><div class="map-fallback"><strong>Mapa externo no disponible.</strong><span>Fallback operativo demo: use listas, paneles y coordenadas simuladas.</span></div></div>
    </div>
    <aside class="detail-drawer" id="detail">${renderTruckDetail(trucks[0])}</aside>
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
  return `<div class="drawer-head"><p class="eyebrow">Detalle de ruta</p><h2>${route.name}</h2>${pill(routeStatus(route))}</div>
    <div class="detail-grid"><p><b>Unidad asignada</b><span>${route.truckId}</span></p><p><b>Conductor</b><span>${driverName(route.driverId)}</span></p><p><b>Sectores</b><span>${route.sectors.join(', ')}</span></p><p><b>Inicio</b><span>${route.started}</span></p><p><b>Programada</b><span>${route.scheduled}</span></p><p><b>Tiempo estimado</b><span>${route.estimatedMinutes} min</span></p><p><b>Distancia demo</b><span>${route.distanceKm} km</span></p><p><b>Paradas</b><span>${route.covered} completadas · ${route.pending} pendientes</span></p></div>
    ${progress(route.progress)}<p><strong>${route.progress}%</strong> completado</p><h3>Incidencias</h3>${relatedIncidents.map((incident) => `<button class="incident-row" data-incident="${incident.code}">${incident.type} · ${incident.status}</button>`).join('') || '<p>Sin incidencias demo.</p>'}
    <h3>Timeline operativo</h3><div class="timeline">${routeFlow.map((step) => `<p>${step === route.status ? '●' : '○'} ${label(step)}</p>`).join('')}</div>`;
}
function renderIncidentDetail(incident) { return `<div class="drawer-head"><p class="eyebrow">Incidencia operativa demo</p><h2>${incident.type}</h2>${pill('open')}</div><p><b>Folio:</b> ${incident.id}</p><p><b>Sector:</b> ${incident.sector}</p><p><b>Prioridad:</b> ${incident.priority}</p><p><b>Estado:</b> ${incident.status}</p><p>${incident.detail}</p><p class="demo">${demoNotice}</p>`; }

function renderMunicipal() { return `<section id="municipal" class="section card"><h2>Panel municipal</h2><p class="demo">${demoNotice} · Municipio piloto configurable: ${pilotMunicipality.name}, ${pilotMunicipality.country}</p><div class="controls"><input id="search" placeholder="Buscar ruta, camión o sector"><select id="sectorFilter"><option value="">Todos los sectores</option>${sectors.map((s) => `<option>${s.name}</option>`).join('')}</select></div><div class="panel-grid"><div><h3>Rutas del día</h3><div class="list" id="routeList">${renderRoutes(routes)}</div></div><div><h3>Vehículos demo</h3>${trucks.map((truck) => `<button class="row selectable" data-truck="${truck.id}"><span>${truckIcon(truck)} ${truck.unit}<br>${driverName(truck.driverId)}</span>${pill(truck.state)}</button>`).join('')}</div><div><h3>Incidencias en mapa</h3>${incidents.map((incident) => `<button class="row selectable" data-incident="${incident.code}"><span>${incident.type}<br>${incident.sector}</span>${pill('open')}</button>`).join('')}</div></div><h3>Vista móvil conductor</h3><div class="mobile"><h4>Ruta asignada</h4><p>Demo Centro Urbano AM → En progreso</p><button data-flow>Avanzar flujo demo</button><p id="flowState">planned</p></div></section>`; }
function renderRoutes(items) { return items.map((route) => `<article class="row selectable" data-route="${route.id}"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ETA ${route.eta}<br>${progress(route.progress)}</div><div>${pill(routeStatus(route))}<br>${route.covered}/${route.stops} paradas</div></article>`).join(''); }
function renderCitizen() { return `<section id="ciudadania" class="section card"><h2>Portal ciudadano</h2><p class="demo">${demoNotice}</p><div class="panel-grid"><div><h3>Consulta de recogida</h3><select id="citizenSector">${sectors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><p id="pickupResult"></p><h3>Avisos municipales</h3>${notifications.map((n) => `<div class="row">🔔 ${n}</div>`).join('')}</div><form id="incidentForm"><h3>Reportar incidencia</h3><select name="type"><option>Basura no recogida</option><option>Vertedero improvisado</option></select><textarea name="description" placeholder="Descripción demo"></textarea><input type="file" aria-label="Adjuntar evidencia demo"><button>Obtener folio</button><p id="folio"></p></form><div><h3>Consultar estado</h3><input id="folioSearch" value="SW-FOLIO-1001"><button id="checkFolio">Consultar</button><p id="folioStatus"></p><h3>Futura relación</h3><p>Preparado para Chatbot Municipal: preguntas frecuentes, folios y avisos por sector.</p></div></div></section>`; }
function renderMaster() { return `<section id="master" class="section card"><h2>Master Admin MT IT Services</h2><p class="demo">${demoNotice}</p><div class="panel-grid">${municipalities.map((m) => `<article class="card"><h3>${m.name}</h3><p>Plan: ${m.plan}</p><p>Camiones: ${m.trucks} · Rutas: ${m.routes} · Usuarios: ${m.users}</p>${pill(m.status.toLowerCase().includes('operativo') ? 'active' : 'assigned')}<button>Onboarding demo</button></article>`).join('')}</div><h3>Arquitectura futura</h3><p>${pilotMunicipality.integrationsReady.join(' · ')}</p></section>`; }

app.innerHTML = `${renderMap()}${renderMunicipal()}${renderCitizen()}${renderMaster()}`;

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.append(css);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.onload = () => resolve(window.L); script.onerror = reject; document.head.append(script);
  });
}
function initMap() {
  loadLeaflet().then((L) => {
    mapReady = true;
    map = L.map('realMap', { zoomControl: true }).setView(pilotMunicipality.center, pilotMunicipality.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    drawMapLayers(L);
  }).catch(() => $('#realMap').classList.add('fallback-active'));
}
function drawMapLayers(L = window.L) {
  if (!mapReady) return;
  [...routeLayers, ...truckMarkers, ...incidentMarkers].forEach((layer) => layer.remove()); routeLayers = []; truckMarkers = []; incidentMarkers = [];
  routes.forEach((route) => {
    const path = routePaths[route.id]; const cut = Math.max(1, Math.round((path.length - 1) * (route.progress / 100)));
    routeLayers.push(L.polyline(path.slice(0, cut + 1), { color: '#0f7b4f', weight: 7, opacity: .9 }).addTo(map));
    routeLayers.push(L.polyline(path.slice(cut), { color: '#155eef', weight: 6, opacity: .45, dashArray: '8 10' }).addTo(map).on('click', () => selectRoute(route.id)));
    routeLayers.push(...path.map((point, index) => L.circleMarker(point, { radius: index <= cut ? 5 : 4, color: index <= cut ? '#0f7b4f' : '#155eef', fillOpacity: .85 }).addTo(map)));
  });
  trucks.forEach((truck) => {
    const marker = L.marker(routePosition({ ...truck, positionIndex: simState[truck.id]?.index ?? truck.positionIndex }), { icon: L.divIcon({ className: 'leaflet-truck', html: truckIcon(truck), iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map).on('click', () => selectTruck(truck.id));
    truckMarkers.push(marker);
  });
  incidents.forEach((incident) => { incidentMarkers.push(L.marker(incident.position, { icon: L.divIcon({ className: 'leaflet-incident', html: `<span>⚠<small>${incident.type}</small></span>`, iconSize: [90, 34] }) }).addTo(map).on('click', () => selectIncident(incident.code))); });
}
function selectTruck(id) { selectedTruckId = id; const truck = trucks.find((item) => item.id === id); $('#detail').innerHTML = renderTruckDetail(truck); }
function selectRoute(id) { selectedRouteId = id; const route = routeById(id); $('#detail').innerHTML = renderRouteDetail(route); }
function selectIncident(code) { selectedIncidentId = code; const incident = incidents.find((item) => item.code === code); $('#detail').innerHTML = renderIncidentDetail(incident); }
function startSimulation() { if (simulationTimer) return; simulationTimer = setInterval(() => { trucks.filter((truck) => truck.routeId && truck.state !== 'offline' && truck.state !== 'completed').forEach((truck) => { const path = routePaths[truck.routeId]; simState[truck.id].index = (simState[truck.id].index + 1) % path.length; simState[truck.id].progress = Math.min(99, simState[truck.id].progress + 3); truck.progress = simState[truck.id].progress; truck.updatedAt = 'Ahora (simulación)'; truck.sector = routeById(truck.routeId)?.sector ?? truck.sector; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); }, 1800 / simulationSpeed); }
function pauseSimulation() { clearInterval(simulationTimer); simulationTimer = null; }
function resetSimulation() { pauseSimulation(); trucks.forEach((truck) => { const original = initialTruckState[truck.id]; simState[truck.id] = { index: original.index, progress: original.progress }; truck.progress = original.progress; truck.updatedAt = original.updatedAt; truck.sector = original.sector; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); }

document.addEventListener('click', (event) => {
  const truckButton = event.target.closest('[data-truck]'); if (truckButton) selectTruck(truckButton.dataset.truck);
  const routeButton = event.target.closest('[data-route]'); if (routeButton?.dataset.route) selectRoute(routeButton.dataset.route);
  const incidentButton = event.target.closest('[data-incident]'); if (incidentButton) selectIncident(incidentButton.dataset.incident);
  if (event.target.matches('[data-flow]')) { const current = $('#flowState').textContent; $('#flowState').textContent = routeFlow[(routeFlow.indexOf(current) + 1) % routeFlow.length]; }
  if (event.target.id === 'checkFolio') { const found = incidents.find((incident) => incident.id === $('#folioSearch').value); $('#folioStatus').textContent = found ? `${found.type}: ${found.status}` : 'Folio demo no encontrado'; }
  const sim = event.target.dataset.sim; if (sim === 'start') startSimulation(); if (sim === 'pause') pauseSimulation(); if (sim === 'reset') resetSimulation(); if (sim === 'speed') { simulationSpeed = simulationSpeed === 1 ? 2 : simulationSpeed === 2 ? 4 : 1; event.target.textContent = `${simulationSpeed}×`; if (simulationTimer) { pauseSimulation(); startSimulation(); } }
});
$('#search').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); $('#routeList').innerHTML = renderRoutes(routes.filter((route) => JSON.stringify(route).toLowerCase().includes(term))); });
$('#sectorFilter').addEventListener('change', (event) => { $('#routeList').innerHTML = renderRoutes(routes.filter((route) => !event.target.value || route.sectors.includes(event.target.value))); });
$('#citizenSector').addEventListener('change', (event) => { const sector = sectors.find((item) => item.id === event.target.value); $('#pickupResult').textContent = `${sector.pickupDay} · Estado: ${sector.status}`; });
$('#citizenSector').dispatchEvent(new Event('change'));
$('#incidentForm').addEventListener('submit', (event) => { event.preventDefault(); $('#folio').textContent = `Folio generado: SW-FOLIO-${Math.floor(2000 + Math.random() * 7000)} (demo)`; });
initMap();

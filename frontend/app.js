import { demoNotice, simulationNotice, pilotMunicipality, trucks, routes, sectors, drivers, incidents, notifications, municipalities, routeFlow, routePaths, stateLabels } from '../shared/demo-data.js';
import { operationsAdapter, createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { driverAllowedTransitions } from '../shared/contracts.js';
import { validateEvidenceFile } from '../shared/channel-contracts.js';
import { createDemoFolio, findSectorService, findIncidentStatus } from '../shared/citizen-portal.js';
import { IMPACT_DEMO_NOTICE, IMPACT_SCENARIO_NOTICE, defaultImpactAssumptions, metricReadiness, calculateImpactMetrics } from '../shared/impact-center.js';
import { initAuthGate, SECTION_ROLES } from './auth-gate.js';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const driverName = (id) => drivers.find((driver) => driver.id === id)?.name ?? 'Sin asignar';
const routeById = (id) => routes.find((route) => route.id === id);
const routeName = (id) => routeById(id)?.name ?? 'Sin ruta asignada';
// Demo-only stand-in for "the logged-in driver" — there is no per-user session wired to a specific
// drivers.id yet (auth-gate.js only resolves the *role*, not which driver row a Supabase user maps
// to; that lookup needs a real drivers.profile_id query, out of scope here). drv-02 is the driver
// already assigned to the route the old hardcoded widget referenced (route-centro), so the demo
// narrative doesn't change, it just becomes data-driven instead of a fixed string.
const DEMO_DRIVER_ID = 'drv-02';
const currentDriverRoute = () => routes.find((route) => route.driverId === DEMO_DRIVER_ID) ?? null;
const label = (state) => stateLabels[state] ?? state;
const routePosition = (truck) => truck.position ?? routePaths[truck.routeId]?.[truck.positionIndex ?? 0] ?? pilotMunicipality.center;
let selectedTruckId = null;
let selectedRouteId = null;
let selectedIncidentId = null;
let map;
let mapReady = false;
let routeLayers = [];
let truckMarkers = [];
let incidentMarkers = [];
let simulationTimer = null;
let simulationSpeed = 1;
// Set once initAuthGate() resolves with a real signed-in session (window.SMARTWASTE_SUPABASE_CONFIG
// configured) — null in default demo mode, which keeps every write below exactly as it behaved
// before this existed (CLAUDE.md rule 5). Only the conductor/supervisor write actions are wired to
// it so far; the map/municipal/impact reads still come from shared/demo-data.js — connecting those
// live to Supabase is separate, larger follow-up work (see docs/FRONTEND_LOGIN_SETUP.md).
let writeAdapter = null;
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
        <div class="sim-controls" aria-label="Controles de simulación"><span>${simulationNotice} · fuente desacoplada: ${operationsAdapter.mode}</span><select id="simVehicle">${trucks.map((t) => `<option value="${t.id}">${t.unit}</option>`).join('')}</select><button data-sim="start">Iniciar</button><button data-sim="pause">Pausar</button><button data-sim="reset">Reiniciar</button><button data-sim="speed">${simulationSpeed}×</button></div>
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
  return `<div class="drawer-head"><p class="eyebrow">Detalle de ruta</p><h2>${route.name}</h2>${pill(routeStatus(route))}</div>
    <div class="detail-grid"><p><b>Unidad asignada</b><span>${route.truckId}</span></p><p><b>Conductor</b><span>${driverName(route.driverId)}</span></p><p><b>Sectores</b><span>${route.sectors.join(', ')}</span></p><p><b>Inicio</b><span>${route.started}</span></p><p><b>Programada</b><span>${route.scheduled}</span></p><p><b>Tiempo estimado</b><span>${route.estimatedMinutes} min</span></p><p><b>Distancia demo</b><span>${route.distanceKm} km</span></p><p><b>Paradas</b><span>${route.covered} completadas · ${route.pending} pendientes</span></p></div>
    ${progress(route.progress)}<p><strong>${route.progress}%</strong> completado</p><h3>Incidencias</h3>${relatedIncidents.map((incident) => `<button class="incident-row" data-incident="${incident.code}">${incident.type} · ${incident.status}</button>`).join('') || '<p>Sin incidencias demo.</p>'}
    <h3>Timeline operativo</h3><div class="timeline">${routeFlow.map((step) => `<p>${step === route.status ? '●' : '○'} ${label(step)}</p>`).join('')}</div>`;
}
function renderIncidentDetail(incident) { return `<div class="drawer-head"><p class="eyebrow">Incidencia operativa demo</p><h2>${incident.type}</h2>${pill('open')}</div><p><b>Folio:</b> ${incident.id}</p><p><b>Sector:</b> ${incident.sector}</p><p><b>Prioridad:</b> ${incident.priority}</p><p><b>Estado:</b> ${incident.status}</p><p>${incident.detail}</p><p class="demo">${demoNotice}</p>`; }

function renderMunicipal() { return `<section id="municipal" class="section card"><h2>Panel municipal</h2><p class="demo">${demoNotice} · Municipio piloto configurable: ${pilotMunicipality.name}, ${pilotMunicipality.country}</p><div class="controls"><input id="search" placeholder="Buscar ruta, camión o sector"><select id="sectorFilter"><option value="">Todos los sectores</option>${sectors.map((s) => `<option>${s.name}</option>`).join('')}</select></div><div class="panel-grid"><div><h3>Rutas del día</h3><div class="list" id="routeList">${renderRoutes(routes)}</div></div><div><h3>Vehículos demo</h3>${trucks.map((truck) => `<button class="row selectable" data-truck="${truck.id}"><span>${truckIcon(truck)} ${truck.unit}<br>${driverName(truck.driverId)}</span>${pill(truck.state)}</button>`).join('')}</div><div><h3>Incidencias en mapa</h3>${incidents.map((incident) => `<button class="row selectable" data-incident="${incident.code}"><span>${incident.type}<br>${incident.sector}</span>${pill('open')}</button>`).join('')}</div></div></section>`; }
function renderRoutes(items) { return items.map((route) => `<article class="row selectable" data-route="${route.id}"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ETA ${route.eta}<br>${progress(route.progress)}</div><div>${pill(routeStatus(route))}<br>${route.covered}/${route.stops} paradas</div></article>`).join(''); }
function renderSupervisor() {
  const pendingVerification = routes.filter((route) => route.status === 'completed');
  const openIncidents = incidents.filter((incident) => incident.status !== 'Cerrada');
  return `<section id="supervisor" class="section card"><h2>Panel de supervisor</h2><p class="demo">${demoNotice} · Verificación de rutas completadas y gestión de incidencias. Acciones de esta vista son demo local (no escriben contra Supabase todavía).</p><div class="panel-grid">
    <div><h3>Rutas pendientes de verificación</h3>${pendingVerification.length ? pendingVerification.map((route) => `<article class="row"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ${route.progress}% completado</div><div>${pill('completed')}<button data-verify-route="${route.id}">Verificar</button></div></article>`).join('') : '<p>No hay rutas completadas pendientes de verificación.</p>'}</div>
    <div><h3>Incidencias abiertas</h3>${openIncidents.length ? openIncidents.map((incident) => `<article class="row"><div><strong>${incident.type}</strong><br>${incident.sector} · ${incident.priority}</div><div>${pill('open')}<button data-resolve-incident="${incident.code}">Marcar resuelta</button></div></article>`).join('') : '<p>Sin incidencias abiertas.</p>'}</div>
  </div></section>`;
}
function renderConductor() {
  const route = currentDriverRoute();
  const driver = drivers.find((item) => item.id === DEMO_DRIVER_ID);
  const ownIncidents = route ? incidents.filter((incident) => route.incidents.includes(incident.code)) : [];
  const nextStates = route ? driverAllowedTransitions(route.status) : [];
  return `<section id="conductor" class="section card"><h2>Vista de conductor</h2><p class="demo">${demoNotice} · Sesión demo de ${driver?.name ?? 'conductor'}. Acciones de esta vista son demo local (no escriben contra Supabase todavía).</p>
    ${route ? `<div class="panel-grid">
      <div><h3>Ruta asignada</h3><article class="row"><div><strong>${route.name}</strong><br>${route.sectors.join(' · ')} · ETA ${route.eta}<br>${progress(route.progress)}</div><div>${pill(routeStatus(route))}<br>${route.covered}/${route.stops} paradas</div></article>
        <div class="mobile"><h4>Cambiar estado de la ruta</h4>${nextStates.length ? nextStates.map((next) => `<button data-driver-transition="${next}">${label(next)}</button>`).join('') : '<p>Sin transiciones disponibles para el conductor en este estado.</p>'}</div></div>
      <div><h3>Incidencias de esta ruta</h3>${ownIncidents.length ? ownIncidents.map((incident) => `<button class="row selectable" data-incident="${incident.code}"><span>${incident.type}<br>${incident.sector}</span>${pill('open')}</button>`).join('') : '<p>Sin incidencias reportadas en esta ruta.</p>'}
        <form id="driverIncidentForm"><h4>Reportar incidencia</h4><select name="type"><option>Calle bloqueada</option><option>Avería</option><option>Retraso</option><option>Vertedero improvisado</option></select><textarea name="description" placeholder="Descripción demo" required></textarea><button>Reportar</button></form></div>
    </div>` : '<p>Sin ruta asignada actualmente.</p>'}
  </section>`;
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

app.innerHTML = `${renderMap()}${renderMunicipal()}${renderSupervisor()}${renderConductor()}${renderCitizen()}${renderImpactCenter()}${renderMaster()}`;

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
function drawerContent(content) { return `<button class="drawer-close" data-close-detail aria-label="Cerrar detalle">✕ Cerrar</button><div class="drawer-scroll">${content}</div>`; }
function openDetail(content) { const detail = $('#detail'); detail.innerHTML = drawerContent(content); detail.classList.remove('is-hidden'); detail.setAttribute('aria-hidden', 'false'); }
function closeDetail() { const detail = $('#detail'); detail.classList.add('is-hidden'); detail.setAttribute('aria-hidden', 'true'); detail.innerHTML = ''; selectedTruckId = null; selectedRouteId = null; selectedIncidentId = null; }
function selectTruck(id) { selectedTruckId = id; selectedRouteId = null; selectedIncidentId = null; const truck = trucks.find((item) => item.id === id); openDetail(renderTruckDetail(truck)); }
function selectRoute(id) { selectedRouteId = id; selectedTruckId = null; selectedIncidentId = null; const route = routeById(id); openDetail(renderRouteDetail(route)); }
function selectIncident(code) { selectedIncidentId = code; selectedTruckId = null; selectedRouteId = null; const incident = incidents.find((item) => item.code === code); openDetail(renderIncidentDetail(incident)); }
function startSimulation() { if (simulationTimer) return; simulationTimer = setInterval(() => { trucks.filter((truck) => truck.routeId && truck.state !== 'offline' && truck.state !== 'completed').forEach((truck) => { const path = routePaths[truck.routeId]; simState[truck.id].index = (simState[truck.id].index + 1) % path.length; simState[truck.id].progress = Math.min(99, simState[truck.id].progress + 3); truck.progress = simState[truck.id].progress; truck.updatedAt = 'Ahora (simulación)'; truck.sector = routeById(truck.routeId)?.sector ?? truck.sector; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }, 1800 / simulationSpeed); }
function pauseSimulation() { clearInterval(simulationTimer); simulationTimer = null; }
function resetSimulation() { pauseSimulation(); trucks.forEach((truck) => { const original = initialTruckState[truck.id]; simState[truck.id] = { index: original.index, progress: original.progress }; truck.progress = original.progress; truck.updatedAt = original.updatedAt; truck.sector = original.sector; }); drawMapLayers(); if (selectedTruckId) selectTruck(selectedTruckId); if (selectedRouteId) selectRoute(selectedRouteId); if (selectedIncidentId) selectIncident(selectedIncidentId); }

// Shared by every supervisor/conductor write action below: `maybeResultPromise` is undefined in
// demo mode (writeAdapter is null, so `writeAdapter?.method(...)` short-circuits) — in that case
// onSuccess() runs immediately, exactly like before any of this real-write wiring existed (rule 5).
// When writeAdapter is set, it's a real Promise from shared/operations-adapter.js's { ok, error }
// result shape; onSuccess() (the local demo-array update + re-render) only runs after a successful
// real write, and a failed one surfaces the error instead of silently pretending it worked.
async function applyRealWrite(maybeResultPromise, onSuccess) {
  if (maybeResultPromise) {
    const result = await maybeResultPromise;
    if (!result.ok) { alert(`No se pudo guardar en Supabase: ${result.error.message}`); return; }
  }
  onSuccess();
}

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-detail]')) { closeDetail(); return; }
  const truckButton = event.target.closest('[data-truck]'); if (truckButton) selectTruck(truckButton.dataset.truck);
  const routeButton = event.target.closest('[data-route]'); if (routeButton?.dataset.route) selectRoute(routeButton.dataset.route);
  const incidentButton = event.target.closest('[data-incident]'); if (incidentButton) selectIncident(incidentButton.dataset.incident);
  const verifyButton = event.target.closest('[data-verify-route]');
  if (verifyButton) {
    const route = routeById(verifyButton.dataset.verifyRoute);
    if (route) applyRealWrite(writeAdapter?.verifyRoute(route.realId), () => { route.status = 'verified'; $('#supervisor').outerHTML = renderSupervisor(); });
  }
  const resolveButton = event.target.closest('[data-resolve-incident]');
  if (resolveButton) {
    const incident = incidents.find((item) => item.code === resolveButton.dataset.resolveIncident);
    if (incident) applyRealWrite(writeAdapter?.updateIncident(incident.realId, { status: 'resolved' }), () => { incident.status = 'Cerrada'; $('#supervisor').outerHTML = renderSupervisor(); });
  }
  const driverTransitionButton = event.target.closest('[data-driver-transition]');
  if (driverTransitionButton) {
    const route = currentDriverRoute();
    const next = driverTransitionButton.dataset.driverTransition;
    if (route && driverAllowedTransitions(route.status).includes(next)) {
      const method = { started: 'startRoute', in_progress: 'updateProgress', delayed: 'markDelayed', completed: 'completeRoute' }[next];
      const call = writeAdapter && (method === 'updateProgress' ? writeAdapter.updateProgress(route.realId, next === 'completed' ? 100 : route.progress) : writeAdapter[method](route.realId));
      applyRealWrite(call, () => { route.status = next; if (next === 'completed') route.progress = 100; $('#conductor').outerHTML = renderConductor(); });
    }
  }
  const onboardButton = event.target.closest('[data-onboarding]');
  if (onboardButton) { const status = document.querySelector(`[data-onboarding-status="${onboardButton.dataset.onboarding}"]`); if (status) status.textContent = 'Onboarding demo iniciado — flujo completo en desarrollo.'; }
  if (event.target.id === 'useGeo') { requestGeolocation(); }
  if (event.target.id === 'checkFolio') { const found = findIncidentStatus($('#folioSearch').value); $('#folioStatus').textContent = found ? `${found.type}: ${found.status}` : 'Folio demo no encontrado'; }
  const sim = event.target.dataset.sim; if (sim === 'start') startSimulation(); if (sim === 'pause') pauseSimulation(); if (sim === 'reset') resetSimulation(); if (sim === 'speed') { simulationSpeed = simulationSpeed === 1 ? 2 : simulationSpeed === 2 ? 4 : 1; event.target.textContent = `${simulationSpeed}×`; if (simulationTimer) { pauseSimulation(); startSimulation(); } }
});
document.addEventListener('change', (event) => { if (event.target.closest('#impacto') && event.target.matches('select')) { $('#impacto').outerHTML = renderImpactCenter(currentImpactAssumptions(), currentImpactFilters()); } });
// Delegated (not a direct listener) because #driverIncidentForm is recreated every time #conductor
// re-renders (e.g. after a route status transition), which would drop a directly-attached listener.
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'driverIncidentForm') return;
  event.preventDefault();
  const route = currentDriverRoute();
  if (!route) return;
  const formData = new FormData(event.target);
  const type = formData.get('type');
  const description = formData.get('description');
  // This one is a real INSERT when writeAdapter is set — no existing-row id to match, so it's not
  // affected by the demo/real id mismatch fixed via .realId above (docs/TECHNICAL_DEBT_REGISTER.md
  // #14). incidents' real columns are (type, status, priority, description, route_run_id,
  // vehicle_id, ...) — no 'sector' column, and 'detail' isn't a column name either, so the real
  // payload only sends type/description; status/priority are left to their DB defaults ('open'/
  // 'medium'), which already match the demo's own defaults below. We deliberately don't send
  // route_run_id: demo route ids (e.g. 'route-centro') aren't valid Postgres uuids, and
  // driver_insert_own_incident (202607150006_sw020_rls_fixes.sql) already allows a null
  // route_run_id, so the insert succeeds without it.
  if (writeAdapter) {
    const result = await writeAdapter.registerIncident({ type, description });
    if (!result.ok) { alert(`No se pudo registrar la incidencia en Supabase: ${result.error.message}`); return; }
  }
  const code = `INC-${incidents.length + 1}`;
  incidents.push({ id: `SW-FOLIO-${1000 + incidents.length + 1}`, code, type, sector: route.sector, status: 'Abierta', priority: 'Media', detail: description, position: pilotMunicipality.center });
  route.incidents.push(code);
  $('#conductor').outerHTML = renderConductor();
});
$('#search').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); $('#routeList').innerHTML = renderRoutes(routes.filter((route) => JSON.stringify(route).toLowerCase().includes(term))); });
$('#sectorFilter').addEventListener('change', (event) => { $('#routeList').innerHTML = renderRoutes(routes.filter((route) => !event.target.value || route.sectors.includes(event.target.value))); });
$('#citizenSector').addEventListener('change', (event) => { const service = findSectorService(event.target.value); $('#pickupResult').textContent = service ? `${service.pickupDay} · Estado: ${service.status}` : 'Sector no encontrado'; });
$('#citizenSector').dispatchEvent(new Event('change'));
// createDemoFolio(sequence) (shared/citizen-portal.js) instead of a random number — sequential,
// human-readable folios, matching how tests/citizen-portal.test.mjs already exercises it.
let citizenFolioSequence = 1;
$('#incidentForm').addEventListener('submit', (event) => { event.preventDefault(); $('#folio').textContent = `Folio generado: ${createDemoFolio(citizenFolioSequence++)} (demo · sin upload real)`; });
document.querySelectorAll('#fuelPrice,#fuelEfficiency,#operatingDays,#hourlyCost').forEach((input) => input.addEventListener('input', () => { const assumptions = { ...defaultImpactAssumptions, fuelPrice: Number($('#fuelPrice').value), fuelEfficiency: Number($('#fuelEfficiency').value), operatingDays: Number($('#operatingDays').value), hourlyCost: Number($('#hourlyCost').value) }; $('#impactEconomics').innerHTML = renderImpactEconomics(calculateImpactMetrics(assumptions)); }));
$('#evidence').addEventListener('change', (event) => { const file = event.target.files?.[0]; const result = validateEvidenceFile(file); $('#evidencePreview').textContent = result.ok ? `${file?.name ?? 'Sin archivo'} · ${result.reason}` : `Evidencia rechazada: ${result.reason}`; });
function requestGeolocation() { const target = $('#geoStatus'); if (!navigator.geolocation) { target.textContent = 'Ubicación no disponible en este navegador.'; return; } target.textContent = 'Solicitando permiso de ubicación...'; navigator.geolocation.getCurrentPosition((pos) => { target.textContent = `Ubicación recibida localmente: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (no enviada)`; }, (err) => { target.textContent = `Permiso denegado, timeout o ubicación no disponible: ${err.message}`; }, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 }); }
// Tab-style navigation: only one top-level section visible at a time, chosen by the URL hash
// (#mapa, #conductor, etc.), matching the nav links' existing href="#id" — added because stacking
// every section in one long page made new views (like #conductor) hard to notice among the rest.
// SECTION_ROLES.keys() (not a separate hardcoded list) so this can never drift out of sync with
// which sections actually exist / are gated by role in auth-gate.js.
const SECTION_IDS = Object.keys(SECTION_ROLES);
function isNavAllowed(id) { const link = document.querySelector(`nav a[href="#${id}"]`); return !link || link.style.display !== 'none'; }
function activateSection(id) {
  const allowed = SECTION_IDS.filter(isNavAllowed);
  const target = allowed.includes(id) ? id : allowed[0];
  if (!target) return;
  SECTION_IDS.forEach((sectionId) => { const el = document.getElementById(sectionId); if (el) el.style.display = sectionId === target ? '' : 'none'; });
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${target}`));
  if (location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
  $('#app').scrollIntoView({ block: 'start' });
  // Leaflet sizes itself from the container's on-screen dimensions at init time; if #mapa was
  // display:none then (e.g. the page loaded directly on #conductor), the map would have measured a
  // 0×0 box. invalidateSize() re-measures now that the container is actually visible.
  if (target === 'mapa' && map) map.invalidateSize();
}
window.addEventListener('hashchange', () => activateSection(location.hash.slice(1)));
activateSection(location.hash.slice(1) || 'mapa');

initMap();
// No-ops entirely (leaves every section visible, same as before this line existed) unless the
// page sets window.SMARTWASTE_SUPABASE_CONFIG — see frontend/auth-gate.js and CLAUDE.md rule 5.
// Re-activate afterwards: role resolution is async and may hide the section the tab logic above
// picked before login resolved (e.g. a driver's default 'mapa' tab is still allowed, but if the
// hash pointed at '#municipal' before resolving, that's no longer valid for that role).
initAuthGate().then((ctx) => {
  // Only registerIncident (an insert, see the driverIncidentForm handler above) is wired to this
  // adapter so far. Route status transitions (driver's #conductor buttons, supervisor's verify/
  // resolve) are deliberately NOT wired yet: shared/demo-data.js route/incident ids are readable
  // slugs ('route-centro', 'INC-003'), but routes.id/incidents.id are `uuid` columns in the real
  // schema (shared/contracts.js) — passing a demo id straight to the adapter would fail every time
  // with "invalid input syntax for type uuid", not silently do nothing. Wiring those needs the
  // demo/real id spaces reconciled first (either migrate demo ids to seeded real uuids, or read
  // routes/incidents from Supabase instead of shared/demo-data.js) — that's larger, separate work.
  if (ctx?.client) writeAdapter = createSupabaseOperationsAdapter(ctx.client, { municipality_id: ctx.municipality_id });
  activateSection(location.hash.slice(1) || 'mapa');
});

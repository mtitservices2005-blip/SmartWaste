import { routes, sectors, trucks, incidents } from './demo-data.js';
import { DEFAULT_COST_PARAMETERS } from './cost-parameters.js';

export const IMPACT_DEMO_NOTICE = 'Datos simulados para demostración · no representan resultados reales del ayuntamiento';
export const IMPACT_SCENARIO_NOTICE = 'Escenario simulado para demostración';

// SW-030: the numeric defaults themselves now live in shared/cost-parameters.js (the module that
// also validates/persists a municipality's own configured values, per municipality_id) — this stays
// the single source of truth for what a freshly-loaded, never-configured municipality sees, so the
// two never drift apart. currentDistanceKm is the one field that stays out of cost-parameters.js:
// it's derived from real route data (or the demo routes below), never a configured input.
export const defaultImpactAssumptions = {
  ...DEFAULT_COST_PARAMETERS,
  currentDistanceKm: Number(routes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1))
  // Uso estimado del camión (paradas × minutos/parada + distancia/velocidad): arranca como supuesto
  // configurable, no una medición real (no hay timestamps de inicio/fin de ruta persistidos hoy —
  // ver item #4 de docs/TECHNICAL_DEBT_REGISTER.md). La idea es empezar a recoger estas
  // estimaciones corrida a corrida y afinar los supuestos con datos reales más adelante.
};

export const metricReadiness = {
  REAL_READY: ['routes', 'vehicles', 'incidents', 'sectors', 'contracts', 'auth context', 'operations adapter'],
  PARTIAL: ['route_runs', 'vehicle_positions', 'cumplimiento por vehículo', 'cumplimiento por ruta', 'telemetry simulator'],
  DEMO_ONLY: ['kilómetros potencialmente evitados', 'combustible potencialmente optimizado', 'impacto económico estimado', 'reincidencias demo', 'antes vs después', 'uso estimado del camión (paradas × min/parada + distancia/velocidad)'],
  BLOCKED: ['ahorros reales auditados', 'GPS físico verificado', 'costos oficiales del ayuntamiento', 'histórico real de resolución']
};

const round = (value, digits = 1) => Number(value.toFixed(digits));
const pct = (part, total) => total ? round((part / total) * 100, 1) : 0;
const count = (items, predicate) => items.filter(predicate).length;
const sum = (items, selector) => items.reduce((total, item) => total + selector(item), 0);

// SW-030: realData carries actual operational data when the caller (frontend/app.js) has it —
// { operational: summarizeRouteRunsForMunicipality()'s result | null, routeSavings:
// aggregateRouteSavings()'s result | null }. Both default to null/undefined so every existing call
// site (demo mode, no real backend) keeps working unchanged — buildRealComparison() below then
// returns { operational: null, routeSavings: null }, which the UI renders as "pendiente de datos"
// rather than fabricating a number from simulated data (rule 6: no reclamar integraciones reales
// sin evidencia).
export function calculateImpactMetrics(assumptions = defaultImpactAssumptions, filters = {}, realData = {}) {
  const filteredRoutes = routes.filter((route) => (!filters.sector || route.sectors.includes(filters.sector)) && (!filters.route || route.id === filters.route) && (!filters.status || route.status === filters.status));
  const filteredTrucks = trucks.filter((truck) => (!filters.vehicle || truck.id === filters.vehicle) && (!filters.status || truck.state === filters.status || routeStatus(truck.routeId) === filters.status));
  const filteredIncidents = incidents.filter((incident) => !filters.sector || incident.sector === filters.sector);
  const plannedRoutes = filteredRoutes.length;
  const assignedRoutes = count(filteredRoutes, (route) => Boolean(route.truckId));
  const startedRoutes = count(filteredRoutes, (route) => route.started !== 'Pendiente');
  const inProgressRoutes = count(filteredRoutes, (route) => route.status === 'in_progress');
  const delayedRoutes = count(filteredRoutes, (route) => route.status === 'delayed');
  const completedRoutes = count(filteredRoutes, (route) => ['completed', 'verified'].includes(route.status));
  const verifiedRoutes = count(filteredRoutes, (route) => route.status === 'verified' || route.status === 'completed');
  const progressAverage = plannedRoutes ? round(sum(filteredRoutes, (route) => route.progress) / plannedRoutes, 1) : 0;
  const stops = sum(filteredRoutes, (route) => route.stops);
  const coveredStops = sum(filteredRoutes, (route) => route.covered);
  const sectorNames = [...new Set(filteredRoutes.flatMap((route) => route.sectors))];
  const attendedSectors = sectors.filter((sector) => sector.covered > 0 && (!filters.sector || sector.name === filters.sector)).length;
  const plannedSectors = filters.sector ? 1 : sectors.length;
  const distanceKm = round(sum(filteredRoutes, (route) => route.distanceKm), 1);
  const productiveKm = round(distanceKm * 0.82, 1);
  // Codex review (PR #88, P2): baseDistanceKm is a municipality-configured cost parameter where 0 is
  // a valid (if unusual) value — `||` would silently discard it and fall back to the demo default,
  // same class of bug as the distanceMeasuredRunsCount fix above.
  const baselineKm = Number(assumptions.baseDistanceKm ?? defaultImpactAssumptions.baseDistanceKm);
  const currentKm = filters.sector || filters.route ? distanceKm : Number(assumptions.currentDistanceKm || distanceKm);
  const avoidedKm = Math.max(0, round(baselineKm - currentKm, 1));
  const fuelSavedLiters = round(avoidedKm / Number(assumptions.fuelEfficiency || 1), 2);
  const fuelCostAvoided = round(fuelSavedLiters * Number(assumptions.fuelPrice || 0), 2);
  const optimizedHours = Math.max(0, round(Number(assumptions.baselineOperatingHours || 0) - Number(assumptions.operatingHours || 0), 1));
  const monthlyFuelAvoided = round(fuelCostAvoided * Number(assumptions.operatingDays || 0), 2);
  const monthlyHoursAvoided = round(optimizedHours * Number(assumptions.hourlyCost || 0) * Number(assumptions.operatingDays || 0), 2);
  const incidentCostAvoided = round(count(filteredIncidents, (incident) => incident.status === 'Cerrada') * Number(assumptions.incidentAvoidanceCost || 0), 2);
  const monthlyPotentialAvoided = round(monthlyFuelAvoided + monthlyHoursAvoided + incidentCostAvoided, 2);
  const vehicleTotals = {
    total: filteredTrucks.length,
    active: count(filteredTrucks, (truck) => truck.state === 'active'),
    stopped: count(filteredTrucks, (truck) => truck.state === 'stopped'),
    delayed: count(filteredTrucks, (truck) => truck.state === 'delayed'),
    offline: count(filteredTrucks, (truck) => truck.state === 'offline'),
    maintenance: 0,
    completed: count(filteredTrucks, (truck) => truck.state === 'completed')
  };
  const bySector = sectors.map((sector) => ({ name: sector.name, covered: sector.covered, pending: sector.pending, coverage: pct(sector.covered, sector.covered + sector.pending), incidents: count(filteredIncidents, (incident) => incident.sector === sector.name) }));
  // Codex review on PR #54: filteredRoutes only respects sector/route/status — filters.vehicle only
  // narrowed filteredTrucks, so picking a specific vehicle left Uso reporting every route regardless
  // (e.g. selecting an unassigned truck still showed usage for all 5 demo routes). Scoped to usage
  // only, not filteredRoutes itself, since routes/coverage/economics were never meant to narrow by
  // vehicle (a vehicle filter says "show me this truck's load", not "hide routes it isn't on").
  const usageRoutes = filteredRoutes.filter((route) => !filters.vehicle || route.truckId === filters.vehicle);
  const usage = calculateUsageMetrics(usageRoutes, assumptions);
  const mergedAssumptions = { ...defaultImpactAssumptions, ...assumptions };
  return {
    filters,
    assumptions: mergedAssumptions,
    routes: { planned: plannedRoutes, assigned: assignedRoutes, started: startedRoutes, inProgress: inProgressRoutes, delayed: delayedRoutes, completed: completedRoutes, verified: verifiedRoutes, complianceRate: pct(completedRoutes, plannedRoutes), punctualityRate: pct(startedRoutes - delayedRoutes, startedRoutes), progressAverage },
    coverage: { plannedSectors, attendedSectors, coverageRate: pct(attendedSectors, plannedSectors), pendingSectors: Math.max(0, plannedSectors - attendedSectors), topIncidentZones: bySector.filter((sector) => sector.incidents > 0).sort((a, b) => b.incidents - a.incidents).slice(0, 3), bySector, stops, coveredStops },
    fleet: { ...vehicleTotals, availabilityRate: pct(vehicleTotals.active + vehicleTotals.delayed + vehicleTotals.completed, vehicleTotals.total), utilizationRate: pct(count(filteredTrucks, (truck) => Boolean(truck.routeId)), vehicleTotals.total) },
    incidents: { open: count(filteredIncidents, (incident) => incident.status !== 'Cerrada'), resolved: count(filteredIncidents, (incident) => incident.status === 'Cerrada'), avgResolutionHours: 5.6, byCategory: groupCount(filteredIncidents, 'type'), bySector: groupCount(filteredIncidents, 'sector'), recurrenceDemo: 2 },
    operation: { distanceKm, productiveKm, avoidedKm, operatingHours: Number(assumptions.operatingHours), stoppedHours: 1.1, unproductiveHours: round(Number(assumptions.operatingHours) - (Number(assumptions.operatingHours) * 0.78), 1), byVehicle: filteredTrucks.map((truck) => ({ name: truck.unit, compliance: truck.progress })), byRoute: filteredRoutes.map((route) => ({ name: route.name, compliance: route.progress })) },
    efficiency: { avoidedKm, fuelSavedLiters, fuelCostAvoided, optimizedHours },
    economics: { monthlyFuelAvoided, monthlyHoursAvoided, incidentCostAvoided, monthlyPotentialAvoided, annualProjectionDemo: round(monthlyPotentialAvoided * 12, 2) },
    beforeAfter: buildBeforeAfter({ assumptions, currentKm, fuelSavedLiters, fuelCostAvoided, optimizedHours, monthlyPotentialAvoided }),
    usage,
    realComparison: buildRealComparison({ assumptions: mergedAssumptions, operational: realData.operational ?? null, routeSavings: realData.routeSavings ?? null })
  };
}

// SW-030: the "con datos reales" comparisons (deliberately separate from buildBeforeAfter() below,
// which stays exactly as it was — a labeled demo scenario, IMPACT_SCENARIO_NOTICE, rule 5: never
// silently reclassified as real). `operational` is null unless the caller passed real, non-empty
// route_runs data (any source — vehicle_positions from browser_geolocation or the simulator both
// count, per this hito's scope: "no distinguir origen para este cálculo" — only whether route_runs
// itself has a real measured distance/duration). `routeSavings` is null unless the caller passed at
// least one real route with enough stops to compare. Both null cases render as "pendiente de datos"
// in the UI, never as a fabricated 0.
function buildRealComparison({ assumptions, operational, routeSavings }) {
  const fuelEfficiency = Number(assumptions.fuelEfficiency) || 1;
  const fuelPrice = Number(assumptions.fuelPrice) || 0;
  const baselineDistanceKm = Number(assumptions.baseDistanceKm) || 0;
  const baselineHours = Number(assumptions.baselineOperatingHours) || 0;

  let operationalComparison = null;
  if (operational && operational.runsCount > 0) {
    const realHours = round(operational.totalDurationMinutes / 60, 2);
    // Codex review (PR #88, P1): runsCount only means "has started_at/completed_at" — a run can be
    // measured (counts here) with distance_meters still null (no GPS trail for it, e.g. a route
    // completed without GPS — shared/route-run-stats.js's summarizeGroup()). Without this check,
    // totalDistanceKm silently summing to 0 across such runs was indistinguishable from "0km really
    // measured", reporting a real 0 instead of "pendiente de datos".
    const hasMeasuredDistance = operational.distanceMeasuredRunsCount > 0;
    const realDistanceKm = operational.totalDistanceKm;
    const baselineFuelLiters = round(baselineDistanceKm / fuelEfficiency, 2);
    const realFuelLiters = round(realDistanceKm / fuelEfficiency, 2);
    operationalComparison = {
      runsCount: operational.runsCount,
      distanceMeasuredRunsCount: operational.distanceMeasuredRunsCount,
      hours: comparison('Horas operativas (medidas)', baselineHours, realHours, 'h'),
      distance: hasMeasuredDistance ? comparison('Kilómetros recorridos (medidos)', baselineDistanceKm, realDistanceKm, 'km') : null,
      // Codex review (PR #88, P1): even when the distance itself is real/measured, these two rows
      // are still calculated from the configured fuelEfficiency/fuelPrice assumptions, not from any
      // actual fuel or expense telemetry (none exists) — labeling them "(medido)" like distance/hours
      // would present modeled consumption/cost as a real measurement.
      fuelLiters: hasMeasuredDistance ? comparison('Consumo de combustible estimado (según distancia medida)', baselineFuelLiters, realFuelLiters, 'L') : null,
      fuelCost: hasMeasuredDistance ? comparison('Costo de combustible estimado (según distancia medida)', round(baselineFuelLiters * fuelPrice, 2), round(realFuelLiters * fuelPrice, 2), 'RD$') : null
    };
  }

  let routeSavingsComparison = null;
  if (routeSavings && routeSavings.routesCompared > 0) {
    const savedKm = round(routeSavings.savedMeters / 1000, 2);
    const savedFuelLiters = round(savedKm / fuelEfficiency, 2);
    routeSavingsComparison = {
      routesCompared: routeSavings.routesCompared,
      manualDistanceKm: round(routeSavings.manualDistanceMeters / 1000, 2),
      optimizedDistanceKm: round(routeSavings.optimizedDistanceMeters / 1000, 2),
      savedKm,
      savedPercent: routeSavings.savedPercent,
      savedFuelLiters,
      savedFuelCost: round(savedFuelLiters * fuelPrice, 2)
    };
  }

  return { operational: operationalComparison, routeSavings: routeSavingsComparison };
}

// Uso estimado del camión: paradas × minutos/parada (tiempo de recolección) + distancia/velocidad
// promedio (tiempo de traslado). Es una fórmula, no una medición — no hay timestamps reales de
// inicio/fin de ruta persistidos todavía (item #4 del debt register). El objetivo es empezar a
// registrar esta estimación en cada corrida para, con el tiempo, comparar contra datos reales y
// afinar los supuestos (minutesPerStop/avgSpeedKmh) — no para reportar un número final ya exacto.
function calculateUsageMetrics(filteredRoutes, assumptions) {
  const minutesPerStop = Number(assumptions.minutesPerStop ?? defaultImpactAssumptions.minutesPerStop);
  const avgSpeedKmh = Number(assumptions.avgSpeedKmh ?? defaultImpactAssumptions.avgSpeedKmh);
  const byRoute = filteredRoutes.map((route) => {
    const stopMinutes = round(route.stops * minutesPerStop, 1);
    const travelMinutes = avgSpeedKmh ? round((route.distanceKm / avgSpeedKmh) * 60, 1) : 0;
    return { id: route.id, name: route.name, truckId: route.truckId, stops: route.stops, distanceKm: route.distanceKm, stopMinutes, travelMinutes, totalMinutes: round(stopMinutes + travelMinutes, 1) };
  });
  const totalMinutes = round(sum(byRoute, (r) => r.totalMinutes), 1);
  const byVehicle = Object.values(byRoute.reduce((acc, r) => {
    const key = r.truckId && r.truckId !== 'Sin asignar' ? r.truckId : 'Sin asignar';
    if (!acc[key]) acc[key] = { truckId: key, routes: 0, totalMinutes: 0 };
    acc[key].routes += 1;
    acc[key].totalMinutes = round(acc[key].totalMinutes + r.totalMinutes, 1);
    return acc;
  }, {})).map((v) => ({ ...v, totalHours: round(v.totalMinutes / 60, 2) }));
  return { minutesPerStop, avgSpeedKmh, totalMinutes, totalHours: round(totalMinutes / 60, 2), byRoute, byVehicle };
}

function routeStatus(routeId) { return routes.find((route) => route.id === routeId)?.status; }
function groupCount(items, key) { return items.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {}); }
function comparison(label, before, after, unit, mode = 'reduction') {
  const absolute = round(after - before, 2);
  const variation = before ? round(((after - before) / before) * 100, 1) : 0;
  const reduction = before ? round(((before - after) / before) * 100, 1) : 0;
  const points = unit === '%' ? round(after - before, 1) : null;
  return { label, before, after, unit, absolute, variation, reduction: mode === 'increase' ? null : reduction, points };
}
function buildBeforeAfter({ assumptions, currentKm }) {
  const baselineFuel = round(Number(assumptions.baseDistanceKm) / Number(assumptions.fuelEfficiency), 2);
  const currentFuel = round(currentKm / Number(assumptions.fuelEfficiency), 2);
  return [
    comparison('Cumplimiento de rutas', 54, 80, '%', 'increase'),
    comparison('Cobertura', 58, 80, '%', 'increase'),
    comparison('Kilómetros recorridos', Number(assumptions.baseDistanceKm), currentKm, 'km'),
    comparison('Kilómetros improductivos', 8.2, round(currentKm * 0.18, 1), 'km'),
    comparison('Consumo estimado', baselineFuel, currentFuel, 'L'),
    comparison('Costo estimado de combustible', round(baselineFuel * assumptions.fuelPrice, 2), round(currentFuel * assumptions.fuelPrice, 2), 'RD$'),
    comparison('Tiempo improductivo', 2.4, 1.3, 'h'),
    comparison('Detección de retrasos', 45, 9, 'min'),
    comparison('Resolución de incidencias', 9.5, 5.6, 'h')
  ];
}

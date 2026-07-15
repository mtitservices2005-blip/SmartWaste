import { routes, sectors, trucks, incidents } from './demo-data.js';

export const IMPACT_DEMO_NOTICE = 'Datos simulados para demostración · no representan resultados reales del ayuntamiento';
export const IMPACT_SCENARIO_NOTICE = 'Escenario simulado para demostración';

export const defaultImpactAssumptions = {
  fuelPrice: 76,
  fuelEfficiency: 4.8,
  operatingDays: 22,
  hourlyCost: 950,
  baseDistanceKm: 31,
  currentDistanceKm: Number(routes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)),
  operatingHours: 6.1,
  baselineOperatingHours: 7.4,
  incidentAvoidanceCost: 1200
};

export const metricReadiness = {
  REAL_READY: ['routes', 'vehicles', 'incidents', 'sectors', 'contracts', 'auth context', 'operations adapter'],
  PARTIAL: ['route_runs', 'vehicle_positions', 'cumplimiento por vehículo', 'cumplimiento por ruta', 'telemetry simulator'],
  DEMO_ONLY: ['kilómetros potencialmente evitados', 'combustible potencialmente optimizado', 'impacto económico estimado', 'reincidencias demo', 'antes vs después'],
  BLOCKED: ['ahorros reales auditados', 'GPS físico verificado', 'costos oficiales del ayuntamiento', 'histórico real de resolución']
};

const round = (value, digits = 1) => Number(value.toFixed(digits));
const pct = (part, total) => total ? round((part / total) * 100, 1) : 0;
const count = (items, predicate) => items.filter(predicate).length;
const sum = (items, selector) => items.reduce((total, item) => total + selector(item), 0);

export function calculateImpactMetrics(assumptions = defaultImpactAssumptions, filters = {}) {
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
  const baselineKm = Number(assumptions.baseDistanceKm || defaultImpactAssumptions.baseDistanceKm);
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
  return {
    filters,
    assumptions: { ...defaultImpactAssumptions, ...assumptions },
    routes: { planned: plannedRoutes, assigned: assignedRoutes, started: startedRoutes, inProgress: inProgressRoutes, delayed: delayedRoutes, completed: completedRoutes, verified: verifiedRoutes, complianceRate: pct(completedRoutes, plannedRoutes), punctualityRate: pct(startedRoutes - delayedRoutes, startedRoutes), progressAverage },
    coverage: { plannedSectors, attendedSectors, coverageRate: pct(attendedSectors, plannedSectors), pendingSectors: Math.max(0, plannedSectors - attendedSectors), topIncidentZones: bySector.filter((sector) => sector.incidents > 0).sort((a, b) => b.incidents - a.incidents).slice(0, 3), bySector, stops, coveredStops },
    fleet: { ...vehicleTotals, availabilityRate: pct(vehicleTotals.active + vehicleTotals.delayed + vehicleTotals.completed, vehicleTotals.total), utilizationRate: pct(count(filteredTrucks, (truck) => Boolean(truck.routeId)), vehicleTotals.total) },
    incidents: { open: count(filteredIncidents, (incident) => incident.status !== 'Cerrada'), resolved: count(filteredIncidents, (incident) => incident.status === 'Cerrada'), avgResolutionHours: 5.6, byCategory: groupCount(filteredIncidents, 'type'), bySector: groupCount(filteredIncidents, 'sector'), recurrenceDemo: 2 },
    operation: { distanceKm, productiveKm, avoidedKm, operatingHours: Number(assumptions.operatingHours), stoppedHours: 1.1, unproductiveHours: round(Number(assumptions.operatingHours) - (Number(assumptions.operatingHours) * 0.78), 1), byVehicle: filteredTrucks.map((truck) => ({ name: truck.unit, compliance: truck.progress })), byRoute: filteredRoutes.map((route) => ({ name: route.name, compliance: route.progress })) },
    efficiency: { avoidedKm, fuelSavedLiters, fuelCostAvoided, optimizedHours },
    economics: { monthlyFuelAvoided, monthlyHoursAvoided, incidentCostAvoided, monthlyPotentialAvoided, annualProjectionDemo: round(monthlyPotentialAvoided * 12, 2) },
    beforeAfter: buildBeforeAfter({ assumptions, currentKm, fuelSavedLiters, fuelCostAvoided, optimizedHours, monthlyPotentialAvoided })
  };
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

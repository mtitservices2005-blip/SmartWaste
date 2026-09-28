// SW-047: aggregates measured route_runs (duration/distance from SW-044/045) into per-route and
// per-driver efficiency summaries. Pure — no network, no DOM — mirrors the exact duration/distance
// math frontend/app.js's refreshRouteDurationHistory() already uses for a single route, generalized
// to group by any key. The async fetch (listRouteRuns()) and the join against local routes/drivers
// arrays for display names stays in frontend/app.js, same split as the rest of this file.

function runDurationMinutes(run) {
  if (!run.started_at || !run.completed_at) return null;
  return Math.max(0, Math.round((Date.parse(run.completed_at) - Date.parse(run.started_at)) / 60000));
}

function runDistanceKm(run) {
  return run.distance_meters != null ? Math.round(run.distance_meters / 100) / 10 : null;
}

function average(numbers) {
  return numbers.length ? numbers.reduce((total, n) => total + n, 0) / numbers.length : null;
}

function summarizeGroup(runs) {
  const durations = runs.map(runDurationMinutes).filter((n) => n != null);
  const distanceMeters = runs.map((run) => run.distance_meters).filter((n) => n != null);
  const distances = runs.map(runDistanceKm).filter((n) => n != null);
  return {
    runsCount: runs.length,
    completedRunsCount: runs.length,
    // SW-030 (Codex review, PR #88, P1): a run counts toward runsCount as soon as it has
    // started_at/completed_at — distance_meters can still be null (no GPS trail recorded for it).
    // totalDistanceKm silently sums to 0 when every run lacks distance, indistinguishable from "0km
    // really measured" — callers that need to tell those apart (e.g. shared/impact-center.js's
    // buildRealComparison(), which must show "pendiente de datos" instead of a fabricated 0km) use
    // this count, not runsCount, to decide whether the distance figures mean anything.
    distanceMeasuredRunsCount: distanceMeters.length,
    totalDurationMinutes: durations.reduce((total, n) => total + n, 0),
    totalDistanceMeters: distanceMeters.reduce((total, n) => total + n, 0),
    totalDistanceKm: Math.round(distanceMeters.reduce((total, n) => total + n, 0) / 100) / 10,
    avgDurationMinutes: durations.length ? Math.round(average(durations)) : null,
    lastDurationMinutes: durations.length ? durations[durations.length - 1] : null,
    avgDistanceKm: distances.length ? Math.round(average(distances) * 10) / 10 : null,
    lastDistanceKm: distances.length ? distances[distances.length - 1] : null,
  };
}

function runsForMonth(routeRuns, month) {
  if (month == null) return routeRuns;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  return routeRuns.filter((run) => typeof run.started_at === 'string' && run.started_at.slice(0, 7) === month);
}

function measuredRuns(routeRuns, month) {
  return runsForMonth(routeRuns, month)
    .filter((run) => run.started_at && run.completed_at)
    .sort((a, b) => {
      const byStart = Date.parse(a.started_at) - Date.parse(b.started_at);
      if (byStart) return byStart;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
}

function groupBy(runs, key) {
  const groups = new Map();
  runs.forEach((run) => {
    if (!run[key]) return;
    if (!groups.has(run[key])) groups.set(run[key], []);
    groups.get(run[key]).push(run);
  });
  return groups;
}

// Only runs with both started_at and completed_at count as "measured" — matches
// refreshRouteDurationHistory()'s filter, never inventing a duration for an in-progress/cancelled run.
export function summarizeRouteRunsByRoute(routeRuns, month) {
  const measured = measuredRuns(routeRuns, month);
  return [...groupBy(measured, 'route_id').entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([routeId, runs]) => ({ routeId, ...summarizeGroup(runs) }));
}

export function summarizeRouteRunsByDriver(routeRuns, month) {
  const measured = measuredRuns(routeRuns, month).filter((run) => run.driver_id);
  return [...groupBy(measured, 'driver_id').entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([driverId, runs]) => ({ driverId, ...summarizeGroup(runs) }));
}

// Municipality-wide totals deliberately do not group by route or driver.
export function summarizeRouteRunsForMunicipality(routeRuns, month) {
  const summary = summarizeGroup(measuredRuns(routeRuns, month));
  return {
    runsCount: summary.runsCount,
    completedRunsCount: summary.completedRunsCount,
    distanceMeasuredRunsCount: summary.distanceMeasuredRunsCount,
    totalDurationMinutes: summary.totalDurationMinutes,
    totalDistanceMeters: summary.totalDistanceMeters,
    totalDistanceKm: summary.totalDistanceKm,
  };
}

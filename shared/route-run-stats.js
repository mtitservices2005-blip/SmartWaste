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
  const distances = runs.map(runDistanceKm).filter((n) => n != null);
  return {
    runsCount: runs.length,
    avgDurationMinutes: durations.length ? Math.round(average(durations)) : null,
    lastDurationMinutes: durations.length ? durations[durations.length - 1] : null,
    avgDistanceKm: distances.length ? Math.round(average(distances) * 10) / 10 : null,
    lastDistanceKm: distances.length ? distances[distances.length - 1] : null,
  };
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
export function summarizeRouteRunsByRoute(routeRuns) {
  const measured = routeRuns.filter((run) => run.started_at && run.completed_at);
  return [...groupBy(measured, 'route_id').entries()].map(([routeId, runs]) => ({ routeId, ...summarizeGroup(runs) }));
}

export function summarizeRouteRunsByDriver(routeRuns) {
  const measured = routeRuns.filter((run) => run.started_at && run.completed_at && run.driver_id);
  return [...groupBy(measured, 'driver_id').entries()].map(([driverId, runs]) => ({ driverId, ...summarizeGroup(runs) }));
}

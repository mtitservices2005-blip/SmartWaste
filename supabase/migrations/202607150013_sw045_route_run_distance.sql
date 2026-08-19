-- SW-045: route_runs had no way to record how far a vehicle actually traveled on a run — only the
-- drawn/planned trace length lives on the route (frontend-only distanceKm, computed once at route
-- creation from the drawn points, never updated). With SW-044's started_at/completed_at in place,
-- a completed run's real vehicle_positions trail (already collected whenever the driver shared
-- GPS) can be summed into an actual distance. This column is what that gets stamped into; the
-- summation itself lives in shared/operations-adapter.js's transitionRouteRun(), not here.
alter table route_runs add column if not exists distance_meters numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_runs_distance_meters_non_negative') then
    alter table route_runs add constraint route_runs_distance_meters_non_negative check (distance_meters is null or distance_meters >= 0);
  end if;
end $$;

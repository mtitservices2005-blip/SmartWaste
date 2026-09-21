-- SW-062: bind every new GPS sample to the exact route execution that produced it.
-- Historical rows remain nullable; current browser telemetry always supplies route_run_id.
alter table vehicle_positions
  add column if not exists route_run_id uuid references route_runs(id);

create index if not exists vehicle_positions_route_run_recorded_idx
  on vehicle_positions(route_run_id, captured_at asc)
  where route_run_id is not null;

alter table route_runs
  add column if not exists gps_points_count integer,
  add column if not exists gps_started_at timestamptz,
  add column if not exists gps_ended_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_runs_gps_points_count_non_negative') then
    alter table route_runs add constraint route_runs_gps_points_count_non_negative
      check (gps_points_count is null or gps_points_count >= 0);
  end if;
end $$;

-- Extend the existing tenant guard: when a point names a run, municipality and vehicle must
-- match that run. This prevents a valid vehicle assignment from attaching telemetry to another
-- route execution in the same municipality.
create or replace function guard_vehicle_position_tenant() returns trigger language plpgsql as $$
declare
  run_row route_runs%rowtype;
begin
  perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id);
  if new.route_run_id is not null then
    select * into run_row from route_runs where id = new.route_run_id;
    if not found then raise exception 'Referenced route_run does not exist'; end if;
    if run_row.municipality_id <> new.municipality_id then raise exception 'Cross-tenant reference rejected'; end if;
    if run_row.vehicle_id is distinct from new.vehicle_id then raise exception 'Vehicle does not match route_run'; end if;
  end if;
  return new;
end $$;

drop policy if exists driver_insert_own_vehicle_position on vehicle_positions;
create policy driver_insert_own_vehicle_position on vehicle_positions for insert
with check (
  has_municipality_role(municipality_id, array['driver'])
  and exists (
    select 1 from drivers d
    join vehicle_assignments va on va.driver_id = d.id
    where d.profile_id = auth.uid()
      and va.vehicle_id = vehicle_positions.vehicle_id
      and va.municipality_id = vehicle_positions.municipality_id
      and va.status = 'assigned'
  )
  and (
    (route_run_id is null and source <> 'browser_geolocation')
    or exists (
      select 1 from route_runs rr
      join drivers d on d.id = rr.driver_id
      where rr.id = vehicle_positions.route_run_id
        and rr.vehicle_id = vehicle_positions.vehicle_id
        and rr.municipality_id = vehicle_positions.municipality_id
        and rr.status in ('started', 'in_progress', 'delayed')
        and d.profile_id = auth.uid()
    )
  )
);

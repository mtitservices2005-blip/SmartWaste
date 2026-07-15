-- SW-015 local-only operational integrity and cross-tenant guards.
create or replace function assert_same_municipality(reference_table text, reference_id uuid, expected_municipality_id uuid) returns void language plpgsql stable as $$
declare actual uuid;
begin
  if reference_id is null then return; end if;
  execute format('select municipality_id from %I where id = $1', reference_table) into actual using reference_id;
  if actual is null then raise exception 'Referenced % % not found', reference_table, reference_id; end if;
  if actual <> expected_municipality_id then raise exception 'Cross-municipality reference rejected: %', reference_table; end if;
end $$;

create or replace function guard_route_stop_tenant() returns trigger language plpgsql as $$ begin perform assert_same_municipality('routes', new.route_id, new.municipality_id); return new; end $$;
create or replace function guard_route_run_tenant() returns trigger language plpgsql as $$ begin perform assert_same_municipality('routes', new.route_id, new.municipality_id); perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id); perform assert_same_municipality('drivers', new.driver_id, new.municipality_id); return new; end $$;
create or replace function guard_vehicle_assignment_tenant() returns trigger language plpgsql as $$ begin perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id); perform assert_same_municipality('drivers', new.driver_id, new.municipality_id); perform assert_same_municipality('route_runs', new.route_run_id, new.municipality_id); return new; end $$;
create or replace function guard_vehicle_position_tenant() returns trigger language plpgsql as $$ begin perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id); return new; end $$;
create or replace function guard_incident_tenant() returns trigger language plpgsql as $$ begin perform assert_same_municipality('route_runs', new.route_run_id, new.municipality_id); perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id); return new; end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='route_stops_tenant_guard') then create trigger route_stops_tenant_guard before insert or update on route_stops for each row execute function guard_route_stop_tenant(); end if;
  if not exists (select 1 from pg_trigger where tgname='route_runs_tenant_guard') then create trigger route_runs_tenant_guard before insert or update on route_runs for each row execute function guard_route_run_tenant(); end if;
  if not exists (select 1 from pg_trigger where tgname='vehicle_assignments_tenant_guard') then create trigger vehicle_assignments_tenant_guard before insert or update on vehicle_assignments for each row execute function guard_vehicle_assignment_tenant(); end if;
  if not exists (select 1 from pg_trigger where tgname='vehicle_positions_tenant_guard') then create trigger vehicle_positions_tenant_guard before insert or update on vehicle_positions for each row execute function guard_vehicle_position_tenant(); end if;
  if not exists (select 1 from pg_trigger where tgname='incidents_tenant_guard') then create trigger incidents_tenant_guard before insert or update on incidents for each row execute function guard_incident_tenant(); end if;
end $$;

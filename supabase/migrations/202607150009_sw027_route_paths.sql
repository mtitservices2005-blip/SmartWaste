-- SW-027: stores the drawn geometry for a route — one row per point, in draw order. routePaths in
-- shared/demo-data.js is a fixed, in-memory dictionary that only covers the 5 bundled demo routes;
-- a route created through the new "Crear ruta" UI needs somewhere real to persist its trace. Same
-- shape/pattern as route_stops (sequence + lat/lng row per point), just for the raw drawn line
-- instead of derived collection points.
create table if not exists route_paths (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id),
  route_id uuid not null references routes(id),
  sequence int not null,
  latitude numeric not null,
  longitude numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table route_paths enable row level security;

-- guard_route_stop_tenant() (202607150005_sw015_operations_integrity.sql) already does exactly what
-- this table needs — assert_same_municipality('routes', new.route_id, new.municipality_id) — so it
-- is reused as-is rather than defining a near-duplicate function.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'route_paths_tenant_guard') then
    create trigger route_paths_tenant_guard before insert or update on route_paths for each row execute function guard_route_stop_tenant();
  end if;
end $$;

-- Same three policies/roles as route_stops (202607150004_sw014_auth_rls_policies.sql's tenant_read/
-- tenant_insert_staff/tenant_update_staff loop) — drawing a route's geometry is a staff action
-- (municipal_admin/supervisor/dispatcher), not written directly here since route_paths didn't exist
-- when that loop ran.
drop policy if exists tenant_read on route_paths;
create policy tenant_read on route_paths for select using (has_municipality_role(municipality_id));
drop policy if exists tenant_insert_staff on route_paths;
create policy tenant_insert_staff on route_paths for insert with check (has_municipality_role(municipality_id, array['municipal_admin','supervisor','dispatcher']));
drop policy if exists tenant_update_staff on route_paths;
create policy tenant_update_staff on route_paths for update
  using (has_municipality_role(municipality_id, array['municipal_admin','supervisor','dispatcher']))
  with check (has_municipality_role(municipality_id, array['municipal_admin','supervisor','dispatcher']));

create index if not exists route_paths_route_sequence_idx on route_paths(route_id, sequence);

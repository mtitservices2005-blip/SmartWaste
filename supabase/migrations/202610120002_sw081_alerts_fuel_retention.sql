-- SW-081 (Task 2): alertas de flotilla, combustible real y retención configurable del GPS crudo.
-- Migración SOLO ADITIVA: no edita ni borra nada de las migraciones anteriores ni relaja RLS.
--
-- Decisiones de implementación (ver informe SW-081):
--  * Cada alerta es un "episodio": el índice único parcial (vehicle_id, type) donde
--    condition_cleared_at es nulo impide repetirla mientras el problema siga, aunque alguien la
--    marque "atendida" a mano (CA-084-2: alerta única, no repetida). La spec/plan decía
--    (vehicle_id, type) donde status = 'abierta'; eso reabriría la alerta apenas se atienda.
--  * La retención (aprobada por Miguel el 2026-10-13: 180 días) vive en fleet_settings como dato,
--    no en el código de purge_old_positions().

-- 1. Configuración de plataforma (hoy solo la retención del GPS crudo).
create table if not exists fleet_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table fleet_settings enable row level security;
drop policy if exists fleet_settings_read on fleet_settings;
create policy fleet_settings_read on fleet_settings for select using (auth.uid() is not null);
drop policy if exists fleet_settings_platform_write on fleet_settings;
create policy fleet_settings_platform_write on fleet_settings for all
  using (has_platform_role('mt_superadmin')) with check (has_platform_role('mt_superadmin'));
insert into fleet_settings (key, value) values ('gps_retention_days', to_jsonb(180)) on conflict (key) do nothing;

-- 2. Alertas de flotilla.
create table if not exists fleet_alerts (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id),
  vehicle_id uuid not null references vehicles(id),
  route_run_id uuid references route_runs(id),
  type text not null check (type in ('sin_senal', 'detenido_largo', 'bateria_baja', 'ruta_retrasada')),
  status text not null default 'abierta' check (status in ('abierta', 'atendida')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  condition_cleared_at timestamptz,
  constraint fleet_alerts_closed_consistency check (
    (status = 'abierta' and closed_at is null) or (status = 'atendida' and closed_at is not null)
  )
);
create unique index if not exists fleet_alerts_one_episode_idx on fleet_alerts (vehicle_id, type) where condition_cleared_at is null;
create index if not exists fleet_alerts_municipality_status_idx on fleet_alerts (municipality_id, status, opened_at desc);

alter table fleet_alerts enable row level security;
drop policy if exists tenant_read_staff on fleet_alerts;
create policy tenant_read_staff on fleet_alerts for select
  using (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']));
drop policy if exists tenant_insert_staff on fleet_alerts;
create policy tenant_insert_staff on fleet_alerts for insert
  with check (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']));
drop policy if exists tenant_update_staff on fleet_alerts;
create policy tenant_update_staff on fleet_alerts for update
  using (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']))
  with check (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']));

create or replace function guard_fleet_alert_tenant() returns trigger language plpgsql as $$
begin
  perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id);
  perform assert_same_municipality('route_runs', new.route_run_id, new.municipality_id);
  return new;
end $$;
drop trigger if exists fleet_alerts_tenant_guard on fleet_alerts;
create trigger fleet_alerts_tenant_guard before insert or update on fleet_alerts
  for each row execute function guard_fleet_alert_tenant();

-- Condiciones de alerta vigentes ahora mismo, según fleet_overview() (solo camiones que el usuario ve).
create or replace function fleet_alert_conditions() returns table (
  vehicle_id uuid, municipality_id uuid, route_run_id uuid, type text
) language sql stable set search_path = public as $$
  select o.vehicle_id, v.municipality_id, ar.id, t.type
  from fleet_overview() o
  join vehicles v on v.id = o.vehicle_id
  left join lateral (
    select rr.id, rr.status
    from route_runs rr
    where rr.vehicle_id = v.id and rr.status in ('started', 'in_progress', 'delayed')
    order by coalesce(rr.started_at, rr.created_at) desc
    limit 1
  ) ar on true
  cross join lateral (values
    ('sin_senal', o.status = 'sin_senal'),
    ('detenido_largo', o.status = 'detenido'),
    ('bateria_baja', o.status <> 'disponible' and o.battery_pct is not null and o.battery_pct < 20),
    ('ruta_retrasada', coalesce(ar.status = 'delayed', false))
  ) as t(type, active)
  where t.active
$$;

-- Abre y cierra alertas según el estado actual de la flotilla. Idempotente: llamarla muchas
-- veces no duplica. Devuelve cuántas alertas abrió. Corre con los permisos de quien la llama
-- (RLS): un usuario del municipio A solo toca alertas de A. Un job de plataforma (pg_cron, service_role,
-- dueño de la base) ve todo vía fleet_caller_sees_all() y NO cierra alertas vigentes por no ver filas.
create or replace function refresh_fleet_alerts() returns integer language plpgsql set search_path = public as $$
declare opened integer;
begin
  -- Cierra los episodios cuya condición ya no se cumple (las no atendidas pasan a "atendida").
  update fleet_alerts a
  set condition_cleared_at = now(),
      status = 'atendida',
      closed_at = coalesce(a.closed_at, now())
  where a.condition_cleared_at is null
    and not exists (
      select 1 from fleet_alert_conditions() d where d.vehicle_id = a.vehicle_id and d.type = a.type
    );

  with ins as (
    insert into fleet_alerts (municipality_id, vehicle_id, route_run_id, type)
    select d.municipality_id, d.vehicle_id, d.route_run_id, d.type from fleet_alert_conditions() d
    on conflict (vehicle_id, type) where condition_cleared_at is null do nothing
    returning 1
  )
  select count(*) into opened from ins;
  return opened;
end $$;

create or replace function acknowledge_fleet_alert(alert_id uuid) returns void language plpgsql set search_path = public as $$
begin
  update fleet_alerts set status = 'atendida', closed_at = coalesce(closed_at, now())
  where id = alert_id and status = 'abierta';
  if not found and not exists (select 1 from fleet_alerts where id = alert_id) then
    raise exception 'alert_not_found' using errcode = 'P0002';
  end if;
end $$;

-- 3. Combustible real (litros cargados). Solo se agrega; no se edita ni se borra.
create table if not exists fuel_logs (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id),
  vehicle_id uuid not null references vehicles(id),
  route_run_id uuid references route_runs(id),
  liters numeric not null constraint fuel_logs_liters_positive check (liters > 0),
  odometer_km numeric constraint fuel_logs_odometer_non_negative check (odometer_km is null or odometer_km >= 0),
  logged_at timestamptz not null default now(),
  logged_by uuid default auth.uid() references profiles(id)
);
create index if not exists fuel_logs_vehicle_logged_idx on fuel_logs (vehicle_id, logged_at desc);
create index if not exists fuel_logs_municipality_logged_idx on fuel_logs (municipality_id, logged_at desc);

alter table fuel_logs enable row level security;
drop policy if exists tenant_read_staff on fuel_logs;
create policy tenant_read_staff on fuel_logs for select
  using (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']));
drop policy if exists driver_read_own_fuel on fuel_logs;
create policy driver_read_own_fuel on fuel_logs for select
  using (has_municipality_role(municipality_id, array['driver']) and logged_by = auth.uid());
drop policy if exists tenant_insert_staff on fuel_logs;
create policy tenant_insert_staff on fuel_logs for insert
  with check (
    has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher'])
    and logged_by is not distinct from auth.uid()
  );
drop policy if exists driver_insert_own_fuel on fuel_logs;
create policy driver_insert_own_fuel on fuel_logs for insert
  with check (
    has_municipality_role(municipality_id, array['driver'])
    and logged_by = auth.uid()
    and exists (
      select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
      where d.profile_id = auth.uid() and va.vehicle_id = fuel_logs.vehicle_id
        and va.municipality_id = fuel_logs.municipality_id and va.status = 'assigned'
    )
  );

create or replace function guard_fuel_log_tenant() returns trigger language plpgsql as $$
declare run_row route_runs%rowtype;
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
drop trigger if exists fuel_logs_tenant_guard on fuel_logs;
create trigger fuel_logs_tenant_guard before insert on fuel_logs
  for each row execute function guard_fuel_log_tenant();

-- 4. Retención del GPS crudo. days nulo = usar fleet_settings('gps_retention_days').
-- Solo borra quien tenga permiso de borrado sobre vehicle_positions (hoy: el job de plataforma o
-- el dueño de la base; ningún rol de aplicación tiene política de DELETE). No toca vehicle_live_state
-- ni las métricas guardadas en route_runs.
create or replace function purge_old_positions(days integer default null) returns bigint language plpgsql set search_path = public as $$
declare
  effective integer;
  removed bigint;
begin
  effective := coalesce(days, (select (value #>> '{}')::integer from fleet_settings where key = 'gps_retention_days'));
  if effective is null then raise exception 'retention_not_configured' using errcode = 'P0001'; end if;
  if effective < 1 then raise exception 'invalid_retention: days must be >= 1, got %', effective using errcode = '22023'; end if;
  delete from vehicle_positions where captured_at < now() - make_interval(days => effective);
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function fleet_alert_conditions() from public, anon;
revoke all on function refresh_fleet_alerts() from public, anon;
revoke all on function acknowledge_fleet_alert(uuid) from public, anon;
revoke all on function purge_old_positions(integer) from public, anon;
grant execute on function fleet_alert_conditions() to authenticated, service_role;
grant execute on function refresh_fleet_alerts() to authenticated, service_role;
grant execute on function acknowledge_fleet_alert(uuid) to authenticated, service_role;
grant execute on function purge_old_positions(integer) to authenticated, service_role;

-- SW-081 (Task 1): estado vivo de la flotilla, ingesta idempotente por lotes y vista de flotilla.
-- Migración SOLO ADITIVA: no edita ni borra nada de las migraciones anteriores ni relaja RLS.
-- Spec: docs/superpowers/specs/2026-10-12-sw080-plataforma-flotilla-design.md (sección 5, SW-081).
--
-- Decisiones de implementación (ver informe SW-081):
--  * El índice único de deduplicación es PARCIAL (source = 'driver_app') y usa coalesce(device_id, ''):
--    así no puede fallar al aplicarse sobre filas viejas del navegador y trata device_id nulo como valor.
--  * vehicle_live_state agrega stopped_since (desde cuándo está quieto) para poder derivar "detenido".
--  * ingest_positions y fleet_overview son SECURITY INVOKER: la RLS existente sigue siendo la
--    segunda barrera; además cada punto se valida explícitamente para poder contar rechazados.

-- 1. Batería en el historial.
alter table vehicle_positions add column if not exists battery_pct smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_positions_battery_pct_range') then
    alter table vehicle_positions add constraint vehicle_positions_battery_pct_range
      check (battery_pct is null or battery_pct between 0 and 100);
  end if;
end $$;

-- 2. Idempotencia: la misma muestra del mismo teléfono para el mismo camión no se guarda dos veces.
create unique index if not exists vehicle_positions_driver_app_dedup_idx
  on vehicle_positions (vehicle_id, captured_at, (coalesce(device_id, '')))
  where source = 'driver_app';

-- 3. Estado vivo: una fila por camión con su última posición.
create table if not exists vehicle_live_state (
  municipality_id uuid not null references municipalities(id),
  vehicle_id uuid primary key references vehicles(id),
  route_run_id uuid references route_runs(id),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  speed numeric,
  heading numeric,
  battery_pct smallint check (battery_pct is null or battery_pct between 0 and 100),
  captured_at timestamptz not null,
  stopped_since timestamptz,
  status text not null default 'disponible' check (status in ('en_ruta', 'detenido', 'sin_senal', 'disponible')),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_live_state_municipality_idx on vehicle_live_state (municipality_id);

alter table vehicle_live_state enable row level security;

drop policy if exists tenant_read_staff on vehicle_live_state;
create policy tenant_read_staff on vehicle_live_state for select
  using (has_municipality_role(municipality_id, array['municipal_admin', 'supervisor', 'dispatcher']));

-- El chofer solo toca (vía ingest_positions) el estado del camión que tiene asignado.
drop policy if exists driver_read_own_live_state on vehicle_live_state;
create policy driver_read_own_live_state on vehicle_live_state for select
  using (
    has_municipality_role(municipality_id, array['driver'])
    and exists (
      select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
      where d.profile_id = auth.uid() and va.vehicle_id = vehicle_live_state.vehicle_id
        and va.municipality_id = vehicle_live_state.municipality_id and va.status = 'assigned'
    )
  );
drop policy if exists driver_insert_own_live_state on vehicle_live_state;
create policy driver_insert_own_live_state on vehicle_live_state for insert
  with check (
    has_municipality_role(municipality_id, array['driver'])
    and exists (
      select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
      where d.profile_id = auth.uid() and va.vehicle_id = vehicle_live_state.vehicle_id
        and va.municipality_id = vehicle_live_state.municipality_id and va.status = 'assigned'
    )
  );
drop policy if exists driver_update_own_live_state on vehicle_live_state;
create policy driver_update_own_live_state on vehicle_live_state for update
  using (
    has_municipality_role(municipality_id, array['driver'])
    and exists (
      select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
      where d.profile_id = auth.uid() and va.vehicle_id = vehicle_live_state.vehicle_id
        and va.municipality_id = vehicle_live_state.municipality_id and va.status = 'assigned'
    )
  )
  with check (
    has_municipality_role(municipality_id, array['driver'])
    and exists (
      select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
      where d.profile_id = auth.uid() and va.vehicle_id = vehicle_live_state.vehicle_id
        and va.municipality_id = vehicle_live_state.municipality_id and va.status = 'assigned'
    )
  );

-- El estado vivo nunca puede apuntar a un camión o corrida de otro municipio.
create or replace function guard_vehicle_live_state_tenant() returns trigger language plpgsql as $$
declare run_row route_runs%rowtype;
begin
  perform assert_same_municipality('vehicles', new.vehicle_id, new.municipality_id);
  if new.route_run_id is not null then
    select * into run_row from route_runs where id = new.route_run_id;
    if not found then raise exception 'Referenced route_run does not exist'; end if;
    if run_row.municipality_id <> new.municipality_id then raise exception 'Cross-tenant reference rejected'; end if;
  end if;
  return new;
end $$;
drop trigger if exists vehicle_live_state_tenant_guard on vehicle_live_state;
create trigger vehicle_live_state_tenant_guard before insert or update on vehicle_live_state
  for each row execute function guard_vehicle_live_state_tenant();

-- 4. Estados derivados (reglas de la sección 4 de la spec). Umbrales: 90 s sin posición; quieto
-- (< 1 m/s) por más de 5 minutos. Sin corrida activa siempre es "disponible" (aunque se mueva).
create or replace function derive_vehicle_status(
  has_active_run boolean,
  last_captured_at timestamptz,
  last_speed numeric,
  stopped_since timestamptz,
  now_ts timestamptz default now()
) returns text language sql immutable as $$
  select case
    when not coalesce(has_active_run, false) then 'disponible'
    when last_captured_at is null or now_ts - last_captured_at > interval '90 seconds' then 'sin_senal'
    when stopped_since is not null and coalesce(last_speed, 0) < 1 and now_ts - stopped_since > interval '5 minutes' then 'detenido'
    else 'en_ruta'
  end
$$;

-- "status" guardado es una foto al escribir; fleet_overview() lo recalcula contra el reloj.
create or replace function set_vehicle_live_state_status() returns trigger language plpgsql as $$
begin
  new.status := derive_vehicle_status(new.route_run_id is not null, new.captured_at, new.speed, new.stopped_since, now());
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists vehicle_live_state_set_status on vehicle_live_state;
create trigger vehicle_live_state_set_status before insert or update on vehicle_live_state
  for each row execute function set_vehicle_live_state_status();

-- 5. Conversiones tolerantes: un valor basura rechaza el punto, no todo el lote.
create or replace function fleet_try_uuid(value text) returns uuid language plpgsql immutable as $$
begin return value::uuid; exception when others then return null; end $$;
create or replace function fleet_try_numeric(value text) returns numeric language plpgsql immutable as $$
begin return value::numeric; exception when others then return null; end $$;
create or replace function fleet_try_timestamptz(value text) returns timestamptz language plpgsql stable as $$
begin return value::timestamptz; exception when others then return null; end $$;

-- 6. Ingesta por lotes. batch = arreglo JSON de puntos
--    { vehicle_id, route_run_id?, device_id?, latitude, longitude, accuracy?, speed?, heading?, battery_pct?, captured_at }.
--    Devuelve { inserted, ignored, rejected }. ignored = ya existía (reenvío); rejected = no pasó validación.
create or replace function ingest_positions(batch jsonb) returns jsonb language plpgsql set search_path = public as $$
declare
  caller uuid := auth.uid();
  total integer;
  result jsonb;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if batch is null or jsonb_typeof(batch) <> 'array' then raise exception 'batch_must_be_array' using errcode = '22023'; end if;
  total := jsonb_array_length(batch);
  if total > 200 then raise exception 'batch_too_large: max 200 points, got %', total using errcode = '54000'; end if;
  if total = 0 then return jsonb_build_object('inserted', 0, 'ignored', 0, 'rejected', 0); end if;

  with parsed as (
    select
      fleet_try_uuid(e ->> 'vehicle_id') as vehicle_id,
      e ->> 'route_run_id' as run_raw,
      fleet_try_uuid(e ->> 'route_run_id') as route_run_id,
      nullif(e ->> 'device_id', '') as device_id,
      fleet_try_numeric(e ->> 'latitude') as latitude,
      fleet_try_numeric(e ->> 'longitude') as longitude,
      fleet_try_numeric(e ->> 'accuracy') as accuracy,
      fleet_try_numeric(e ->> 'speed') as speed,
      fleet_try_numeric(e ->> 'heading') as heading,
      fleet_try_numeric(e ->> 'battery_pct') as battery_raw,
      fleet_try_timestamptz(e ->> 'captured_at') as captured_at
    from jsonb_array_elements(batch) as t(e)
    where jsonb_typeof(e) = 'object'
  ),
  valid as (
    select p.*, v.municipality_id,
           case when p.battery_raw between 0 and 100 then round(p.battery_raw)::smallint end as battery_pct
    from parsed p
    join vehicles v on v.id = p.vehicle_id
    where p.captured_at is not null
      and p.captured_at <= now() + interval '5 minutes'
      and p.latitude between -90 and 90
      and p.longitude between -180 and 180
      and (p.run_raw is null or p.route_run_id is not null)
      and has_municipality_role(v.municipality_id, array['driver'])
      and exists (
        select 1 from drivers d join vehicle_assignments va on va.driver_id = d.id
        where d.profile_id = caller and d.municipality_id = v.municipality_id
          and va.vehicle_id = v.id and va.municipality_id = v.municipality_id and va.status = 'assigned'
      )
      and (
        p.route_run_id is null
        or exists (
          select 1 from route_runs rr join drivers d on d.id = rr.driver_id
          where rr.id = p.route_run_id and rr.vehicle_id = v.id and rr.municipality_id = v.municipality_id
            and rr.status in ('started', 'in_progress', 'delayed') and d.profile_id = caller
        )
      )
  ),
  ins as (
    insert into vehicle_positions
      (municipality_id, vehicle_id, route_run_id, latitude, longitude, accuracy, speed, heading, battery_pct, captured_at, source, device_id)
    select municipality_id, vehicle_id, route_run_id, latitude, longitude, accuracy, speed, heading, battery_pct, captured_at, 'driver_app', device_id
    from valid
    on conflict (vehicle_id, captured_at, (coalesce(device_id, ''))) where source = 'driver_app' do nothing
    returning 1
  ),
  moving as (
    select vehicle_id, max(captured_at) filter (where speed is null or speed >= 1) as last_moving_at
    from valid group by vehicle_id
  ),
  latest as (
    -- Última muestra de cada camión y, si está quieto, desde cuándo: el inicio de la última racha
    -- quieta del lote (un teléfono que sube su cola tras estar sin señal manda varias muestras quietas
    -- juntas). Si el lote no trae ningún punto en movimiento y el camión ya estaba quieto, se conserva
    -- el inicio anterior.
    select distinct on (v.vehicle_id) v.*,
      case when v.speed < 1 then
        case when m.last_moving_at is null and prev.speed < 1 and prev.stopped_since is not null
          then least(prev.stopped_since, run.run_start)
          else run.run_start
        end
      end as stopped_since_new
    from valid v
    join moving m on m.vehicle_id = v.vehicle_id
    left join vehicle_live_state prev on prev.vehicle_id = v.vehicle_id
    cross join lateral (
      select min(x.captured_at) as run_start
      from valid x
      where x.vehicle_id = v.vehicle_id and x.speed < 1
        and (m.last_moving_at is null or x.captured_at > m.last_moving_at)
    ) run
    order by v.vehicle_id, v.captured_at desc
  ),
  live as (
    insert into vehicle_live_state as ls
      (municipality_id, vehicle_id, route_run_id, latitude, longitude, speed, heading, battery_pct, captured_at, stopped_since)
    select municipality_id, vehicle_id, route_run_id, latitude, longitude, speed, heading, battery_pct, captured_at, stopped_since_new
    from latest
    on conflict (vehicle_id) do update set
      route_run_id = excluded.route_run_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      speed = excluded.speed,
      heading = excluded.heading,
      battery_pct = excluded.battery_pct,
      captured_at = excluded.captured_at,
      stopped_since = excluded.stopped_since
    where excluded.captured_at > ls.captured_at
    returning 1
  )
  select jsonb_build_object(
    'inserted', (select count(*) from ins),
    'ignored', (select count(*) from valid) - (select count(*) from ins),
    'rejected', total - (select count(*) from valid)
  ) into result
  from (select 1) as dummy;

  return result;
end $$;

-- Roles que saltan RLS (dueño de la base, service_role, pg_cron): sin usuario no hay auth.uid(), pero
-- sí deben ver toda la flotilla (p. ej. refresh_fleet_alerts() como job de plataforma). Un usuario
-- normal nunca cae aquí.
create or replace function fleet_caller_sees_all() returns boolean language sql stable as $$
  select coalesce((select r.rolsuper or r.rolbypassrls from pg_roles r where r.rolname = current_user), false)
$$;

-- 7. Vista de flotilla: una fila por camión del municipio del usuario (solo administración,
-- supervisión y despacho; un chofer recibe 0 filas). El estado se recalcula contra el reloj.
create or replace function fleet_overview() returns table (
  vehicle_id uuid,
  unit text,
  plate text,
  status text,
  driver_name text,
  route_id uuid,
  route_name text,
  progress integer,
  latitude numeric,
  longitude numeric,
  speed numeric,
  battery_pct smallint,
  captured_at timestamptz,
  seconds_since_report integer
) language sql stable set search_path = public as $$
  select
    v.id,
    v.code,
    v.plate,
    derive_vehicle_status(ar.id is not null, ls.captured_at, ls.speed, ls.stopped_since, now()),
    coalesce(run_driver.display_name, assigned_driver.display_name),
    ar.route_id,
    r.name,
    ar.progress,
    ls.latitude,
    ls.longitude,
    ls.speed,
    ls.battery_pct,
    ls.captured_at,
    case when ls.captured_at is null then null else greatest(0, extract(epoch from now() - ls.captured_at))::integer end
  from vehicles v
  left join lateral (
    select rr.id, rr.route_id, rr.driver_id, rr.progress
    from route_runs rr
    where rr.vehicle_id = v.id and rr.status in ('started', 'in_progress', 'delayed')
    order by coalesce(rr.started_at, rr.created_at) desc
    limit 1
  ) ar on true
  left join routes r on r.id = ar.route_id
  left join drivers run_driver on run_driver.id = ar.driver_id
  left join lateral (
    select d.display_name
    from vehicle_assignments va join drivers d on d.id = va.driver_id
    where va.vehicle_id = v.id and va.status = 'assigned'
    order by va.created_at desc
    limit 1
  ) assigned_driver on true
  left join vehicle_live_state ls on ls.vehicle_id = v.id
  where fleet_caller_sees_all()
     or has_municipality_role(v.municipality_id, array['municipal_admin', 'supervisor', 'dispatcher'])
  order by v.code
$$;

-- Permisos: solo usuarios autenticados (y service_role) ejecutan las RPC; nunca anon/public.
revoke all on function derive_vehicle_status(boolean, timestamptz, numeric, timestamptz, timestamptz) from public, anon;
revoke all on function ingest_positions(jsonb) from public, anon;
revoke all on function fleet_caller_sees_all() from public, anon;
revoke all on function fleet_overview() from public, anon;
revoke all on function fleet_try_uuid(text) from public, anon;
revoke all on function fleet_try_numeric(text) from public, anon;
revoke all on function fleet_try_timestamptz(text) from public, anon;
grant execute on function derive_vehicle_status(boolean, timestamptz, numeric, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function ingest_positions(jsonb) to authenticated, service_role;
grant execute on function fleet_caller_sees_all() to authenticated, service_role;
grant execute on function fleet_overview() to authenticated, service_role;
grant execute on function fleet_try_uuid(text) to authenticated, service_role;
grant execute on function fleet_try_numeric(text) to authenticated, service_role;
grant execute on function fleet_try_timestamptz(text) to authenticated, service_role;

-- SW-110: "Detenido hace 6843 min". ingest_positions() conservaba el stopped_since anterior del camión aunque
-- el punto nuevo perteneciera a OTRA corrida: al iniciar una ruta con el camión todavía quieto, el mapa
-- contaba la parada desde la corrida de días atrás. Ahora la parada solo se hereda dentro de la misma
-- corrida (prev.route_run_id = punto nuevo); al cambiar de corrida el conteo empieza en el primer punto
-- quieto de la corrida nueva. La función es idéntica a la de SW-081 salvo esa condición.
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
             and prev.route_run_id is not distinct from v.route_run_id
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

-- Reparación única: filas de vehicle_live_state cuyo stopped_since es anterior al inicio de su corrida
-- (arrastre ya ocurrido). La parada no puede ser anterior a la corrida: se alinea con su inicio.
update vehicle_live_state ls
set stopped_since = greatest(ls.stopped_since, rr.started_at)
from route_runs rr
where rr.id = ls.route_run_id
  and rr.started_at is not null
  and ls.stopped_since is not null
  and ls.stopped_since < rr.started_at;

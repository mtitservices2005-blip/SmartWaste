-- SW-086: hora de inicio y días por ruta, y repetición automática de la corrida.
-- Aditiva: columnas opcionales y un disparador interno. No cambia ninguna política RLS.

alter table routes add column if not exists start_time time;
alter table routes add column if not exists days_of_week smallint[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'routes_days_of_week_check') then
    alter table routes add constraint routes_days_of_week_check
      check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]);
  end if;
end
$$;

comment on column routes.start_time is 'Hora local de inicio de la ruta (America/Santo_Domingo). Opcional.';
comment on column routes.days_of_week is 'Días en que corre la ruta: 0=domingo ... 6=sábado. Nulo o vacío = todos los días.';

-- Cuando una corrida se completa, se deja lista la siguiente (estado assigned) para que
-- la ruta vuelva a aparecer en la app del conductor. Nunca al verificar, nunca sin camión,
-- nunca si ya hay otra corrida abierta de la misma ruta.
create or replace function repeat_route_run_after_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.vehicle_id is not null
     and not exists (select 1 from route_runs r where r.route_id = new.route_id and r.id <> new.id and r.status in ('planned','assigned','started','in_progress','delayed'))
  then
    insert into route_runs (municipality_id, route_id, vehicle_id, driver_id, status) values (new.municipality_id, new.route_id, new.vehicle_id, new.driver_id, 'assigned');
  end if;
  return new;
end
$$;

revoke all on function repeat_route_run_after_completion() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'route_runs_repeat_after_completion' and not tgisinternal) then
    create trigger route_runs_repeat_after_completion
      after update of status on route_runs
      for each row execute function repeat_route_run_after_completion();
  end if;
end
$$;

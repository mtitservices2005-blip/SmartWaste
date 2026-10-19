-- SW-101: calendario público de rutas para el ciudadano. Solo nombre de ruta, días y hora de salida de las rutas
-- que tienen horario definido (hora de inicio o días). Nada de paradas, conductores, camiones ni estados internos.
-- Dos puertas de lectura para anon: por municipality_id (Portal ciudadano) y por slug (/en-vivo?m=<slug>).
create or replace function public.public_route_schedule(p_municipality_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mun record;
  v_items jsonb;
begin
  select m.id, m.name into v_mun
    from municipalities m
   where m.id = p_municipality_id
     and m.status in ('active', 'onboarding')
   limit 1;

  if v_mun.id is null then
    return jsonb_build_object('municipality', null, 'server_time', now(), 'routes', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.item order by x.start_time nulls last, x.name), '[]'::jsonb) into v_items
    from (
      select r.name as name,
             r.start_time as start_time,
             jsonb_build_object(
               'name', r.name,
               'days_of_week', to_jsonb(r.days_of_week),
               'start_time', r.start_time
             ) as item
        from routes r
       where r.municipality_id = v_mun.id
         and coalesce(r.status, 'planned') not in ('cancelled', 'archived', 'inactive', 'deleted')
         and (r.start_time is not null or coalesce(cardinality(r.days_of_week), 0) > 0)
       order by r.start_time nulls last, r.name
       limit 100
    ) x;

  return jsonb_build_object(
    'municipality', jsonb_build_object('name', v_mun.name),
    'server_time', now(),
    'routes', v_items
  );
end;
$$;

create or replace function public.public_route_schedule(p_municipality_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.public_route_schedule(
    (select m.id from municipalities m
      where m.slug = p_municipality_slug
        and m.status in ('active', 'onboarding')
      limit 1)
  );
$$;

revoke all on function public.public_route_schedule(uuid) from public;
revoke all on function public.public_route_schedule(text) from public;
grant execute on function public.public_route_schedule(uuid) to anon, authenticated;
grant execute on function public.public_route_schedule(text) to anon, authenticated;

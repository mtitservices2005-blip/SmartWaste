-- SW-097: mapa en vivo público para el ciudadano.
-- Una sola puerta de lectura para anon: public_live_fleet(slug). Devuelve solo los camiones con corrida
-- activa hoy (started / in_progress / delayed, sin corridas de prueba) y datos mínimos: código del camión,
-- nombre de la ruta, posición, rumbo, estado simplificado y el trazo de la ruta. No abre tablas ni policies.
create or replace function public.public_live_fleet(p_municipality_slug text)
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
  select m.id, m.name, m.slug into v_mun
    from municipalities m
   where m.slug = p_municipality_slug
     and m.status in ('active', 'onboarding')
   limit 1;

  if v_mun.id is null then
    return jsonb_build_object('municipality', null, 'server_time', now(), 'vehicles', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.item order by x.code), '[]'::jsonb) into v_items
    from (
      select v.code as code,
             jsonb_build_object(
               'code', v.code,
               'route_name', r.name,
               'status', case s.status when 'sin_senal' then 'sin_senal' when 'detenido' then 'detenido' else 'en_ruta' end,
               'lat', s.latitude,
               'lng', s.longitude,
               'heading', s.heading,
               'captured_at', s.captured_at,
               'stopped_since', s.stopped_since,
               'run_started_at', rr.started_at,
               'path', coalesce(
                 (select jsonb_agg(jsonb_build_array(p.latitude, p.longitude) order by p.sequence)
                    from route_paths p
                   where p.route_id = rr.route_id),
                 '[]'::jsonb)
             ) as item
        from vehicle_live_state s
        join route_runs rr on rr.id = s.route_run_id and rr.municipality_id = v_mun.id
        join vehicles v on v.id = s.vehicle_id
        join routes r on r.id = rr.route_id
       where s.municipality_id = v_mun.id
         and rr.status in ('started', 'in_progress', 'delayed')
         and coalesce(rr.is_test, false) = false
       order by v.code
       limit 50
    ) x;

  return jsonb_build_object(
    'municipality', jsonb_build_object('name', v_mun.name, 'slug', v_mun.slug),
    'server_time', now(),
    'vehicles', v_items
  );
end;
$$;

revoke all on function public.public_live_fleet(text) from public;
grant execute on function public.public_live_fleet(text) to anon, authenticated;

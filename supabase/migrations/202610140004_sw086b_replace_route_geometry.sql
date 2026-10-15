-- SW-086b: reemplazar el trazo y las paradas de una ruta de forma atómica (todo o nada).
-- La función comprueba por dentro quién llama, de qué municipio es la ruta y que no esté en marcha.
-- No cambia ninguna política RLS: nadie obtiene permiso de borrado directo sobre las tablas.

create or replace function replace_route_geometry(p_route_id uuid, p_points jsonb, p_stops jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_municipality uuid;
begin
  select municipality_id into v_municipality from routes where id = p_route_id;
  if v_municipality is null then
    raise exception 'ruta no encontrada' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not has_municipality_role(v_municipality, array['municipal_admin','supervisor','dispatcher']) then
    raise exception 'sin permiso para editar esta ruta' using errcode = '42501';
  end if;
  if exists (select 1 from route_runs r where r.route_id = p_route_id and r.status in ('started','in_progress','delayed')) then
    raise exception 'la ruta esta en marcha' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) < 2 then
    raise exception 'el trazo necesita al menos 2 puntos' using errcode = '22023';
  end if;

  delete from route_paths where route_id = p_route_id;
  delete from route_stops where route_id = p_route_id;

  insert into route_paths (municipality_id, route_id, sequence, latitude, longitude)
  select v_municipality, p_route_id, (e->>'sequence')::int, (e->>'latitude')::numeric, (e->>'longitude')::numeric
  from jsonb_array_elements(p_points) e;

  insert into route_stops (municipality_id, route_id, sequence, label, latitude, longitude)
  select v_municipality, p_route_id, (e->>'sequence')::int, e->>'label', (e->>'latitude')::numeric, (e->>'longitude')::numeric
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) e;
end
$$;

revoke all on function replace_route_geometry(uuid, jsonb, jsonb) from public, anon;
grant execute on function replace_route_geometry(uuid, jsonb, jsonb) to authenticated;

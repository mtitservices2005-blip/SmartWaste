-- SW-090: datos para métricas y huella de carbono. Solo agrega columnas y una función; no cambia RLS.
-- El rendimiento (km/L) y el combustible los digita el ayuntamiento; si faltan, no se calcula consumo.

alter table vehicles add column if not exists fuel_efficiency_km_per_l numeric;
alter table vehicles add column if not exists fuel_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_fuel_efficiency_positive') then
    alter table vehicles add constraint vehicles_fuel_efficiency_positive check (fuel_efficiency_km_per_l is null or fuel_efficiency_km_per_l > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_fuel_type_valid') then
    alter table vehicles add constraint vehicles_fuel_type_valid check (fuel_type is null or fuel_type in ('diesel', 'gasolina'));
  end if;
end $$;

alter table route_runs add column if not exists is_test boolean not null default false;

-- Marca o desmarca una corrida como "de prueba" (se excluye de las métricas). Solo personal del municipio.
create or replace function set_route_run_test_flag(p_run_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_municipality uuid;
begin
  select municipality_id into v_municipality from route_runs where id = p_run_id;
  if v_municipality is null then
    raise exception 'corrida no encontrada' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not has_municipality_role(v_municipality, array['municipal_admin','supervisor','dispatcher']) then
    raise exception 'sin permiso para marcar esta corrida' using errcode = '42501';
  end if;
  update route_runs set is_test = coalesce(p_is_test, false), updated_at = now() where id = p_run_id;
end;
$$;

revoke all on function set_route_run_test_flag(uuid, boolean) from public, anon;
grant execute on function set_route_run_test_flag(uuid, boolean) to authenticated;

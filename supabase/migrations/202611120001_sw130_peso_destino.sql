-- SW-130: peso y destino de lo que se recoge. Todo es opcional por ayuntamiento:
-- con báscula (peso exacto), estimado (cuán lleno iba el camión) o solo viaje y destino.
-- Los ajustes viven en municipality_settings.settings.waste { mode, defaultCapacityKg }.
-- Los registros no se editan: una descarga mal anotada se anula con motivo y se vuelve a registrar.

create table if not exists disposal_sites (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'landfill' check (kind in ('landfill','transfer','plant','collection_center','other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists disposal_sites_name_idx on disposal_sites (municipality_id, lower(name));
alter table disposal_sites enable row level security;
revoke all on disposal_sites from anon;
drop policy if exists disposal_sites_read on disposal_sites;
create policy disposal_sites_read on disposal_sites for select using (has_municipality_role(municipality_id));

create table if not exists waste_disposals (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  route_run_id uuid references route_runs(id) on delete set null,
  site_id uuid references disposal_sites(id) on delete set null,
  weight_kg numeric(10,1) check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 100000)),
  weight_source text not null default 'none' check (weight_source in ('scale','estimated','none')),
  ticket_number text check (ticket_number is null or char_length(ticket_number) <= 40),
  fill_level smallint check (fill_level is null or fill_level in (25,50,75,100)),
  note text check (note is null or char_length(note) <= 300),
  unloaded_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  check ((weight_source = 'none' and weight_kg is null) or (weight_source <> 'none' and weight_kg is not null)),
  check (weight_source <> 'estimated' or fill_level is not null)
);
create index if not exists waste_disposals_board_idx on waste_disposals (municipality_id, unloaded_at desc);
alter table waste_disposals enable row level security;
revoke all on waste_disposals from anon;
drop policy if exists waste_disposals_read on waste_disposals;
create policy waste_disposals_read on waste_disposals for select using (has_municipality_role(municipality_id));
-- Sin políticas de insert/update/delete: todo pasa por record_waste_disposal() y void_waste_disposal().

-- Sitios de destino: alta, cambio de nombre/tipo y activar o desactivar (no se borran: las descargas viejas los citan).
create or replace function upsert_disposal_site(p_municipality_id uuid, p_site_id uuid, p_name text, p_kind text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); s disposal_sites;
begin
  if auth.uid() is null or not has_municipality_role(p_municipality_id, array['municipal_admin','supervisor']) then raise exception 'disposal_not_allowed'; end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then raise exception 'disposal_invalid'; end if;
  if p_kind not in ('landfill','transfer','plant','collection_center','other') then raise exception 'disposal_invalid'; end if;
  if p_site_id is null then
    begin
      insert into disposal_sites (municipality_id, name, kind, active) values (p_municipality_id, nm, p_kind, coalesce(p_active, true)) returning * into s;
    exception when unique_violation then raise exception 'disposal_duplicate'; end;
  else
    begin
      update disposal_sites set name = nm, kind = p_kind, active = coalesce(p_active, active), updated_at = now()
        where id = p_site_id and municipality_id = p_municipality_id returning * into s;
    exception when unique_violation then raise exception 'disposal_duplicate'; end;
    if not found then raise exception 'disposal_not_found'; end if;
  end if;
  return jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'active', s.active);
end $$;
revoke all on function upsert_disposal_site(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function upsert_disposal_site(uuid, uuid, text, text, boolean) to authenticated;

-- Registrar una descarga. Con 'estimated' el servidor calcula el peso = capacidad del camión (ajuste) x nivel de llenado.
create or replace function record_waste_disposal(
  p_municipality_id uuid, p_vehicle_id uuid, p_route_run_id uuid, p_site_id uuid,
  p_source text, p_weight_kg numeric default null, p_ticket text default null, p_fill_level integer default null,
  p_note text default null, p_unloaded_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w numeric; cap numeric; tk text := nullif(trim(coalesce(p_ticket, '')), ''); nt text := nullif(trim(coalesce(p_note, '')), ''); d waste_disposals; at timestamptz := coalesce(p_unloaded_at, now());
begin
  if auth.uid() is null or not has_municipality_role(p_municipality_id, array['municipal_admin','supervisor','dispatcher','driver']) then raise exception 'disposal_not_allowed'; end if;
  if p_source not in ('scale','estimated','none') then raise exception 'disposal_invalid'; end if;
  if tk is not null and char_length(tk) > 40 then raise exception 'disposal_invalid'; end if;
  if nt is not null and char_length(nt) > 300 then raise exception 'disposal_invalid'; end if;
  if at > now() + interval '10 minutes' or at < now() - interval '60 days' then raise exception 'disposal_invalid_date'; end if;
  if p_vehicle_id is not null and not exists (select 1 from vehicles where id = p_vehicle_id and municipality_id = p_municipality_id) then raise exception 'disposal_not_found'; end if;
  if p_route_run_id is not null and not exists (select 1 from route_runs where id = p_route_run_id and municipality_id = p_municipality_id) then raise exception 'disposal_not_found'; end if;
  if p_site_id is not null and not exists (select 1 from disposal_sites where id = p_site_id and municipality_id = p_municipality_id and active) then raise exception 'disposal_not_found'; end if;
  if p_source = 'scale' then
    if p_weight_kg is null or p_weight_kg < 0 or p_weight_kg > 100000 then raise exception 'disposal_invalid_weight'; end if;
    w := round(p_weight_kg, 1);
  elsif p_source = 'estimated' then
    if p_fill_level is null or p_fill_level not in (25,50,75,100) then raise exception 'disposal_invalid'; end if;
    select nullif(settings->'waste'->>'defaultCapacityKg', '')::numeric into cap from municipality_settings where municipality_id = p_municipality_id;
    if cap is null or cap <= 0 then raise exception 'disposal_no_capacity'; end if;
    w := round(cap * p_fill_level / 100.0, 1);
  else
    w := null;
  end if;
  insert into waste_disposals (municipality_id, vehicle_id, route_run_id, site_id, weight_kg, weight_source, ticket_number, fill_level, note, unloaded_at)
    values (p_municipality_id, p_vehicle_id, p_route_run_id, p_site_id, w, p_source, tk, case when p_source = 'estimated' then p_fill_level else null end, nt, at) returning * into d;
  return jsonb_build_object('id', d.id, 'weight_kg', d.weight_kg, 'weight_source', d.weight_source);
end $$;
revoke all on function record_waste_disposal(uuid, uuid, uuid, uuid, text, numeric, text, integer, text, timestamptz) from public, anon;
grant execute on function record_waste_disposal(uuid, uuid, uuid, uuid, text, numeric, text, integer, text, timestamptz) to authenticated;

create or replace function void_waste_disposal(p_disposal_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d waste_disposals; why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'disposal_not_allowed'; end if;
  select * into d from waste_disposals where id = p_disposal_id for update;
  if not found then raise exception 'disposal_not_found'; end if;
  if not has_municipality_role(d.municipality_id, array['municipal_admin','supervisor']) then raise exception 'disposal_not_allowed'; end if;
  if why is null or char_length(why) < 3 or char_length(why) > 300 then raise exception 'disposal_invalid'; end if;
  if d.voided_at is not null then raise exception 'disposal_already_voided'; end if;
  update waste_disposals set voided_at = now(), voided_by = auth.uid(), void_reason = why where id = d.id;
  return jsonb_build_object('id', d.id, 'voided', true);
end $$;
revoke all on function void_waste_disposal(uuid, text) from public, anon;
grant execute on function void_waste_disposal(uuid, text) to authenticated;

-- SW-123: chequeo mecánico del camión antes de salir a su ruta.
-- El chofer registra el chequeo con submit_vehicle_inspection(); los registros no se pueden editar ni borrar (solo se agregan).
-- Cada falla crea una "falla abierta" (vehicle_defects) que el administrador atiende (hito SW-124).
-- Los interruptores del administrador viven en municipality_settings.settings.inspection { required, allowCritical }.

create table if not exists vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  driver_id uuid references drivers(id) on delete set null,
  route_run_id uuid references route_runs(id) on delete set null,
  inspected_by uuid default auth.uid(),
  result text not null check (result in ('ok','minor','critical')),
  departed boolean not null default true,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_inspections_vehicle_idx on vehicle_inspections (vehicle_id, created_at desc);
create index if not exists vehicle_inspections_muni_idx on vehicle_inspections (municipality_id, created_at desc);

create table if not exists vehicle_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references vehicle_inspections(id) on delete cascade,
  municipality_id uuid not null references municipalities(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 60),
  label text not null check (char_length(label) between 1 and 120),
  status text not null check (status in ('ok','fail')),
  severity text check (severity in ('minor','critical')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  check ((status = 'ok' and severity is null) or (status = 'fail' and severity is not null))
);
create index if not exists vehicle_inspection_items_insp_idx on vehicle_inspection_items (inspection_id);

create table if not exists vehicle_defects (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  inspection_id uuid references vehicle_inspections(id) on delete set null,
  item_key text not null,
  label text not null,
  severity text not null check (severity in ('minor','critical')),
  note text,
  status text not null default 'reported' check (status in ('reported','in_review','fixed','verified')),
  reported_by uuid default auth.uid(),
  reported_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  verified_by uuid,
  verified_at timestamptz
);
create index if not exists vehicle_defects_open_idx on vehicle_defects (municipality_id, status, reported_at desc);
create index if not exists vehicle_defects_vehicle_idx on vehicle_defects (vehicle_id, status);

alter table vehicle_inspections enable row level security;
alter table vehicle_inspection_items enable row level security;
alter table vehicle_defects enable row level security;
revoke all on vehicle_inspections, vehicle_inspection_items, vehicle_defects from anon;

-- Leer: todo el equipo del ayuntamiento (el chofer necesita ver las fallas abiertas de su camión).
drop policy if exists insp_read on vehicle_inspections;
create policy insp_read on vehicle_inspections for select using (has_municipality_role(municipality_id));
drop policy if exists insp_items_read on vehicle_inspection_items;
create policy insp_items_read on vehicle_inspection_items for select using (has_municipality_role(municipality_id));
drop policy if exists defects_read on vehicle_defects;
create policy defects_read on vehicle_defects for select using (has_municipality_role(municipality_id));
-- Escribir: chequeos e ítems solo por submit_vehicle_inspection() (sin políticas de insert/update/delete = nadie más escribe).
-- Las fallas las atiende solo la administración (el chofer no puede cerrar sus propias fallas).
drop policy if exists defects_update_staff on vehicle_defects;
create policy defects_update_staff on vehicle_defects for update
  using (has_municipality_role(municipality_id, array['municipal_admin','supervisor']))
  with check (has_municipality_role(municipality_id, array['municipal_admin','supervisor']));

create or replace function submit_vehicle_inspection(p_vehicle_id uuid, p_route_run_id uuid, p_items jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v vehicles;
  drv uuid;
  allow_critical boolean := true;
  has_critical boolean := false;
  has_fail boolean := false;
  res text;
  departed boolean;
  insp uuid;
  it jsonb;
  created integer := 0;
begin
  if auth.uid() is null then raise exception 'inspection_not_allowed'; end if;
  select * into v from vehicles where id = p_vehicle_id;
  if not found then raise exception 'inspection_vehicle'; end if;
  if not has_municipality_role(v.municipality_id) then raise exception 'inspection_not_allowed'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then raise exception 'inspection_invalid'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'inspection_invalid'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(it->>'key','') = '' or char_length(it->>'key') > 60
       or coalesce(it->>'label','') = '' or char_length(it->>'label') > 120
       or (it->>'status') not in ('ok','fail')
       or ((it->>'status') = 'fail' and coalesce(it->>'severity','') not in ('minor','critical'))
       or ((it->>'status') = 'ok' and it->>'severity' is not null)
       or (it->>'note' is not null and char_length(it->>'note') > 300) then
      raise exception 'inspection_invalid';
    end if;
    if (it->>'status') = 'fail' then has_fail := true; end if;
    if (it->>'status') = 'fail' and (it->>'severity') = 'critical' then has_critical := true; end if;
  end loop;

  select coalesce((settings->'inspection'->>'allowCritical')::boolean, true) into allow_critical
    from municipality_settings where municipality_id = v.municipality_id;
  allow_critical := coalesce(allow_critical, true);
  res := case when has_critical then 'critical' when has_fail then 'minor' else 'ok' end;
  departed := not (has_critical and not allow_critical);

  select id into drv from drivers where municipality_id = v.municipality_id and profile_id = auth.uid() limit 1;

  insert into vehicle_inspections (municipality_id, vehicle_id, driver_id, route_run_id, result, departed, note)
    values (v.municipality_id, v.id, drv, p_route_run_id, res, departed, nullif(trim(p_note), ''))
    returning id into insp;

  insert into vehicle_inspection_items (inspection_id, municipality_id, item_key, label, status, severity, note)
    select insp, v.municipality_id, x->>'key', x->>'label', x->>'status', x->>'severity', nullif(trim(x->>'note'), '')
    from jsonb_array_elements(p_items) x;

  -- Una falla abierta por camión y punto: si ya existe, no se duplica.
  for it in select * from jsonb_array_elements(p_items) x where x->>'status' = 'fail' loop
    if not exists (select 1 from vehicle_defects d where d.vehicle_id = v.id and d.item_key = it->>'key' and d.status <> 'verified') then
      insert into vehicle_defects (municipality_id, vehicle_id, inspection_id, item_key, label, severity, note)
        values (v.municipality_id, v.id, insp, it->>'key', it->>'label', it->>'severity', nullif(trim(it->>'note'), ''));
      created := created + 1;
    end if;
  end loop;

  return jsonb_build_object('inspection_id', insp, 'result', res, 'departed', departed, 'defects_created', created);
end $$;
revoke all on function submit_vehicle_inspection(uuid, uuid, jsonb, text) from public, anon;
grant execute on function submit_vehicle_inspection(uuid, uuid, jsonb, text) to authenticated;

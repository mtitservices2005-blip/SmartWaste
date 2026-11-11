-- SW-127: reportes de basura acumulada que llegan desde Saibot.
-- La función de borde saibot-ingest-report (clave por ayuntamiento) inserta con service_role; el personal del ayuntamiento
-- solo lee y cierra reportes por funciones que validan rol y recorrido. La clave nunca se guarda: solo su hash (SHA-256).

create table if not exists saibot_integrations (
  municipality_id uuid primary key references municipalities(id) on delete cascade,
  key_hash text not null,
  key_last4 text not null,
  enabled boolean not null default true,
  callback_url text check (callback_url is null or (callback_url ~ '^https://[^[:space:]]+$' and char_length(callback_url) <= 500)),
  callback_secret text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists saibot_integrations_key_hash_idx on saibot_integrations (key_hash);
alter table saibot_integrations enable row level security;
revoke all on saibot_integrations from anon, authenticated;
-- Política que niega todo a los clientes: la clave solo la tocan las funciones del servidor (tests/rls-coverage.test.mjs exige al menos una política por tabla con RLS).
drop policy if exists saibot_integrations_no_client_access on saibot_integrations;
create policy saibot_integrations_no_client_access on saibot_integrations for all using (false) with check (false);

create table if not exists waste_reports (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  source text not null default 'saibot' check (source in ('saibot')),
  external_id text not null check (char_length(external_id) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  reference text check (reference is null or char_length(reference) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  photo_urls text[] not null default '{}' check (cardinality(photo_urls) <= 5),
  reported_at timestamptz not null,
  status text not null default 'new' check (status in ('new','assigned','collected','rejected')),
  assigned_vehicle_id uuid references vehicles(id) on delete set null,
  assigned_run_id uuid references route_runs(id) on delete set null,
  assigned_at timestamptz,
  attended_at timestamptz,
  attended_by uuid,
  attended_note text check (attended_note is null or char_length(attended_note) <= 300),
  saibot_sync text not null default 'not_needed' check (saibot_sync in ('not_needed','pending','sent','failed')),
  saibot_sync_attempts integer not null default 0,
  saibot_sync_error text,
  saibot_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  unique (municipality_id, source, external_id)
);
create index if not exists waste_reports_board_idx on waste_reports (municipality_id, status, reported_at desc);
alter table waste_reports enable row level security;
revoke all on waste_reports from anon;
drop policy if exists waste_reports_read on waste_reports;
create policy waste_reports_read on waste_reports for select using (has_municipality_role(municipality_id));
-- Sin políticas de insert/update/delete: los cambios pasan por saibot-ingest-report y update_waste_report_status().

-- Cerrar un reporte: atendido o no procede. El aviso a Saibot queda pendiente (lo envía el hito SW-128).
create or replace function update_waste_report_status(p_report_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r waste_reports; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'waste_not_allowed'; end if;
  select * into r from waste_reports where id = p_report_id for update;
  if not found then raise exception 'waste_not_found'; end if;
  if not has_municipality_role(r.municipality_id, array['municipal_admin','supervisor']) then raise exception 'waste_not_allowed'; end if;
  if p_status not in ('collected','rejected') then raise exception 'waste_invalid'; end if;
  if note is not null and char_length(note) > 300 then raise exception 'waste_invalid'; end if;
  if p_status = 'rejected' and (note is null or char_length(note) < 3) then raise exception 'waste_invalid'; end if;
  if r.status not in ('new','assigned') then raise exception 'waste_transition'; end if;
  update waste_reports set status = p_status, attended_at = now(), attended_by = auth.uid(), attended_note = note,
    saibot_sync = 'pending', updated_at = now() where id = r.id;
  return jsonb_build_object('id', r.id, 'status', p_status);
end $$;
revoke all on function update_waste_report_status(uuid, text, text) from public, anon;
grant execute on function update_waste_report_status(uuid, text, text) to authenticated;

-- Clave de la integración: se muestra una sola vez; generar otra deja sin efecto la anterior.
create or replace function generate_saibot_key(p_municipality_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null or not has_municipality_role(p_municipality_id, array['municipal_admin']) then raise exception 'saibot_not_allowed'; end if;
  k := 'swk_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into saibot_integrations (municipality_id, key_hash, key_last4)
    values (p_municipality_id, encode(sha256(convert_to(k, 'utf8')), 'hex'), right(k, 4))
  on conflict (municipality_id) do update set key_hash = excluded.key_hash, key_last4 = excluded.key_last4, enabled = true, updated_at = now();
  return jsonb_build_object('key', k, 'last4', right(k, 4));
end $$;
revoke all on function generate_saibot_key(uuid) from public, anon;
grant execute on function generate_saibot_key(uuid) to authenticated;

create or replace function get_saibot_integration(p_municipality_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s saibot_integrations;
begin
  if auth.uid() is null or not has_municipality_role(p_municipality_id, array['municipal_admin']) then raise exception 'saibot_not_allowed'; end if;
  select * into s from saibot_integrations where municipality_id = p_municipality_id;
  if not found then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object('configured', true, 'enabled', s.enabled, 'last4', s.key_last4, 'callback_url', s.callback_url, 'last_used_at', s.last_used_at);
end $$;
revoke all on function get_saibot_integration(uuid) from public, anon;
grant execute on function get_saibot_integration(uuid) to authenticated;

create or replace function set_saibot_integration(p_municipality_id uuid, p_enabled boolean, p_callback_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare url text := nullif(trim(coalesce(p_callback_url, '')), '');
begin
  if auth.uid() is null or not has_municipality_role(p_municipality_id, array['municipal_admin']) then raise exception 'saibot_not_allowed'; end if;
  if url is not null and (url !~ '^https://[^[:space:]]+$' or char_length(url) > 500) then raise exception 'saibot_invalid_url'; end if;
  update saibot_integrations set enabled = coalesce(p_enabled, enabled), callback_url = url, updated_at = now() where municipality_id = p_municipality_id;
  if not found then raise exception 'saibot_no_key'; end if;
  return jsonb_build_object('enabled', coalesce(p_enabled, true), 'callback_url', url);
end $$;
revoke all on function set_saibot_integration(uuid, boolean, text) from public, anon;
grant execute on function set_saibot_integration(uuid, boolean, text) to authenticated;

-- SW-117: licencia por camión. Cada ayuntamiento contrata una cantidad de camiones y paga una tarifa por camión al año.
-- El estado (prueba, activo, por vencer, vencido, suspendido) NO se guarda: se calcula de la vigencia y la gracia.
-- Un ayuntamiento sin fila en municipality_licenses no tiene límites (p. ej. la organización de la plataforma).
-- El administrador del ayuntamiento solo LEE su licencia; suma camiones con add_licensed_trucks(); Master Admin escribe.
-- La app del chofer no se toca: ninguna regla de licencia bloquea iniciar, registrar ni cerrar corridas.

create table if not exists municipality_licenses (
  municipality_id uuid primary key references municipalities(id) on delete cascade,
  is_trial boolean not null default true,
  valid_until date not null,
  contracted_trucks integer not null check (contracted_trucks >= 0),
  price_per_truck_year numeric(12,2) not null default 0 check (price_per_truck_year >= 0),
  currency text not null default 'USD' check (currency in ('USD','DOP')),
  billing_mode text not null default 'manual' check (billing_mode in ('manual','automatic')),
  grace_days integer not null default 15 check (grace_days between 0 and 90),
  suspended boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists license_events (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references municipalities(id) on delete cascade,
  type text not null check (type in ('alta','ampliacion','pago','cambio_estado','ajuste')),
  trucks_delta integer,
  amount numeric(12,2),
  currency text,
  billed boolean not null default false,
  reference text,
  detail text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists license_events_muni_idx on license_events (municipality_id, created_at desc);

alter table municipality_licenses enable row level security;
alter table license_events enable row level security;
revoke all on municipality_licenses, license_events from anon;

drop policy if exists license_read on municipality_licenses;
create policy license_read on municipality_licenses for select
  using (has_municipality_role(municipality_id, array['municipal_admin','supervisor','dispatcher']));
drop policy if exists license_write_superadmin on municipality_licenses;
create policy license_write_superadmin on municipality_licenses for all
  using (has_platform_role('mt_superadmin')) with check (has_platform_role('mt_superadmin'));

drop policy if exists license_events_read on license_events;
create policy license_events_read on license_events for select
  using (has_municipality_role(municipality_id, array['municipal_admin']));
drop policy if exists license_events_write_superadmin on license_events;
create policy license_events_write_superadmin on license_events for all
  using (has_platform_role('mt_superadmin')) with check (has_platform_role('mt_superadmin'));

-- Mismo cálculo que shared/license.js (licenseStatus). Fechas en UTC (current_date del servidor).
create or replace function license_effective_status(p_suspended boolean, p_is_trial boolean, p_valid_until date, p_grace_days integer)
returns text language sql stable set search_path = public as $$
  select case
    when p_suspended then 'suspendido'
    when p_valid_until is null then 'suspendido'
    when (p_valid_until - current_date) < -coalesce(p_grace_days, 15) then 'suspendido'
    when (p_valid_until - current_date) < 0 then 'vencido'
    when p_is_trial then 'prueba'
    when (p_valid_until - current_date) <= 15 then 'por_vencer'
    else 'activo'
  end
$$;

-- Bloqueos reales: crear camiones (tope contratado), rutas y conductores (solo si está suspendida).
create or replace function enforce_license() returns trigger language plpgsql security definer set search_path = public as $$
declare
  lic municipality_licenses;
  used integer;
begin
  select * into lic from municipality_licenses where municipality_id = new.municipality_id for update;
  if not found then return new; end if;
  if license_effective_status(lic.suspended, lic.is_trial, lic.valid_until, lic.grace_days) = 'suspendido' then
    raise exception 'license_suspended';
  end if;
  if tg_table_name = 'vehicles' then
    select count(*) into used from vehicles where municipality_id = new.municipality_id;
    if used >= lic.contracted_trucks then
      raise exception 'license_truck_limit: % de % camiones contratados', used, lic.contracted_trucks;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sw117_license_vehicles on vehicles;
create trigger sw117_license_vehicles before insert on vehicles for each row execute function enforce_license();
drop trigger if exists sw117_license_routes on routes;
create trigger sw117_license_routes before insert on routes for each row execute function enforce_license();
drop trigger if exists sw117_license_drivers on drivers;
create trigger sw117_license_drivers before insert on drivers for each row execute function enforce_license();

-- El administrador del ayuntamiento suma camiones al instante (1 a 10 por vez). Cargo proporcional a los días restantes.
create or replace function add_licensed_trucks(p_municipality_id uuid, p_trucks integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lic municipality_licenses;
  days integer;
  amt numeric(12,2);
begin
  if auth.uid() is null then raise exception 'license_forbidden' using errcode = '28000'; end if;
  if not has_municipality_role(p_municipality_id, array['municipal_admin']) then raise exception 'license_forbidden' using errcode = '42501'; end if;
  if p_trucks is null or p_trucks < 1 or p_trucks > 10 then raise exception 'license_invalid_trucks' using errcode = '22023'; end if;
  select * into lic from municipality_licenses where municipality_id = p_municipality_id for update;
  if not found then raise exception 'license_not_found' using errcode = 'P0002'; end if;
  if license_effective_status(lic.suspended, lic.is_trial, lic.valid_until, lic.grace_days) = 'suspendido' then raise exception 'license_suspended'; end if;
  days := lic.valid_until - current_date;
  if lic.is_trial or days <= 0 or lic.price_per_truck_year <= 0 then amt := null;
  else amt := round(p_trucks * lic.price_per_truck_year * least(days, 365) / 365.0, 2);
  end if;
  update municipality_licenses set contracted_trucks = contracted_trucks + p_trucks, updated_at = now() where municipality_id = p_municipality_id;
  insert into license_events (municipality_id, type, trucks_delta, amount, currency, billed, detail, created_by)
  values (p_municipality_id, 'ampliacion', p_trucks, amt, lic.currency, false,
          format('+%s camión(es); total contratado %s', p_trucks, lic.contracted_trucks + p_trucks), auth.uid());
  return jsonb_build_object('contracted_trucks', lic.contracted_trucks + p_trucks, 'amount', amt, 'currency', lic.currency);
end $$;

-- Master Admin registra un pago: extiende la vigencia (desde hoy o desde el vencimiento, lo que sea mayor) y activa la licencia.
create or replace function register_license_payment(p_municipality_id uuid, p_amount numeric, p_period text, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lic municipality_licenses;
  new_until date;
begin
  if not has_platform_role('mt_superadmin') then raise exception 'license_forbidden' using errcode = '42501'; end if;
  if p_period not in ('mensual','trimestral','anual') then raise exception 'license_invalid_period' using errcode = '22023'; end if;
  select * into lic from municipality_licenses where municipality_id = p_municipality_id for update;
  if not found then raise exception 'license_not_found' using errcode = 'P0002'; end if;
  new_until := (greatest(lic.valid_until, current_date) + case p_period when 'mensual' then interval '1 month' when 'trimestral' then interval '3 months' else interval '1 year' end)::date;
  update municipality_licenses set valid_until = new_until, is_trial = false, suspended = false, updated_at = now() where municipality_id = p_municipality_id;
  insert into license_events (municipality_id, type, amount, currency, billed, reference, detail, created_by)
  values (p_municipality_id, 'pago', p_amount, lic.currency, true, nullif(p_reference, ''), format('Pago %s; vigencia hasta %s', p_period, new_until), auth.uid());
  return jsonb_build_object('valid_until', new_until);
end $$;

-- Master Admin suspende o reactiva, con registro en el historial.
create or replace function set_license_suspended(p_municipality_id uuid, p_suspended boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_role('mt_superadmin') then raise exception 'license_forbidden' using errcode = '42501'; end if;
  update municipality_licenses set suspended = coalesce(p_suspended, false), updated_at = now() where municipality_id = p_municipality_id;
  if not found then raise exception 'license_not_found' using errcode = 'P0002'; end if;
  insert into license_events (municipality_id, type, detail, created_by)
  values (p_municipality_id, 'cambio_estado', case when p_suspended then 'Suspendida por MT IT Services' else 'Reactivada por MT IT Services' end, auth.uid());
  return jsonb_build_object('suspended', coalesce(p_suspended, false));
end $$;

revoke all on function add_licensed_trucks(uuid, integer) from public, anon;
revoke all on function register_license_payment(uuid, numeric, text, text) from public, anon;
revoke all on function set_license_suspended(uuid, boolean) from public, anon;
grant execute on function add_licensed_trucks(uuid, integer) to authenticated;
grant execute on function register_license_payment(uuid, numeric, text, text) to authenticated;
grant execute on function set_license_suspended(uuid, boolean) to authenticated;

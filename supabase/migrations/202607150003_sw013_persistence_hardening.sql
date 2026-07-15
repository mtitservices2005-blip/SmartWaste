-- SW-013 local-only persistence hardening. Do not apply to remote without review.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'municipality_settings_one_per_municipality') then
    alter table municipality_settings add constraint municipality_settings_one_per_municipality unique (municipality_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memberships_role_check') then
    alter table memberships add constraint memberships_role_check check (role in ('mt_superadmin','municipal_admin','supervisor','dispatcher','driver'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_state_check') then
    alter table vehicles add constraint vehicles_state_check check (state in ('active','stopped','delayed','offline','completed','maintenance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drivers_status_check') then
    alter table drivers add constraint drivers_status_check check (status in ('available','assigned','off_duty','suspended'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routes_status_check') then
    alter table routes add constraint routes_status_check check (status in ('planned','assigned','started','in_progress','delayed','completed','verified','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'route_runs_status_check') then
    alter table route_runs add constraint route_runs_status_check check (status in ('planned','assigned','started','in_progress','delayed','completed','verified','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_status_check') then
    alter table incidents add constraint incidents_status_check check (status in ('open','triaged','assigned','in_progress','resolved','verified','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_priority_check') then
    alter table incidents add constraint incidents_priority_check check (priority in ('low','medium','high','critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_positions_latitude_check') then
    alter table vehicle_positions add constraint vehicle_positions_latitude_check check (latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_positions_longitude_check') then
    alter table vehicle_positions add constraint vehicle_positions_longitude_check check (longitude between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_positions_source_check') then
    alter table vehicle_positions add constraint vehicle_positions_source_check check (source in ('driver_app','browser_geolocation','dedicated_tracker','external_authorized','simulator'));
  end if;
end $$;
alter table vehicles add column if not exists version integer not null default 1;
alter table routes add column if not exists version integer not null default 1;
alter table route_runs add column if not exists version integer not null default 1;
alter table incidents add column if not exists version integer not null default 1;

create or replace function set_updated_at_and_version() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' and new.version is not null then
    new.version = old.version + 1;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'vehicles_updated_at_version') then
    create trigger vehicles_updated_at_version before update on vehicles for each row execute function set_updated_at_and_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'routes_updated_at_version') then
    create trigger routes_updated_at_version before update on routes for each row execute function set_updated_at_and_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'route_runs_updated_at_version') then
    create trigger route_runs_updated_at_version before update on route_runs for each row execute function set_updated_at_and_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'incidents_updated_at_version') then
    create trigger incidents_updated_at_version before update on incidents for each row execute function set_updated_at_and_version();
  end if;
end $$;

create index if not exists vehicles_municipality_state_idx on vehicles(municipality_id, state);
create index if not exists routes_municipality_status_idx on routes(municipality_id, status);
create index if not exists vehicle_positions_vehicle_recorded_idx on vehicle_positions(vehicle_id, captured_at desc);

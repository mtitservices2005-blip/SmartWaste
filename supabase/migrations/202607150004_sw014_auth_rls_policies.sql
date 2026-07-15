-- SW-014 local-only Auth/RLS policies. Requires Supabase Auth; not remotely applied.
alter table municipalities enable row level security;
alter table municipality_settings enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table sectors enable row level security;
alter table route_stops enable row level security;
alter table vehicle_assignments enable row level security;
alter table audit_events enable row level security;
alter table integration_events enable row level security;

create or replace function current_profile_id() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function has_platform_role(required_role text default 'mt_superadmin') returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.profile_id = auth.uid() and m.role = required_role and m.status = 'active')
$$;
create or replace function has_municipality_role(target_municipality_id uuid, allowed_roles text[] default array['municipal_admin','supervisor','dispatcher','driver']) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.profile_id = auth.uid() and m.municipality_id = target_municipality_id and m.role = any(allowed_roles) and m.status = 'active')
    or has_platform_role('mt_superadmin')
$$;

do $$
declare t text;
begin
  foreach t in array array['vehicles','drivers','sectors','routes','route_stops','route_runs','vehicle_assignments','vehicle_positions','incidents','citizen_reports','municipality_settings','audit_events','integration_events'] loop
    execute format('drop policy if exists tenant_read on %I', t);
    execute format('create policy tenant_read on %I for select using (has_municipality_role(municipality_id))', t);
    execute format('drop policy if exists tenant_insert_staff on %I', t);
    execute format('create policy tenant_insert_staff on %I for insert with check (has_municipality_role(municipality_id, array[''municipal_admin'',''supervisor'',''dispatcher'']))', t);
    execute format('drop policy if exists tenant_update_staff on %I', t);
    execute format('create policy tenant_update_staff on %I for update using (has_municipality_role(municipality_id, array[''municipal_admin'',''supervisor'',''dispatcher''])) with check (has_municipality_role(municipality_id, array[''municipal_admin'',''supervisor'',''dispatcher'']))', t);
  end loop;
end $$;

drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles for select using (id = auth.uid() or has_platform_role('mt_superadmin'));
drop policy if exists memberships_self_read on memberships;
create policy memberships_self_read on memberships for select using (profile_id = auth.uid() or has_platform_role('mt_superadmin') or has_municipality_role(municipality_id, array['municipal_admin']));
drop policy if exists municipalities_member_read on municipalities;
create policy municipalities_member_read on municipalities for select using (has_platform_role('mt_superadmin') or exists (select 1 from memberships m where m.profile_id = auth.uid() and m.municipality_id = municipalities.id and m.status = 'active'));

-- SW-020: fixes two RLS gaps found in the current-state audit (docs/CURRENT_STATE_AUDIT.md), plus a
-- third blocking gap found while verifying against a real local instance: none of the 5 prior
-- migrations granted table-level privileges to anon/authenticated/service_role in the public
-- schema (only schema USAGE came from Supabase's own bootstrap). Without this, every query fails
-- with "permission denied for table X" before RLS policies are even evaluated — including for
-- service_role, which has BYPASSRLS but still needs the base object grant. Local-only, verified
-- against a local Supabase instance. Does not modify the 5 prior migrations.

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

-- Gap 1: 'driver' had no insert/update policy anywhere. tenant_insert_staff / tenant_update_staff
-- (202607150004:28,30) intentionally stay staff-only (municipal_admin, supervisor, dispatcher) so a
-- driver cannot write vehicles/routes/other drivers' data. Instead, grant narrow, scoped policies
-- limited to the driver's own route_run, own assigned vehicle's position, and incidents tied to
-- their own assignment, matching PERMISSIONS.driver in shared/auth-context.js (routes.start,
-- routes.progress, incidents.create).

create or replace function current_driver_id(target_municipality_id uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from drivers where profile_id = auth.uid() and municipality_id = target_municipality_id limit 1
$$;

-- PERMISSIONS.driver (shared/auth-context.js) only grants routes.start and routes.progress, not
-- routes.verify (supervisor-only) or reassignment/cancellation (dispatcher-only), so the check
-- also bounds which target statuses a driver may set.
drop policy if exists driver_update_own_route_run on route_runs;
create policy driver_update_own_route_run on route_runs for update
  using (driver_id = current_driver_id(municipality_id))
  with check (
    driver_id = current_driver_id(municipality_id)
    and status in ('started', 'in_progress', 'delayed', 'completed')
  );

drop policy if exists driver_insert_own_vehicle_position on vehicle_positions;
create policy driver_insert_own_vehicle_position on vehicle_positions for insert
  with check (
    exists (
      select 1 from vehicle_assignments va
      join drivers d on d.id = va.driver_id
      where d.profile_id = auth.uid()
        and va.vehicle_id = vehicle_positions.vehicle_id
        and va.municipality_id = vehicle_positions.municipality_id
        and va.status = 'assigned'
    )
  );

drop policy if exists driver_insert_own_incident on incidents;
create policy driver_insert_own_incident on incidents for insert
  with check (
    current_driver_id(incidents.municipality_id) is not null
    and (
      incidents.route_run_id is null
      or exists (
        select 1 from route_runs rr
        where rr.id = incidents.route_run_id
          and rr.driver_id = current_driver_id(incidents.municipality_id)
      )
    )
    and (
      incidents.vehicle_id is null
      or exists (
        select 1 from vehicle_assignments va
        where va.vehicle_id = incidents.vehicle_id
          and va.driver_id = current_driver_id(incidents.municipality_id)
          and va.status = 'assigned'
      )
    )
  );

-- Gap 2: citizen_reports only had tenant_insert_staff (staff-only), so the anonymous citizen
-- portal described in shared/citizen-portal.js and shared/channel-contracts.js could never
-- persist a report. Add an anon insert policy with anti-abuse checks: report must start in
-- 'received' status (can't self-resolve), must use a public channel (not 'internal'), municipality
-- must exist and be onboarded/active, and folio/description are bounded. No anon SELECT policy is
-- granted — the folio is client-supplied so no read-back is needed, and broad anon SELECT would
-- leak every citizen's reports in a municipality to any anonymous caller. Callers on the anon key
-- MUST NOT chain .select() (or Prefer: return=representation) on this insert: PostgREST performs
-- INSERT ... RETURNING, and with no visible SELECT policy for anon it reports the invisible
-- RETURNING row as an RLS violation on the insert itself, even though the row was written. Use a
-- plain .insert(...) (return=minimal) instead; see tests/rls-adversarial.test.mjs.

-- anon has no SELECT policy on municipalities (municipalities_member_read is members-only), so the
-- active/onboarding check below must go through a security definer function rather than a plain
-- EXISTS subquery — otherwise RLS on municipalities silently hides the row from the anon subquery
-- and the check always evaluates false, rejecting every anonymous insert.
create or replace function municipality_is_onboarded(target_municipality_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from municipalities m where m.id = target_municipality_id and m.status in ('active', 'onboarding'))
$$;

drop policy if exists anon_insert_citizen_report on citizen_reports;
create policy anon_insert_citizen_report on citizen_reports for insert
  to anon
  with check (
    status = 'received'
    and channel in ('web', 'chatbot', 'whatsapp')
    and folio is not null and char_length(folio) between 4 and 40
    and (description is null or char_length(description) <= 2000)
    and municipality_is_onboarded(citizen_reports.municipality_id)
  );

-- SW-044: route_runs had no way to capture "when did this run actually start/finish" — only
-- `status` transitions (supabase/migrations/202607150001_sw007_foundation.sql) and `updated_at`,
-- which gets overwritten on every transition, so a completed run's real duration was never
-- recoverable. shared/operations-adapter.js's startRoute()/completeRoute() already exist as
-- transition functions but nothing in frontend/app.js ever called startRoute() — there was no
-- "iniciar ruta" gesture in the UI at all, only routes jumping straight from assigned to
-- completed. This migration adds the columns; the UI wiring for "Iniciar ruta" and stamping these
-- at transition time is in shared/operations-adapter.js/frontend/app.js, not here.
alter table route_runs add column if not exists started_at timestamptz;
alter table route_runs add column if not exists completed_at timestamptz;

-- Backfill for any route_run that reached a terminal/in-progress status before this column
-- existed: there's no way to recover the real historical timestamp, so this deliberately does NOT
-- guess one (unlike sw030_route_run_progress's progress backfill, which had an unambiguous correct
-- value). Leaving started_at/completed_at null for pre-existing rows means their duration simply
-- won't be measurable — the UI must treat null as "no medido", never estimate a fake timestamp.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_runs_completed_after_started') then
    alter table route_runs add constraint route_runs_completed_after_started
      check (completed_at is null or started_at is null or completed_at >= started_at);
  end if;
end $$;

-- SW-030: route_runs never had a numeric progress column — only `status` (supabase/migrations/
-- 202607150001_sw007_foundation.sql). shared/operations-adapter.js's updateProgress(routeId,
-- progress) silently discarded the numeric value against real Supabase, only ever writing the
-- derived status ('in_progress'/'completed') — flagged as unresolved in
-- docs/TECHNICAL_DEBT_REGISTER.md item 4. Adding the column here is what lets that value actually
-- persist.
alter table route_runs add column if not exists progress integer not null default 0;

-- Any route_run that already reached completed/verified before this column existed must not read
-- back as 0% done — that contradicts the adapter's own completion semantics (completeRoute sets
-- progress to 100, see shared/operations-adapter.js) and would corrupt historical reporting.
update route_runs set progress = 100 where status in ('completed', 'verified') and progress <> 100;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_runs_progress_range') then
    alter table route_runs add constraint route_runs_progress_range check (progress between 0 and 100);
  end if;
end $$;

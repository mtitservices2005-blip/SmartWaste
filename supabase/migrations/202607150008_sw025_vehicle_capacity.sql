-- SW-025: adds vehicle capacity so the route engine (shared/route-engine.js) can decide where to
-- cut a generated point sequence into separate trips once it exceeds what a truck can carry in one
-- pass. No existing column captured this — vehicles only had code/plate/state (supabase/migrations/
-- 202607150001_sw007_foundation.sql:6). 20 is a reasonable default for the existing demo-scale
-- routes (docs/DATA_MODEL_V2.md's demo routes have 6-14 stops each), not a real fleet capacity.
alter table vehicles add column if not exists max_stops integer not null default 20;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_max_stops_positive') then
    alter table vehicles add constraint vehicles_max_stops_positive check (max_stops > 0);
  end if;
end $$;

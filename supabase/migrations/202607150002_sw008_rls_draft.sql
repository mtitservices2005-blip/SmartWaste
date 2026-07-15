-- SW-008 local RLS draft. Not applied remotely.
alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table routes enable row level security;
alter table route_runs enable row level security;
alter table vehicle_positions enable row level security;
alter table incidents enable row level security;
alter table citizen_reports enable row level security;
-- Example only: replace auth.uid mapping after local Supabase verification.
-- create policy municipal_members_read_vehicles on vehicles for select using (exists (select 1 from memberships m where m.profile_id = auth.uid() and m.municipality_id = vehicles.municipality_id and m.status = 'active'));

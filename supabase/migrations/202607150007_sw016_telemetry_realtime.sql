-- SW-016: enables Supabase Realtime on vehicle_positions. The 6 prior migrations created the
-- table, its RLS policies (driver_insert_own_vehicle_position, tenant_read for staff+driver), and
-- shared/telemetry-simulator.js already ships createTelemetryIngestionAdapter().subscribe(), which
-- opens a postgres_changes channel on this table — but no migration ever added vehicle_positions to
-- the supabase_realtime publication, so [realtime] enabled = true in supabase/config.toml was not
-- enough: Realtime only streams changes for tables explicitly in that publication. Without this,
-- every .subscribe() call would open a channel that never receives an event, no matter how correct
-- the RLS policies are. Local-only, mirrors the shape of 202607150006_sw020_rls_fixes.sql. See
-- tests/telemetry-realtime.test.mjs for the real ingestion+Realtime verification.

alter publication supabase_realtime add table vehicle_positions;

-- The publication line above was necessary but not sufficient — confirmed against CI (PR #17):
-- channels reached SUBSCRIBED for both a driver-scoped and a service_role-scoped client, but never
-- received the INSERT event, with the Realtime container's own logs showing no replication activity
-- at all for vehicle_positions/supabase_realtime (only for its unrelated internal
-- supabase_realtime_messages_publication/realtime.messages "Broadcast Changes" connection). The
-- role Realtime's server actually uses to read the WAL for postgres_changes is
-- supabase_realtime_admin — a separate role from anon/authenticated/service_role, which
-- 202607150006_sw020_rls_fixes.sql's grants never covered. Without SELECT here, Realtime can accept
-- the websocket subscription but has no way to evaluate which rows to forward, so it silently
-- forwards nothing instead of erroring.
grant select on vehicle_positions to supabase_realtime_admin;

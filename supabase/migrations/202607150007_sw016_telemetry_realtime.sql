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

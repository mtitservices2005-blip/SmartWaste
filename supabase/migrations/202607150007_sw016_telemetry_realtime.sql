-- SW-016: prepares (but does NOT yet fully verify — see below) Supabase Realtime on
-- vehicle_positions. The 6 prior migrations created the table, its RLS policies
-- (driver_insert_own_vehicle_position, tenant_read for staff+driver), and
-- shared/telemetry-simulator.js already ships createTelemetryIngestionAdapter().subscribe(), which
-- opens a postgres_changes channel on this table — but no migration ever added vehicle_positions to
-- the supabase_realtime publication, so [realtime] enabled = true in supabase/config.toml was not
-- enough: Realtime only streams changes for tables explicitly in that publication. Local-only,
-- mirrors the shape of 202607150006_sw020_rls_fixes.sql.

alter publication supabase_realtime add table vehicle_positions;

-- The publication line above was necessary but, per real CI verification (PR #17), not sufficient:
-- channels reached SUBSCRIBED for both a driver-scoped and a service_role-scoped client, but never
-- received the INSERT event, with the Realtime container's own logs showing no replication activity
-- at all for vehicle_positions/supabase_realtime (only for its unrelated internal
-- supabase_realtime_messages_publication/realtime.messages "Broadcast Changes" connection). External
-- research pointed at supabase_realtime_admin (the role Realtime's server uses to read the WAL for
-- postgres_changes, separate from anon/authenticated/service_role) missing a grant, so it's added
-- below — but adding it did NOT fix the CI failure either; the replication connection still never
-- appears. Root cause remains open. See docs/TECHNICAL_DEBT_REGISTER.md and
-- tests/telemetry-persistence.test.mjs's header comment for the full writeup;
-- shared/integration/status.json's sw016.realtime stays REAL_NOT_RUN until this is actually
-- resolved and verified, not just attempted.
grant select on vehicle_positions to supabase_realtime_admin;

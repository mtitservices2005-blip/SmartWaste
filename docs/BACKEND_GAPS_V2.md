# Backend Gaps V2 SW-017

- Supabase local was not executed: Supabase CLI and Docker are unavailable.
- Remote Supabase was not modified; `supabase db push` was not run.
- RLS policies and cross-tenant trigger guards are prepared but not verified against a live database.
- Auth resolution is prepared for Supabase Auth but no real users or sessions were created.
- Operations adapter supports real Supabase clients and explicit demo fallback, but real persistence is not verified.
- Telemetry ingestion validates simulator payloads and prepares persistence/realtime subscription, but database and Realtime are not verified.
- Physical GPS trackers are not integrated and must never receive service_role credentials.

# Supabase

> Datos demo · no producción

Las 6 migraciones en `supabase/migrations/` (municipalities, profiles, memberships, vehicles, drivers, sectors, routes, route_runs, vehicle_assignments, vehicle_positions, incidents, citizen_reports, RLS por `municipality_id`) fueron aplicadas y verificadas contra una instancia Supabase local real en SW-020 — ver `docs/CURRENT_STATE_AUDIT.md`, sección "SW-020 — Verificación real contra Supabase local", y `shared/integration/status.json`. Sigue sin aplicarse contra ningún proyecto Supabase remoto/de producción.

Para levantarlo local: `npx supabase start` (requiere Docker), luego `npx supabase db reset` para aplicar las migraciones en orden. Ver `docs/FRONTEND_LOGIN_SETUP.md` para conectar el frontend a esa instancia.

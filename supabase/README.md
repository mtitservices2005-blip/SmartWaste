# Supabase

> Datos demo · no producción

Las 6 migraciones en `migrations/` (`sw007_foundation` → `sw008_rls_draft` → `sw013_persistence_hardening` → `sw014_auth_rls_policies` → `sw015_operations_integrity` → `sw020_rls_fixes`) están aplicadas y verificadas contra una instancia Supabase local real (Docker + Postgres) — ver "SW-020 — Verificación real contra Supabase local" en `docs/CURRENT_STATE_AUDIT.md`.

`frontend/` sigue sin conectarse a esta base: usa `createDemoOperationsAdapter()` en memoria. Conectar Supabase a producción o exponer credenciales al navegador requiere revisión de seguridad aparte (ver regla #8 en `CLAUDE.md`).

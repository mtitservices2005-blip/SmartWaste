# Supabase

> Datos demo · no producción

Las 6 migraciones en `migrations/` (`sw007_foundation` → `sw008_rls_draft` → `sw013_persistence_hardening` → `sw014_auth_rls_policies` → `sw015_operations_integrity` → `sw020_rls_fixes`) están aplicadas y verificadas contra una instancia Supabase local real (Docker + Postgres) — ver "SW-020 — Verificación real contra Supabase local" en `docs/CURRENT_STATE_AUDIT.md`.

`frontend/auth-gate.js` ya se conecta a esta base cuando `window.SMARTWASTE_SUPABASE_CONFIG` está configurado: crea un cliente Supabase real y resuelve la sesión/rol vía `resolveSupabaseAuthContext()` (lecturas reales a `profiles`/`memberships`). Lo que sigue sin conectarse son las rutas y vehículos operativos: `frontend/app.js` sigue usando `createDemoOperationsAdapter()` en memoria, no `createSupabaseOperationsAdapter()`. Conectar Supabase a producción o exponer credenciales al navegador requiere revisión de seguridad aparte (ver regla #8 en `CLAUDE.md`).

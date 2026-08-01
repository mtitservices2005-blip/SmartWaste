# Supabase

> Datos demo · no producción

Las 7 migraciones en `migrations/` (`sw007_foundation` → `sw008_rls_draft` → `sw013_persistence_hardening` → `sw014_auth_rls_policies` → `sw015_operations_integrity` → `sw020_rls_fixes` → `sw016_telemetry_realtime`) están aplicadas y verificadas contra una instancia Supabase local real (Docker + Postgres) — ver "SW-020 — Verificación real contra Supabase local" en `docs/CURRENT_STATE_AUDIT.md`.

**Orden de aplicación:** `npx supabase start` (y por lo tanto el job `integration-tests` de `.github/workflows/tests.yml`) aplica los archivos de `migrations/` en orden alfabético por nombre de archivo — de ahí el prefijo de fecha `202607150001`...`202607150007`. Ese orden importa porque `sw008_rls_draft` habilita RLS en varias tablas sin políticas propias, dejándolas efectivamente bloqueadas hasta que `sw014_auth_rls_policies` (aplicada después) agregue las políticas reales; invertir ese orden dejaría esas tablas abiertas o bloqueadas según cómo se edite. Cada corrida de CI desde el PR #16 aplica las 7 migraciones en este orden automáticamente, dando evidencia real y repetida de que la secuencia es correcta (ver `docs/TECHNICAL_DEBT_REGISTER.md` ítem #3).

`frontend/auth-gate.js` ya se conecta a esta base cuando `window.SMARTWASTE_SUPABASE_CONFIG` está configurado: crea un cliente Supabase real y resuelve la sesión/rol vía `resolveSupabaseAuthContext()` (lecturas reales a `profiles`/`memberships`). Lo que sigue sin conectarse son las rutas y vehículos operativos: `frontend/app.js` sigue usando `createDemoOperationsAdapter()` en memoria, no `createSupabaseOperationsAdapter()`. Conectar Supabase a producción o exponer credenciales al navegador requiere revisión de seguridad aparte (ver regla #8 en `CLAUDE.md`).

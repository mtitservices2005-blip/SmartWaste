# Supabase

> Datos demo · no producción

Las 7 migraciones en `migrations/` (`sw007_foundation` → `sw008_rls_draft` → `sw013_persistence_hardening` → `sw014_auth_rls_policies` → `sw015_operations_integrity` → `sw020_rls_fixes` → `sw016_telemetry_realtime`) están aplicadas y verificadas contra una instancia Supabase local real (Docker + Postgres) — ver "SW-020 — Verificación real contra Supabase local" en `docs/CURRENT_STATE_AUDIT.md`.

**Orden de aplicación:** `npx supabase start` (y por lo tanto el job `integration-tests` de `.github/workflows/tests.yml`) aplica los archivos de `migrations/` en orden alfabético por nombre de archivo — de ahí el prefijo de fecha `202607150001`...`202607150007`. Ese orden importa porque `sw008_rls_draft` habilita RLS en varias tablas sin políticas propias, dejándolas efectivamente bloqueadas hasta que `sw014_auth_rls_policies` (aplicada después) agregue las políticas reales; invertir ese orden dejaría esas tablas abiertas o bloqueadas según cómo se edite. Cada corrida de CI desde el PR #16 aplica las 7 migraciones en este orden automáticamente, dando evidencia real y repetida de que la secuencia es correcta (ver `docs/TECHNICAL_DEBT_REGISTER.md` ítem #3).

`frontend/auth-gate.js` ya se conecta a esta base cuando `window.SMARTWASTE_SUPABASE_CONFIG` está configurado: crea un cliente Supabase real y resuelve la sesión/rol vía `resolveSupabaseAuthContext()` (lecturas reales a `profiles`/`memberships`).

**SW-034** conecta las escrituras de `frontend/app.js` al backend real con el mismo interruptor: una vez que la sesión resuelve `municipality_id`, `bootstrapRealBackend()` construye `createSupabaseOperationsAdapter` vía `resolveOperationsAdapter()` (`shared/operations-adapter.js`), y crear un vehículo/chofer/ruta desde la UI ("Flota y personal" / "Crear ruta") se refleja de verdad en Supabase, además de en el estado demo local (que sigue siendo la fuente de la UI en ejecución — ver limitación abajo). El indicador "fuente desacoplada" en el mapa operativo pasa de `DEMO_ONLY` a `REAL` cuando esto ocurre.

**Limitación conocida (`docs/TECHNICAL_DEBT_REGISTER.md` ítem #17):** esto no *hidrata* vehículos/rutas/choferes que ya existieran en Supabase de sesiones anteriores hacia la página en ejecución — solo lo creado durante la sesión actual se persiste. Hidratar datos preexistentes requiere re-derivar varias piezas de estado de simulación que hoy se calculan una sola vez al cargar la página; queda como seguimiento (SW-035).

## Edge Functions

`functions/create-driver-account/` (SW-032) aprovisiona la cuenta de acceso real de un chofer (`auth.admin.createUser` + `profiles` + `memberships` + `drivers.profile_id`) — necesita `service_role`, así que corre server-side, nunca en el navegador (regla 8). Para probarla en local:

```bash
npx supabase start
npx supabase functions serve create-driver-account
```

El frontend la invoca vía `client.functions.invoke('create-driver-account', { body: { driver_id, email } })`, reusando la sesión ya iniciada por `auth-gate.js` (`getAuthClient()`) — solo visible/funcional cuando `SMARTWASTE_SUPABASE_CONFIG` está configurado. Solo hace algo útil una vez que ese `driver_id` existe como fila real en Supabase; mientras `frontend/app.js` siga en modo demo (antes de SW-034), fallará de forma segura con "Driver not found".

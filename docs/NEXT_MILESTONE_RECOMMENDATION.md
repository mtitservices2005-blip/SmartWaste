# Recomendación de próximo hito — SW-020

> Datos demo · no producción. Basado en `docs/CURRENT_STATE_AUDIT.md` y `docs/TECHNICAL_DEBT_REGISTER.md` (2026-07-29).

## Por qué este hito y no otro

Todo lo que bloquea pasar de `PARTIAL`/`REAL_READY` a `VERIFIED_REAL` en esta auditoría tiene la misma causa raíz: **nunca se ha ejecutado Supabase (CLI/Docker) contra las 5 migraciones existentes**. Construir features nuevas (vista supervisor, vista móvil de conductor real, login) antes de cerrar esto arriesga repetir el mismo patrón — más código "prepared but not verified" — sin resolver la brecha que más le importa a un piloto real: ¿el aislamiento entre municipios y la persistencia funcionan de verdad?

## Decisión del Project Owner (2026-07-29)

Confirmado: Docker/Supabase CLI están disponibles en **LabPC**. SW-020 (Supabase local + RLS) queda priorizado explícitamente por encima de construir vista supervisor o vista móvil de conductor — el Project Owner respondió "No, Supabase, RLS primero" a esa alternativa. Este container de auditoría sigue sin Docker/Supabase CLI, así que la ejecución de SW-020 debe hacerse en LabPC, no aquí.

## Propuesta principal — SW-020: Activar y verificar Supabase local

**Alcance:**
1. Levantar Supabase local (Docker + Supabase CLI) en LabPC.
2. Aplicar las 5 migraciones existentes en orden (`sw007_foundation` → `sw008_rls_draft` → `sw013_persistence_hardening` → `sw014_auth_rls_policies` → `sw015_operations_integrity`) contra esa instancia local. No modificar el contenido SQL como parte de este hito salvo que la aplicación falle.
3. **Corregir primero los dos huecos de RLS identificados** (deuda #1 y #2 del registro: rol `driver` sin insert/update, sin política para `citizen_reports` anónimo) — aplicarlos como parte de esta activación, no después, porque sin ellos ni el flujo de conductor ni el portal ciudadano podrían funcionar contra la base real.
4. **Reconciliar `createSupabaseOperationsAdapter` con el esquema `routes`/`route_runs` antes del punto 6.** La revisión del PR #7 confirmó que el adapter escribe `vehicle_id`, `driver_id` y `progress` directamente en `routes`, columnas que no existen ahí — esas columnas viven en `route_runs`/`vehicle_assignments` (ver "Incompatibilidad adapter/esquema" en `docs/CURRENT_STATE_AUDIT.md`). Inspeccionar `shared/contracts.js` y el modelo `route_runs`/`vehicle_assignments`, y alinear el adapter a ese modelo — sin aplanar el esquema ni añadir columnas a `routes` solo para acomodar el código actual del adapter. Preservar la máquina de estados existente (`canTransitionRoute`).
5. Sembrar datos de prueba mínimos (un municipio, 2-3 perfiles con roles distintos incluido `driver`, algunas rutas).
6. Ejecutar pruebas RLS adversariales reales: intentar leer/escribir cruzando `municipality_id` con cada rol y confirmar que Postgres deniega lo que debe denegar. Esto reemplaza — no complementa — el matching de texto de `tests/rls-static.test.mjs`.
7. Conectar `createSupabaseOperationsAdapter` (ya reconciliado con `routes`/`route_runs`) y `resolveSupabaseAuthContext` a un entorno de prueba real (puede ser un script/test de Node, no necesariamente el frontend todavía) y ejercer al menos un ciclo completo: crear ruta → asignar (vía `route_runs`/`vehicle_assignments`) → iniciar → progreso → completar → verificar, contra la base local.
8. Re-clasificar en `docs/CURRENT_STATE_AUDIT.md` cada ítem que pase la verificación a `VERIFIED_REAL`, con evidencia (comando ejecutado, resultado).

**Criterios de aceptación:**
- Las 5 migraciones aplican sin error en una instancia Supabase local limpia.
- El adapter Supabase queda reconciliado con `routes`/`route_runs`/`vehicle_assignments` — sin escrituras a columnas inexistentes — y esa reconciliación queda verificada con pruebas reales, no solo revisada por lectura.
- Un usuario con rol `driver` puede iniciar una ruta y actualizar su progreso sin bypass de RLS.
- Un intento de lectura/escritura cross-tenant (municipio A intentando tocar datos del municipio B) es rechazado por la base, no solo por la app.
- El ciclo completo de operaciones corre contra Supabase real y queda documentado con evidencia reproducible.
- `shared/integration/status.json` se actualiza para reflejar los nuevos estados reales (ya no `REAL_NOT_RUN` donde se verificó).

**Fuera de alcance explícito para SW-020:**
- No construir la vista supervisor ni la vista móvil de conductor todavía (ver alternativa menor abajo).
- No conectar Supabase al `frontend/` en producción ni exponer credenciales reales al navegador sin revisión de seguridad aparte.
- No aplicar nada contra un proyecto Supabase remoto/de producción — todo el trabajo de este hito es local.
- No tocar MTIT-OS ni el repo del Chatbot Municipal.

## Alternativas menores — descartadas por el Project Owner para este hito

- Construir la vista supervisor real o la vista móvil de conductor independiente.
- Conectar `auth-context.js` al frontend con login simulado.

Quedan documentadas como trabajo futuro (ver `docs/TECHNICAL_DEBT_REGISTER.md` #6 y #12), pero explícitamente después de SW-020, no antes ni en paralelo.

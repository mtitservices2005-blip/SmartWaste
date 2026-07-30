# Brief de ejecución SW-020 para Claude Code (LabPC)

> Preparado 2026-07-29 a partir de `docs/CURRENT_STATE_AUDIT.md`, `docs/TECHNICAL_DEBT_REGISTER.md` y `docs/NEXT_MILESTONE_RECOMMENDATION.md`. Este documento es la instrucción autocontenida para que Claude Code ejecute SW-020 sin depender del historial de esta conversación.

## 0. Requisito de entorno — leer antes de empezar

SW-020 requiere Docker + Supabase CLI corriendo localmente. Confirmado por el Project Owner: **solo están disponibles en LabPC**. Si esta tarea se está ejecutando en un entorno sin Docker (por ejemplo un sandbox de Cowork), **detenerse de inmediato** y reportarlo — no simular, no marcar pasos como completados sin ejecución real, no continuar con el resto del alcance.

Primer paso obligatorio, antes de tocar cualquier archivo:

```
docker --version
supabase --version
```

Si alguno falla, parar y reportar al Project Owner. No hay plan B "sin Docker" para este hito — lo dice explícitamente `NEXT_MILESTONE_RECOMMENDATION.md`.

## 1. Reglas permanentes del repo (obligatorias, de `CLAUDE.md`)

Aplican sin excepción a este trabajo:

1. Nunca trabajar sobre `main`. Crear una rama dedicada para SW-020 antes de modificar nada (sugerencia de nombre: `sw-020/supabase-local-activation`; no reutilizar `docs/smartwaste-current-state-audit`, que es la rama de la auditoría).
2. Todo el trabajo de SW-020 va en esa única rama — no mezclar con otros hitos.
3. No hacer merge a `main`. Dejar la rama y, si corresponde, un PR preparado; el merge lo decide el Project Owner.
4. No tocar código de MTIT-OS ni de `ayuntamiento-Chatbot`. Fuera de alcance total en este hito.
5. No borrar ni reemplazar la demo Alpha aprobada — este hito activa persistencia real, no reinicia la UI.
6. **Clasificar como `VERIFIED_REAL` solo lo que se ejecutó de verdad contra Supabase local, con evidencia reproducible (comando + resultado pegado en el doc).** Código escrito o migración aplicada sin verificación no cuenta.
7. Mantener el disclaimer "Datos demo · no producción" en cualquier UI/doc que siga mostrando datos no reales.
8. No commitear secretos ni credenciales. Nunca exponer `service_role` de Supabase al frontend ni a dispositivos físicos.
9. Correr los tests de `tests/` (los 13 archivos, cada uno como proceso `node` independiente — el glob `node tests/*.test.mjs` sin loop solo ejecuta el primero) antes de abrir cualquier PR. Añadir los tests de integración nuevos que pida este hito.
10. **Detenerse antes de `git commit`, `git push` o crear un PR.** Dejar los cambios preparados y descritos; esperar autorización explícita del Project Owner.

## 2. Objetivo de SW-020

Verificar contra una instancia Supabase local real todo lo que hoy está `PARTIAL`/`REAL_READY` (código) pero `REAL_NOT_RUN` (ejecución): las 5 migraciones, las políticas RLS, el aislamiento multi-institución y el ciclo operativo completo (`shared/operations-adapter.js` en modo Supabase). Referencia completa: `docs/NEXT_MILESTONE_RECOMMENDATION.md`.

## 3. Alcance — pasos en orden

1. Levantar Supabase local (`supabase start` o equivalente Docker) en LabPC.
2. Aplicar las 5 migraciones existentes **en este orden exacto**, sin modificar su SQL salvo que falle la aplicación:
   - `supabase/migrations/202607150001_sw007_foundation.sql`
   - `supabase/migrations/202607150002_sw008_rls_draft.sql`
   - `supabase/migrations/202607150003_sw013_persistence_hardening.sql`
   - `supabase/migrations/202607150004_sw014_auth_rls_policies.sql`
   - `supabase/migrations/202607150005_sw015_operations_integrity.sql`
3. Corregir los dos huecos de RLS **antes** de seguir (son bloqueantes para los pasos 5-7):
   - **Rol `driver` sin insert/update.** En `202607150004_sw014_auth_rls_policies.sql:28,30` el array de roles permitidos es `['municipal_admin','supervisor','dispatcher']` — falta `'driver'`. `shared/auth-context.js` (`PERMISSIONS.driver`) y `docs/ROLE_PERMISSION_MATRIX.md` ya definen que el conductor debe poder `routes.start`, `routes.progress` e incidentes, y `vehicle_positions` está entre las tablas afectadas. Diseñar la condición para que `driver` solo pueda escribir lo que le corresponde (su propia ruta/posición), no todo lo que hoy pueden `dispatcher`/`supervisor`.
   - **Sin política de insert anónimo en `citizen_reports`.** Hoy usa la misma política `tenant_insert_staff` que el resto de tablas. Definir una política `anon insert` con validaciones anti-abuso (o documentar por qué se decide un endpoint intermedio en su lugar) — sin esto el portal ciudadano no puede persistir nada real.
4. **Reconciliar `shared/operations-adapter.js` con el esquema migrado antes del paso 6.** Hoy `createSupabaseOperationsAdapter` escribe `vehicle_id`/`driver_id`/`progress` directo en `routes` (`shared/operations-adapter.js:72,74,76`), pero esas columnas no existen ahí — el esquema las define en `route_runs` y `vehicle_assignments` (`supabase/migrations/202607150001_sw007_foundation.sql:9,11,12`). Inspeccionar `shared/contracts.js` (`ROUTE_TRANSITIONS`, `canTransitionRoute()`) y alinear el adapter al modelo `routes` (definición) → `route_runs` (ejecución) → `vehicle_assignments` (asignación). No aplanar el esquema ni agregar columnas a `routes` para acomodar el código actual del adapter — el diseño separado es correcto.
5. Sembrar datos mínimos: 1 municipio, 2-3 perfiles con roles distintos (incluido `driver`), algunas rutas.
6. Pruebas RLS adversariales reales contra Postgres (no regex): cada rol intentando leer/escribir cruzando `municipality_id`, y confirmando que se deniega lo que debe denegarse. Esto reemplaza, no complementa, el matching de texto de `tests/rls-static.test.mjs`.
7. Ejercer un ciclo operativo completo contra la base local usando el adapter ya reconciliado y `resolveSupabaseAuthContext` (puede ser un script/test de Node, no hace falta tocar el frontend todavía): crear ruta → asignar vía `route_runs`/`vehicle_assignments` → iniciar → progreso → completar → verificar.
8. Reclasificar en `docs/CURRENT_STATE_AUDIT.md` cada ítem que pase de `PARTIAL`/`REAL_READY` a `VERIFIED_REAL`, citando el comando ejecutado y el resultado. Actualizar `shared/integration/status.json` para reflejar los nuevos estados reales.

## 4. Criterios de aceptación

- Las 5 migraciones aplican sin error en una instancia Supabase local limpia.
- El adapter queda reconciliado con `routes`/`route_runs`/`vehicle_assignments` (sin escribir en columnas inexistentes) y esto está verificado con pruebas reales, no solo revisado por lectura.
- Un usuario con rol `driver` puede iniciar una ruta y actualizar su progreso sin que RLS lo bloquee.
- Un intento de acceso cross-tenant (municipio A tocando datos de municipio B) es rechazado por la base de datos, no solo por la app.
- El ciclo operativo completo corre contra Supabase real, con evidencia reproducible documentada.
- `shared/integration/status.json` ya no dice `REAL_NOT_RUN` en los puntos verificados.

## 5. Explícitamente fuera de alcance

- Vista supervisor y vista móvil de conductor (descartadas por el Project Owner para este hito).
- Conectar `auth-context.js`/login al `frontend/`.
- Cualquier ejecución contra un proyecto Supabase remoto/de producción — todo el trabajo es local.
- Cualquier cambio en MTIT-OS o `ayuntamiento-Chatbot`.
- `git commit`, `git push` o creación de PR sin autorización explícita del Project Owner (regla 10).

## 6. Entregable esperado al terminar

Rama `sw-020/...` con: migraciones aplicadas y verificadas, RLS corregido, adapter reconciliado, tests de integración nuevos, `docs/CURRENT_STATE_AUDIT.md` y `shared/integration/status.json` actualizados con evidencia real — todo sin commitear/pushear, esperando revisión y autorización del Project Owner.

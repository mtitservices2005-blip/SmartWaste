# Auditoría del estado actual — SmartWaste Alpha

> Datos demo · no producción — este documento audita, no modifica, el estado descrito.

Fecha de auditoría: 2026-07-29 (revisión de correcciones: 2026-07-29; verificación real SW-020: 2026-07-30 — ver sección dedicada al final). Alcance: `README.md`, `docs/`, `shared/`, `backend/`, `supabase/`, `tests/`, `frontend/`, historial git completo (13 commits, 6 sustantivos). Metodología: lectura completa de código y documentación + ejecución local de los 13 archivos de test, cada uno como proceso `node` independiente (`for test_file in tests/*.test.mjs; do node "$test_file"; done`, sin instalar dependencias, sin tocar Supabase). El comando `node tests/*.test.mjs` (sin loop) **no** ejecuta los 13 archivos — el shell expande el glob y `node` solo ejecuta el primero, pasando el resto como argumentos; este documento usa exclusivamente el resultado del loop verificado. No se ejecutó nada contra un backend o base de datos real.

## Resumen ejecutivo

SmartWaste Alpha es una demo visual honesta consigo misma: casi todos los documentos y varios módulos de código incluyen su propio disclaimer de "no producción" o etiquetas `REAL_NOT_RUN`/`BLOCKED`. El frontend (HTML/CSS/JS vanilla, sin build tooling, sin `package.json`) es real y funcional sobre datos 100% estáticos. La capa `shared/` contiene lógica de negocio genuina (máquina de estados de rutas, validadores, adapters). En la auditoría original (2026-07-29) esto solo se ejercía contra datos demo en memoria y `supabase/` tenía 5 migraciones SQL nunca ejecutadas contra una base real. **Actualización SW-020 (2026-07-30)**: las 5 migraciones (más una sexta de correcciones) se aplicaron y verificaron contra una instancia Supabase local real (Docker + Postgres), el adapter Supabase quedó reconciliado con el esquema y se ejerció un ciclo operativo completo real, y el aislamiento multi-institución vía RLS se verificó con pruebas adversariales reales contra Postgres — ver la sección "SW-020 — Verificación real contra Supabase local" más abajo para comandos y resultados. `backend/` sigue sin código de servidor (fuera de alcance).

Los dos huecos de RLS señalados en la auditoría original (rol `driver` sin escritura; sin vía anónima para `citizen_reports`) están corregidos y verificados en SW-020. Se encontró y corrigió además un tercer hueco no documentado originalmente: ninguna migración otorgaba privilegios de tabla a `anon`/`authenticated`/`service_role`, lo que bloqueaba toda lectura/escritura independientemente de las políticas RLS. (Sobre la numeración SW-001–SW-019: el Project Owner confirmó que 6 PR principales agrupan los 19 hitos funcionales — ver sección dedicada más abajo; no es una discrepancia, es el modelo de trabajo declarado.)

## Tabla de clasificación por componente

| Componente | Clasificación | Evidencia | Nota |
|---|---|---|---|
| Mapa operativo (Leaflet/OSM) | `REAL_READY` (código) / `DEMO_ONLY` (datos) | `frontend/app.js:120-149`, CDN unpkg.com | Librería y render reales; coordenadas y rutas 100% estáticas de `shared/demo-data.js` |
| Panel municipal | `DEMO_ONLY` | `frontend/app.js:84` | UI real, sin persistencia, filtra sobre arrays estáticos |
| Portal ciudadano | `DEMO_ONLY` | `frontend/app.js:86`, `shared/citizen-portal.js` | Folio generado client-side, sin upload real, geolocalización leída pero "no enviada" |
| Vista supervisor | `DEMO_ONLY` (actualizado, ver PR #14/#18) | `frontend/app.js:87-93,127`, `frontend/index.html:11` | Componente de UI propio real: `renderSupervisor()`, sección `#supervisor` con enlace de nav dedicado, acciones interactivas (verificar ruta, resolver incidencia) sobre datos demo en memoria — sin persistencia contra Supabase todavía |
| Vista móvil de conductor | `PLACEHOLDER` | `frontend/app.js:84` (fragmento `Vista móvil conductor`) | No es una vista independiente; botón que cicla `routeFlow` local dentro del panel municipal |
| Master Admin | `DEMO_ONLY` | `frontend/app.js:116` | Lista municipios estáticos; botón "Onboarding demo" sin handler |
| Centro de Impacto y Ahorros | `PARTIAL` | `shared/impact-center.js:3-4,18-23` | Cálculo real sobre datos demo; el propio módulo se auto-clasifica por métrica (`REAL_READY/PARTIAL/DEMO_ONLY/BLOCKED`) |
| Simulador de telemetría (`DeviceSimulator`) | `PARTIAL` | `shared/telemetry-simulator.js:6-18`; importado en `app.js:3` pero nunca instanciado | El mapa usa lógica de simulación propia e independiente en `app.js`; el simulador formal es código muerto desde el frontend |
| Ingesta de telemetría a Supabase | `PLACEHOLDER` (sin cliente) / `PARTIAL` (con cliente) | `shared/telemetry-simulator.js:34-53`, mensaje "Telemetry persistence was prepared but not executed" | Nunca invocado con un cliente real |
| `shared/contracts.js` (máquina de estados) | `REAL_READY` | Enums + `canTransitionRoute()` | Lógica ejecutable real, cubierta por `tests/contracts.test.mjs` |
| `shared/operations-adapter.js` — modo demo | `REAL_READY` | `createDemoOperationsAdapter()` | En memoria, probado (`tests/operations-adapter.test.mjs`) |
| `shared/operations-adapter.js` — modo Supabase | `VERIFIED_REAL` (SW-020, 2026-07-30) | `createSupabaseOperationsAdapter(...)` reconciliado a `routes`→`route_runs`→`vehicle_assignments`; `tests/operational-cycle.test.mjs` ejecutado contra Supabase local real | Ciclo completo crear→asignar→iniciar→progreso→completar→verificar corrido y verde contra Postgres real, no solo revisado por lectura. Ver sección SW-020 |
| `shared/auth-context.js` | `PARTIAL` (`resolveSupabaseAuthContext()` ahora `VERIFIED_REAL` — ver sección SW-020) | `resolveSupabaseAuthContext()` en líneas 23-37; roles/permissions reales | La función de resolución de sesión se ejecutó y verificó contra Supabase Auth local real (SW-020); **sigue sin estar importada ni conectada en `frontend/`** — no hay login ni gating por rol en la UI (fuera de alcance de SW-020) |
| `backend/` | `PLACEHOLDER` | `backend/README.md` — "La Alpha no levanta servicios reales" | Cero código de servidor; solo lista de módulos futuros |
| `supabase/migrations/202607150001_sw007_foundation.sql` | `VERIFIED_REAL` (SW-020, 2026-07-30) | Esquema completo, todas las tablas con `municipality_id` | Aplicado sin error contra Supabase local limpio — ver sección SW-020 |
| `supabase/migrations/202607150002_sw008_rls_draft.sql` | `VERIFIED_REAL` (aplica sin error; sigue siendo el borrador sin políticas propias, superado por sw014) | RLS habilitado en 7 tablas, política de ejemplo comentada | Aplicado sin error como paso intermedio; sin políticas propias por diseño (sw014 las añade después en el mismo orden) |
| `supabase/migrations/202607150003_sw013_persistence_hardening.sql` | `VERIFIED_REAL` (SW-020, 2026-07-30) | CHECK constraints, columna `version`, trigger de concurrencia optimista | Aplicado sin error contra Supabase local limpio — ver sección SW-020 |
| `supabase/migrations/202607150004_sw014_auth_rls_policies.sql` | `VERIFIED_REAL` (aplica sin error; los 2 huecos documentados se corrigen en `202607150006_sw020_rls_fixes.sql`, no aquí — la migración original no se modificó) | Políticas `tenant_read`/`tenant_insert_staff`/`tenant_update_staff` en 13 tablas (líneas 24-31) | Aplicado y verificado con pruebas adversariales reales — ver sección SW-020 |
| `supabase/migrations/202607150005_sw015_operations_integrity.sql` | `VERIFIED_REAL` (SW-020, 2026-07-30) | Triggers `assert_same_municipality()` cross-tenant | Aplicado sin error contra Supabase local limpio — ver sección SW-020 |
| `supabase/migrations/202607150006_sw020_rls_fixes.sql` (nueva, SW-020) | `VERIFIED_REAL` | Grants base a anon/authenticated/service_role, políticas `driver_*`, `anon_insert_citizen_report` | Migración nueva de SW-020; no modifica las 5 anteriores. Ver sección SW-020 |
| Tests unitarios sobre lógica demo (8 archivos) | `REAL_READY` (como test) sobre lógica `DEMO_ONLY` | `tests/{auth-context,channel-contracts,citizen-portal,contracts,impact-center,operation-flow,operations-adapter,telemetry-simulator}.test.mjs` | Los 13 archivos originales de `tests/` se ejecutaron **cada uno como proceso `node` separado**. Resultado real: 13/13 con `exit_code=0` (reconfirmado en SW-020 junto con los 2 tests nuevos, 15/15) |
| Tests "static" de RLS/integridad/E2E (4 archivos) | `PLACEHOLDER` (mal etiquetados; `rls-static.test.mjs` reemplazado en cobertura real por `tests/rls-adversarial.test.mjs`, ver SW-020) | `tests/rls-static.test.mjs`, `tests/operations-integrity-static.test.mjs`, `tests/e2e-demo.test.mjs`, `tests/e2e-v2.test.mjs` | Hacen `readFileSync` + regex sobre SQL/JS estático; **no tocan una base de datos ni un navegador**. Se mantienen (no se borran) pero ya no son la única cobertura de RLS — ver sección SW-020 |
| Tests de integración reales contra Supabase local (2 archivos, SW-020) | `VERIFIED_REAL` | `tests/rls-adversarial.test.mjs`, `tests/operational-cycle.test.mjs` | Ejecutan contra Postgres/Auth/PostgREST real vía `@supabase/supabase-js`; requieren `npx supabase start` — ver sección SW-020 |
| CI/CD | Ausente | No existe `.github/workflows/` | `package.json` ahora existe (SW-020, solo `@supabase/supabase-js` como devDependency para los tests de integración) pero no hay ejecución automática de pruebas ni gate de calidad |
| Aislamiento multiinstitución (app-layer + RLS) | `VERIFIED_REAL` (RLS a nivel de base de datos, SW-020) / `PARTIAL` (app-layer, sin cambios) | `shared/auth-context.js:15-19` `assertSameMunicipality()`; `tests/rls-adversarial.test.mjs` | El aislamiento ahora está verificado a nivel de Postgres (denegado por la base de datos, no solo por la app) — ver sección SW-020. `assertSameMunicipality()` en `shared/` sigue sin invocarse desde ningún caller real |
| Control de acceso por rol en UI | `DEMO_ONLY` por defecto (sin cambios, regla 5); `VERIFIED_REAL` configurado (2026-07-30) | `frontend/auth-gate.js`, `docs/FRONTEND_LOGIN_SETUP.md`, `docs/LOGIN_GATING_VERIFICATION_BRIEF.md` | Verificado interactivamente en navegador real (LabPC) contra Supabase local: (1) sin `window.SMARTWASTE_SUPABASE_CONFIG`, `frontend/index.html` se ve idéntico a antes — sin overlay, las 5 secciones visibles, cero errores de consola; (2) configurado, aparece el login y los 5 roles sembrados (`municipal_admin`, `dispatcher`, `driver`, `supervisor`, `mt_superadmin` — este último y `supervisor` se agregaron a `tests/integration/seed.mjs` para esta verificación) ven exactamente las secciones de la tabla de `docs/FRONTEND_LOGIN_SETUP.md`; (3) credenciales inválidas muestran "Credenciales inválidas." sin dejar pasar; (4) "Ir al portal ciudadano sin iniciar sesión" deja visible solo `#ciudadania`; (5) recargar con sesión activa saltea el formulario y aplica el gating directo. `tests/rls-adversarial.test.mjs` y `tests/operational-cycle.test.mjs` se re-corrieron tras extender `seed.mjs` y siguen pasando |
| Observabilidad | `PARTIAL` | `shared/observability.js`, usado en `tests/e2e-v2.test.mjs` (`healthCheck().production === 'NO'`) | El propio health-check se autoreporta como no-producción |

## Aislamiento multiinstitución y RLS (foco especial)

- **Diseño**: `202607150004_sw014_auth_rls_policies.sql` define `has_platform_role()` y `has_municipality_role()` (`SECURITY DEFINER`, líneas 13-19) y aplica un patrón `tenant_read`/`tenant_insert_staff`/`tenant_update_staff` en un loop sobre 13 tablas (líneas 21-32). `202607150005_sw015_operations_integrity.sql` añade triggers `assert_same_municipality()` como defensa adicional contra referencias cross-tenant en foreign keys.
- **Hueco 1 — rol `driver` sin permisos de escritura**: las líneas 28 y 30 del migration sw014 hardcodean `array['municipal_admin','supervisor','dispatcher']` para insert/update en las 13 tablas del loop — **`driver` no está incluido**. Pero `docs/ROLE_PERMISSION_MATRIX.md:9` y `shared/auth-context.js:7` (`PERMISSIONS.driver`) definen explícitamente que el conductor debe poder `routes.start`, `routes.progress` e incidentes, y `vehicle_positions` (telemetría) está en la lista de tablas afectadas por esas políticas. Tal como está escrito hoy, un conductor autenticado sería rechazado por RLS al intentar iniciar una ruta o enviar su posición.
- **Hueco 2 — sin ruta de escritura para ciudadanos anónimos**: `citizen_reports` recibe las mismas políticas `tenant_insert_staff` que cualquier otra tabla (solo staff autenticado), pero `shared/citizen-portal.js` y `shared/channel-contracts.js` describen un portal ciudadano pensado para reportes públicos/anónimos vía web, WhatsApp o Chatbot Municipal. No existe política `anon`/`insert` para esta tabla.
- **sw008 (`202607150002_...rls_draft.sql`) habilita RLS sin políticas** en 7 tablas — con RLS activado y cero políticas, Postgres deniega todo acceso salvo `service_role`. Esto solo queda resuelto si sw014 se aplica después, en el mismo entorno, en orden — y no hay evidencia (ni `config.toml`, ni historial de migraciones, ni CLI ejecutado) de que las 5 migraciones se hayan aplicado juntas alguna vez.
- **Verificado en SW-020 (2026-07-30)**: los huecos 1 y 2 se corrigieron y se verificaron con pruebas RLS adversariales reales contra Postgres — ver sección SW-020 más abajo. `shared/integration/status.json` ya no dice `REAL_NOT_RUN` en `sw014.rls`.

## Autenticación y roles

Contrato de roles/permisos real (`shared/auth-context.js`), incluida una función `resolveSupabaseAuthContext()` que sí sabe cómo resolver una sesión real contra `auth.getUser()` + `profiles`/`memberships`. Sin embargo, **no hay ninguna pantalla de login en `frontend/`**, ni gating de rutas por rol — todas las secciones (municipal, ciudadano, master admin) se renderizan siempre, para cualquier visitante. El propio `ROLE_PERMISSION_MATRIX.md` dice literalmente que hoy "frontend filters are demo UX only". Clasificación: `PARTIAL` (contrato real, cero integración).

## Persistencia real

`backend/` sigue sin servidor propio (fuera de alcance de SW-020). El adapter de Supabase (`shared/operations-adapter.js`) **sí persiste ahora contra Supabase local real** para el ciclo operativo completo (`createRoute`, `assignVehicle`, `assignDriver`, `startRoute`, `updateProgress`, `completeRoute`, `verifyRoute`) — verificado en SW-020, ver sección dedicada. Sigue sin haber ninguna conexión desde `frontend/`, que continúa usando `createDemoOperationsAdapter()` en memoria (`shared/operations-adapter.js:150`, `frontend/app.js:2`) — eso no cambió y no estaba en el alcance de este hito.

### Incompatibilidad adapter/esquema (hallazgo de revisión — resuelto en SW-020)

`createSupabaseOperationsAdapter` escribe directamente sobre la tabla `routes`:
- `assignVehicle` → `table(client,'routes').update({ vehicle_id: vehicleId, status:'assigned' })` (`shared/operations-adapter.js:72`)
- `assignDriver` → `table(client,'routes').update({ driver_id: driverId, status:'assigned' })` (`shared/operations-adapter.js:74`)
- `updateProgress` → `table(client,'routes').update({ progress, status: ... })` (`shared/operations-adapter.js:76`)

Pero el esquema migrado define `routes` solo con `id, municipality_id, name, status, created_by, created_at, updated_at, version` (`supabase/migrations/202607150001_sw007_foundation.sql:9`, columna `version` añadida en `202607150003_sw013_persistence_hardening.sql:41`) — **sin `vehicle_id`, `driver_id` ni `progress`**. Esas columnas de asignación/ejecución existen en `route_runs` (`vehicle_id`, `driver_id`, `status`, `202607150001_sw007_foundation.sql:11`) y `vehicle_assignments` (`202607150001_sw007_foundation.sql:12`); no existe ninguna columna `progress` en ningún lugar del esquema migrado.

**Conclusión de esta auditoría (2026-07-29) — resuelto en SW-020 (2026-07-30):**
- Existía una **incompatibilidad contractual real** entre el adapter Supabase y el esquema migrado — no era un detalle menor, era un desajuste de modelo de datos.
- **Resuelto**: `shared/operations-adapter.js` fue reconciliado para que `assignVehicle`/`assignDriver` abran o reutilicen el `route_run` activo de la ruta y reflejen la asignación en `vehicle_assignments`, y `startRoute`/`updateProgress`/`markDelayed`/`completeRoute`/`verifyRoute` transicionen `route_runs.status` (no `routes`). `routes.status` solo avanza una vez, de `planned` a `assigned`, al asignar — nunca se escribe en columnas inexistentes.
- El esquema **no se modificó** para acomodar el adapter — se mantiene la separación `routes` (definición) → `route_runs` (ejecución) → `vehicle_assignments` (asignación).
- Se preservó la máquina de estados (`shared/contracts.js`, `ROUTE_TRANSITIONS`/`canTransitionRoute`), ahora aplicada sobre `route_runs.status` en vez de `routes.status` para las transiciones operativas.
- Esta reconciliación **se verificó mediante `tests/operational-cycle.test.mjs` contra Supabase local real**, no solo por inspección de código — ver sección SW-020.

## Telemetría

`DeviceSimulator` (`shared/telemetry-simulator.js`) genera posiciones falsas a lo largo de `routePaths`; está importado en `frontend/app.js:3` pero **nunca instanciado** — el movimiento real de camiones en el mapa lo produce lógica distinta e inline (`startSimulation`/`pauseSimulation` en `app.js:156-158`). Existe además `createTelemetryIngestionAdapter()` que validaría y escribiría en `vehicle_positions` vía Supabase Realtime — nunca invocado con un cliente real; retorna explícitamente `source:'REAL_NOT_RUN'` sin cliente.

## Rutas y recorridos

Máquina de estados real y testeada (`shared/contracts.js`, `ROUTE_TRANSITIONS`, `canTransitionRoute()`), operando sobre datos demo vía `createDemoOperationsAdapter()`. El equivalente contra Supabase existe pero no fue ejercido (ver Persistencia real).

## Cumplimiento operativo, eventos, observabilidad

`shared/observability.js` expone `healthCheck()`/`structuredLog()`; el propio `healthCheck()` se autoreporta `production: 'NO'` (verificado en `tests/e2e-v2.test.mjs`, que pasó en esta auditoría). No hay bitácora de auditoría real más allá de la tabla `audit_events` sin aplicar. `docs/E2E_TEST_MATRIX.md` tiene su propia matriz de READY/NOT_RUN por paso — ninguna fila está en `REAL_VERIFIED`.

## Integración futura con MTIT-OS

Ver `docs/MTIT_OS_BOUNDARY_REVIEW.md` para el detalle completo. Resumen: `shared/channel-contracts.js` está diseñado como capa channel-agnostic pensando en un futuro Chatbot Municipal; `docs/CHATBOT_MUNICIPAL_CONTRACT.md:3` confirma explícitamente que "esta misión no modificó el repositorio ayuntamiento-Chatbot". No hay ningún acoplamiento de código con MTIT-OS hoy.

## Readiness para piloto

`docs/PILOT_READINESS.md` (SW-017) es el resumen más limpio del propio repo: todo lo visual/local es `YES`, todo lo que depende de Supabase/backend/GPS real es `NO`, "Operaciones reales" es `PARTIAL`. Esta auditoría no encontró evidencia que contradiga esa tabla — se mantiene vigente.

## SW-020 — Verificación real contra Supabase local (2026-07-30)

> Ejecutado en LabPC (Docker + Supabase CLI vía `npx supabase`, versión 2.110.0). Rama `sw-020/supabase-local-activation`. Todo lo descrito aquí se corrió de verdad; se citan comando y resultado como exige la regla 6 de `CLAUDE.md`.

**0. Prerrequisito de entorno**: `docker --version` → `Docker version 29.6.2, build dfc4efb`. El binario global `supabase` no estaba instalado; se usó `npx supabase` (mismo CLI, `npx supabase --version` → `2.110.0`), confirmado con el Project Owner antes de continuar.

**1. Las 5 migraciones aplican sin error contra Supabase local limpio**: `npx supabase start` (primera vez) y luego `npx supabase db reset` (repetido tras cada ajuste) aplicaron `202607150001` a `202607150005` en orden, sin modificar su SQL, seguido de la migración nueva `202607150006_sw020_rls_fixes.sql`. Log de aplicación real:
```
Applying migration 202607150001_sw007_foundation.sql...
Applying migration 202607150002_sw008_rls_draft.sql...
Applying migration 202607150003_sw013_persistence_hardening.sql...
Applying migration 202607150004_sw014_auth_rls_policies.sql...
Applying migration 202607150005_sw015_operations_integrity.sql...
Applying migration 202607150006_sw020_rls_fixes.sql...
Finished supabase db reset on branch sw-020/supabase-local-activation.
```

**2. Tercer hueco de RLS encontrado (no estaba en los 2 documentados)**: ninguna de las 5 migraciones originales otorgó privilegios de tabla a `anon`/`authenticated`/`service_role` en el schema `public` (solo `USAGE` de schema, del bootstrap de Supabase). Verificado con `\dp municipalities` en Postgres antes de la corrección: `anon=Dxtm/postgres` (sin `select/insert/update/delete`), reproduciendo `permission denied for table municipalities` incluso para `service_role` (que tiene `Bypass RLS` pero igual necesita el grant base sobre el objeto). Corregido en `202607150006_sw020_rls_fixes.sql` con `grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;` + `alter default privileges`. Confirmado con el Project Owner antes de aplicarlo (no estaba en el alcance original del brief).

**3. Hueco 1 (rol `driver` sin insert/update) — corregido y verificado**: `202607150006_sw020_rls_fixes.sql` añade `driver_update_own_route_run` (solo su propio `route_run`, y solo hacia `started/in_progress/delayed/completed` — no `verified`, que sigue siendo exclusivo de staff), `driver_insert_own_vehicle_position` (solo su vehículo asignado vía `vehicle_assignments`), `driver_insert_own_incident`. Verificado con `docker exec supabase_db_SmartWaste psql ... "select tablename, policyname, cmd, roles from pg_policies where tablename in ('route_runs','vehicle_positions','incidents')"` mostrando las 3 políticas nuevas, y con `tests/rls-adversarial.test.mjs` (checks #5–#7): un driver puede iniciar su propio `route_run` pero no puede escribir `vehicles`, no puede poner `status='verified'`, y no puede tocar el `route_run` de otro conductor.

**4. Hueco 2 (sin insert anónimo en `citizen_reports`) — corregido y verificado**: política `anon_insert_citizen_report` con validaciones anti-abuso (`status='received'` obligatorio, `channel` restringido a canales públicos, `folio`/`description` acotados, municipio debe existir y estar `active`/`onboarding` — este último chequeo vía función `security definer` `municipality_is_onboarded()`, necesaria porque `anon` no tiene política de lectura sobre `municipalities`). **Hallazgo colateral real**: un insert anónimo con `.select()` encadenado (o `Prefer: return=representation`) falla con error de RLS aunque el insert haya funcionado — PostgREST hace `INSERT ... RETURNING` y, al no existir política `SELECT` para `anon`, no puede mostrar la fila devuelta y reporta eso como violación de RLS del insert. Confirmado aislando el caso contra una tabla de prueba (`rls_debug_probe2`) con `return=minimal` (funciona, `201 Created`) vs `return=representation` (falla, `401`). Documentado en la migración y en `tests/rls-adversarial.test.mjs` (check #8): el insert anónimo se verifica sin `.select()`, y se confirma lo persistido leyendo con `service_role`.

**5. `shared/operations-adapter.js` reconciliado con `routes`→`route_runs`→`vehicle_assignments`** (no solo revisado por lectura): `assignVehicle`/`assignDriver` abren o reutilizan el `route_run` activo y upsert manual (sin depender de un `ON CONFLICT` inexistente) en `vehicle_assignments`; `startRoute`/`updateProgress`/`markDelayed`/`completeRoute`/`verifyRoute` transicionan `route_runs.status` — nunca escriben `vehicle_id`/`driver_id`/`progress` en `routes` (que no tiene esas columnas).

**6. Ciclo operativo completo ejecutado contra Supabase real**: `node tests/operational-cycle.test.mjs` → `operational-cycle ok`. Flujo real: dispatcher crea ruta (`routes.status=planned`) → dispatcher asigna vehículo y conductor (abre `route_runs` + `vehicle_assignments`, `routes.status=assigned`) → conductor inicia (`route_runs.status=started`) → conductor reporta progreso (`in_progress`) → conductor completa (`completed`) → conductor **no puede** verificar (bloqueado por RLS, confirmado) → admin verifica (`verified`). Usa `resolveSupabaseAuthContext()` real (`shared/auth-context.js`) para resolver rol/permiso de cada usuario firmado contra Supabase Auth local antes de operar.

**7. Pruebas RLS adversariales reales contra Postgres**: `node tests/rls-adversarial.test.mjs` → `rls-adversarial ok`. Casos reales (no regex): admin de municipio B no puede leer ni escribir vehículos de municipio A (ni siquiera insertando con `municipality_id` forjado); dispatcher del propio municipio sí puede; driver no puede escribir `vehicles`; driver puede iniciar/progresar su propio `route_run` pero no verificarlo ni tocar el de otro conductor; insert anónimo válido en `citizen_reports` funciona, uno con estado pre-resuelto o canal `internal` se rechaza.

**8. Datos sembrados**: `tests/integration/seed.mjs` crea 2 municipios (para las pruebas cross-tenant), usuarios reales en Supabase Auth (`auth.admin.createUser`) con perfiles y memberships para `municipal_admin`, `dispatcher` y `driver`, un vehículo, una fila en `drivers` y una ruta — todo vía `service_role` (bypassa RLS por diseño, script local-only, nunca se expone a frontend/dispositivos).

**9. Dependencia nueva**: no existía `package.json` en el repo. Se creó uno mínimo (`private:true`, `type:module`) con `@supabase/supabase-js` como única `devDependency`, usado solo por los tests de integración nuevos (`tests/integration/`, `tests/rls-adversarial.test.mjs`, `tests/operational-cycle.test.mjs`) para hablar con Supabase Auth/PostgREST como lo esperan `resolveSupabaseAuthContext()` y `operations-adapter.js`. Confirmado con el Project Owner antes de instalar. `node_modules/` se agregó a `.gitignore` (nuevo, no existía); `package-lock.json` sí se versiona.

**10. Suite completa de tests**: los 13 archivos originales + los 2 nuevos (`rls-adversarial.test.mjs`, `operational-cycle.test.mjs`) se corrieron cada uno como proceso `node` independiente. Resultado: 15/15 con salida `... ok` y `exit_code=0`. Los tests de integración requieren `npx supabase start` corriendo primero; si Supabase local no está activo, fallan explícitamente con un mensaje claro en vez de dar falso positivo.

**Fuera de alcance confirmado, no ejecutado**: vista supervisor/móvil de conductor, conexión de `auth-context.js`/login a `frontend/`, cualquier ejecución contra Supabase remoto/producción, cambios en MTIT-OS/`ayuntamiento-Chatbot`. `git commit`/`push`/PR no se ejecutaron — cambios preparados en la rama `sw-020/supabase-local-activation`, pendientes de autorización explícita del Project Owner.

## Numeración SW-001–SW-019

> **Aclaración del Project Owner (2026-07-29)**: "SmartWaste ha avanzado mediante seis PR principales que agrupan los hitos funcionales SW-001 a SW-019." Queda confirmado que los 6 PR/commits son las unidades de trabajo trazables y que SW-001–019 son hitos funcionales agrupados dentro de ellos, no 19 commits/PRs independientes. Se actualiza esta sección para reflejar esa aclaración en vez de tratarlo como una discrepancia sin explicar.

Historial real (`git log --all --oneline`, 13 commits, 6 sustantivos):

| Commit | Milestone en el mensaje | Contenido |
|---|---|---|
| `82fc60f` | (sin etiqueta) | "Add files via upload" — import inicial |
| `7417da0` | SW-005 | "master admin final demo readiness" — primer commit etiquetado, trae README, docs base, frontend/shared demo, tests ligeros |
| `d8716bd` | SW-006 | "mapa operativo real demo" — mapa Leaflet/OSM |
| `52381a7` | SW-012 | "add E2E readiness and observability" — auth-context, channel-contracts, contracts, operations-adapter, telemetry-simulator, primeras 2 migraciones SQL (nombradas internamente sw007/sw008) |
| `fed266c` | SW-017 | "E2E QA and pilot readiness" — PILOT_READINESS, 3 migraciones SQL más (sw013/sw014/sw015), tests static |
| `e7f4fb9` | SW-018 | "add operational impact and savings center" |
| `1e3bbe7` | SW-019 | "fix mobile detail drawer for institutional demo" |

Los números **SW-001–004, SW-009–011 y SW-016 no aparecen como commit, archivo ni documento independiente**; los números **SW-007, 008, 013, 014, 015 existen como nombres de archivo SQL** empaquetados dentro de los commits SW-012 y SW-017. Con la aclaración del Project Owner, esto es consistente con el modelo declarado: 6 PR principales agrupan los 19 hitos funcionales — no se trata de numeración inflada, sino de granularidad funcional documentada dentro de cada PR. Se mantiene como buena práctica seguir citando "6 PR / 19 hitos funcionales" juntos en reportes externos, para que quede claro qué es la unidad de entrega (PR) y qué es la unidad funcional (hito).

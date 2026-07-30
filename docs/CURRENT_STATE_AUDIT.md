# Auditoría del estado actual — SmartWaste Alpha

> Datos demo · no producción — este documento audita, no modifica, el estado descrito.

Fecha de auditoría: 2026-07-29. Alcance: `README.md`, `docs/`, `shared/`, `backend/`, `supabase/`, `tests/`, `frontend/`, historial git completo (13 commits, 6 sustantivos). Metodología: lectura completa de código y documentación + ejecución local de los 13 archivos de test (`node tests/*.test.mjs`, sin instalar dependencias, sin tocar Supabase). No se ejecutó nada contra un backend o base de datos real.

## Resumen ejecutivo

SmartWaste Alpha es una demo visual honesta consigo misma: casi todos los documentos y varios módulos de código incluyen su propio disclaimer de "no producción" o etiquetas `REAL_NOT_RUN`/`BLOCKED`. El frontend (HTML/CSS/JS vanilla, sin build tooling, sin `package.json`) es real y funcional sobre datos 100% estáticos. La capa `shared/` contiene lógica de negocio genuina (máquina de estados de rutas, validadores, adapters), pero solo se ejerce contra datos demo en memoria. `backend/` no tiene ningún código, solo un README de intención. `supabase/` tiene 5 migraciones SQL bien estructuradas — incluyendo un diseño de RLS razonable — pero **nunca se ejecutaron contra una base de datos real** (documentado por el propio repo: `shared/integration/status.json`, `docs/BACKEND_GAPS_V2.md`, `docs/PILOT_READINESS.md`). Ningún componente que dependa de Supabase, autenticación real o persistencia calificó como `VERIFIED_REAL` en esta auditoría.

El hallazgo que merece atención inmediata del Project Owner: las políticas RLS actuales excluyen al rol `driver` de escribir en las tablas que la propia app espera que el conductor actualice (rutas, progreso, posición GPS), y no dejan ninguna vía para que un ciudadano anónimo inserte un `citizen_report`. (Sobre la numeración SW-001–SW-019: el Project Owner confirmó que 6 PR principales agrupan los 19 hitos funcionales — ver sección dedicada más abajo; no es una discrepancia, es el modelo de trabajo declarado.)

## Tabla de clasificación por componente

| Componente | Clasificación | Evidencia | Nota |
|---|---|---|---|
| Mapa operativo (Leaflet/OSM) | `REAL_READY` (código) / `DEMO_ONLY` (datos) | `frontend/app.js:120-149`, CDN unpkg.com | Librería y render reales; coordenadas y rutas 100% estáticas de `shared/demo-data.js` |
| Panel municipal | `DEMO_ONLY` | `frontend/app.js:84` | UI real, sin persistencia, filtra sobre arrays estáticos |
| Portal ciudadano | `DEMO_ONLY` | `frontend/app.js:86`, `shared/citizen-portal.js` | Folio generado client-side, sin upload real, geolocalización leída pero "no enviada" |
| Vista supervisor | `PLACEHOLDER` | `shared/auth-context.js:1,5`, `docs/ROLE_PERMISSION_MATRIX.md` | Existe como rol/permiso y como pasos narrativos de E2E; **no existe componente de UI propio** |
| Vista móvil de conductor | `PLACEHOLDER` | `frontend/app.js:84` (fragmento `Vista móvil conductor`) | No es una vista independiente; botón que cicla `routeFlow` local dentro del panel municipal |
| Master Admin | `DEMO_ONLY` | `frontend/app.js:116` | Lista municipios estáticos; botón "Onboarding demo" sin handler |
| Centro de Impacto y Ahorros | `PARTIAL` | `shared/impact-center.js:3-4,18-23` | Cálculo real sobre datos demo; el propio módulo se auto-clasifica por métrica (`REAL_READY/PARTIAL/DEMO_ONLY/BLOCKED`) |
| Simulador de telemetría (`DeviceSimulator`) | `PARTIAL` | `shared/telemetry-simulator.js:6-18`; importado en `app.js:3` pero nunca instanciado | El mapa usa lógica de simulación propia e independiente en `app.js`; el simulador formal es código muerto desde el frontend |
| Ingesta de telemetría a Supabase | `PLACEHOLDER` (sin cliente) / `PARTIAL` (con cliente) | `shared/telemetry-simulator.js:34-53`, mensaje "Telemetry persistence was prepared but not executed" | Nunca invocado con un cliente real |
| `shared/contracts.js` (máquina de estados) | `REAL_READY` | Enums + `canTransitionRoute()` | Lógica ejecutable real, cubierta por `tests/contracts.test.mjs` |
| `shared/operations-adapter.js` — modo demo | `REAL_READY` | `createDemoOperationsAdapter()` | En memoria, probado (`tests/operations-adapter.test.mjs`) |
| `shared/operations-adapter.js` — modo Supabase | `PARTIAL` | `createSupabaseOperationsAdapter(...)`; `shared/integration/status.json` marca `createRoute`..`registerIncident` como `REAL_PREPARED_NOT_RUN` | Código completo con try/catch y fallback, nunca ejercido contra un cliente real |
| `shared/auth-context.js` | `PARTIAL` | `resolveSupabaseAuthContext()` en líneas 23-37; roles/permissions reales | Lógica real, **no está importada ni conectada en `frontend/`** — no hay login ni gating por rol en la UI |
| `backend/` | `PLACEHOLDER` | `backend/README.md` — "La Alpha no levanta servicios reales" | Cero código de servidor; solo lista de módulos futuros |
| `supabase/migrations/202607150001_sw007_foundation.sql` | `REAL_READY` | Esquema completo, todas las tablas con `municipality_id` | Nunca aplicado (ver sección RLS) |
| `supabase/migrations/202607150002_sw008_rls_draft.sql` | `PLACEHOLDER` | RLS habilitado en 7 tablas, política de ejemplo comentada | Sin políticas activas, superado por sw014 si se aplica en orden |
| `supabase/migrations/202607150003_sw013_persistence_hardening.sql` | `REAL_READY` | CHECK constraints, columna `version`, trigger de concurrencia optimista | Bien formado, nunca ejecutado |
| `supabase/migrations/202607150004_sw014_auth_rls_policies.sql` | `PARTIAL` | Políticas `tenant_read`/`tenant_insert_staff`/`tenant_update_staff` en 13 tablas (líneas 24-31) | Diseño sólido con huecos concretos — ver sección RLS |
| `supabase/migrations/202607150005_sw015_operations_integrity.sql` | `REAL_READY` | Triggers `assert_same_municipality()` cross-tenant | Bien formado, nunca ejecutado |
| Tests unitarios sobre lógica demo (8 archivos) | `REAL_READY` (como test) sobre lógica `DEMO_ONLY` | `tests/{auth-context,channel-contracts,citizen-portal,contracts,impact-center,operation-flow,operations-adapter,telemetry-simulator}.test.mjs` | Los 13 archivos pasan en esta auditoría (`node tests/*.test.mjs`, todos exit 0) |
| Tests "static" de RLS/integridad/E2E (4 archivos) | `PLACEHOLDER` (mal etiquetados) | `tests/rls-static.test.mjs`, `tests/operations-integrity-static.test.mjs`, `tests/e2e-demo.test.mjs`, `tests/e2e-v2.test.mjs` | Hacen `readFileSync` + regex sobre SQL/JS estático; **no tocan una base de datos ni un navegador**. `rls-static.test.mjs:4` usa una regex tan laxa que igual matchea con solo el nombre de la tabla |
| CI/CD | Ausente | No existe `.github/workflows/`, no existe `package.json` en ningún punto del repo | No hay ejecución automática de pruebas ni gate de calidad |
| Aislamiento multiinstitución (app-layer) | `PARTIAL` | `shared/auth-context.js:15-19` `assertSameMunicipality()` | Función real, pero solo se invoca si algo llama al adapter Supabase con un cliente real — nunca ocurre hoy |
| Control de acceso por rol en UI | `DEMO_ONLY` | `docs/ROLE_PERMISSION_MATRIX.md:11` — "frontend filters are demo UX only" | Admitido explícitamente en el propio repo: no es seguridad real |
| Observabilidad | `PARTIAL` | `shared/observability.js`, usado en `tests/e2e-v2.test.mjs` (`healthCheck().production === 'NO'`) | El propio health-check se autoreporta como no-producción |

## Aislamiento multiinstitución y RLS (foco especial)

- **Diseño**: `202607150004_sw014_auth_rls_policies.sql` define `has_platform_role()` y `has_municipality_role()` (`SECURITY DEFINER`, líneas 13-19) y aplica un patrón `tenant_read`/`tenant_insert_staff`/`tenant_update_staff` en un loop sobre 13 tablas (líneas 21-32). `202607150005_sw015_operations_integrity.sql` añade triggers `assert_same_municipality()` como defensa adicional contra referencias cross-tenant en foreign keys.
- **Hueco 1 — rol `driver` sin permisos de escritura**: las líneas 28 y 30 del migration sw014 hardcodean `array['municipal_admin','supervisor','dispatcher']` para insert/update en las 13 tablas del loop — **`driver` no está incluido**. Pero `docs/ROLE_PERMISSION_MATRIX.md:9` y `shared/auth-context.js:7` (`PERMISSIONS.driver`) definen explícitamente que el conductor debe poder `routes.start`, `routes.progress` e incidentes, y `vehicle_positions` (telemetría) está en la lista de tablas afectadas por esas políticas. Tal como está escrito hoy, un conductor autenticado sería rechazado por RLS al intentar iniciar una ruta o enviar su posición.
- **Hueco 2 — sin ruta de escritura para ciudadanos anónimos**: `citizen_reports` recibe las mismas políticas `tenant_insert_staff` que cualquier otra tabla (solo staff autenticado), pero `shared/citizen-portal.js` y `shared/channel-contracts.js` describen un portal ciudadano pensado para reportes públicos/anónimos vía web, WhatsApp o Chatbot Municipal. No existe política `anon`/`insert` para esta tabla.
- **sw008 (`202607150002_...rls_draft.sql`) habilita RLS sin políticas** en 7 tablas — con RLS activado y cero políticas, Postgres deniega todo acceso salvo `service_role`. Esto solo queda resuelto si sw014 se aplica después, en el mismo entorno, en orden — y no hay evidencia (ni `config.toml`, ni historial de migraciones, ni CLI ejecutado) de que las 5 migraciones se hayan aplicado juntas alguna vez.
- **Sin verificación real**: `shared/integration/status.json` marca `sw014.rls: "REAL_NOT_RUN"`. `docs/BACKEND_GAPS_V2.md` lo confirma: "RLS policies and cross-tenant trigger guards are prepared but not verified against a live database." No hay Supabase CLI ni Docker disponibles en este entorno de auditoría tampoco, así que esta auditoría **no pudo ni intentó** verificarlo — se limita a revisar el SQL como texto, igual que hace (débilmente) `tests/rls-static.test.mjs`.

## Autenticación y roles

Contrato de roles/permisos real (`shared/auth-context.js`), incluida una función `resolveSupabaseAuthContext()` que sí sabe cómo resolver una sesión real contra `auth.getUser()` + `profiles`/`memberships`. Sin embargo, **no hay ninguna pantalla de login en `frontend/`**, ni gating de rutas por rol — todas las secciones (municipal, ciudadano, master admin) se renderizan siempre, para cualquier visitante. El propio `ROLE_PERMISSION_MATRIX.md` dice literalmente que hoy "frontend filters are demo UX only". Clasificación: `PARTIAL` (contrato real, cero integración).

## Persistencia real

No existe. `backend/` no tiene servidor. El adapter de Supabase (`shared/operations-adapter.js`) está escrito para escribir contra tablas reales, pero cada operación de escritura (`createRoute`, `assignVehicle`, `startRoute`, etc.) está marcada `REAL_PREPARED_NOT_RUN` en `shared/integration/status.json`. Todo lo que el usuario ve persistir hoy vive en memoria del navegador (`structuredClone` del seed demo) y se pierde al recargar.

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

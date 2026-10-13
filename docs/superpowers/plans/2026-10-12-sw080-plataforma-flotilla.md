# Plataforma de flotilla (SW-080) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar una flotilla de 5 camiones con GPS desde la app Android, centro de control en vivo, métricas por camión/chofer/ruta y reporte semanal en PDF.

**Architecture:** Los teléfonos envían lotes idempotentes a un RPC de Supabase que guarda el historial y mantiene una fila de estado vivo por camión. El centro de control consulta una sola RPC (`fleet_overview`) cada 5 s; Realtime no se usa como vía principal. Las métricas semanales salen de vistas/funciones SQL; la lógica de presentación y variación vive en módulos JS puros con pruebas.

**Tech Stack:** Vanilla JS (ES modules), Supabase (Postgres, RLS, RPC), Capacitor 7 Android, Node 22 con `node tests/X.test.mjs` por archivo, CSS con variables.

**Spec:** `docs/superpowers/specs/2026-10-12-sw080-plataforma-flotilla-design.md` (copia de `SW-080-plataforma-flotilla.md`). Los criterios de aceptación CA-0xx-n se refieren a ese documento.

## Global Constraints

- Reglas de `CLAUDE.md`: una rama por sub-hito, nunca sobre `main`, sin merge, y detenerse antes de commit/push/PR hasta autorización de Miguel (reglas 1, 2, 3, 10).
- Migraciones solo aditivas (nuevo archivo `supabase/migrations/2026101200NN_sw08x_*.sql`); nunca editar migraciones existentes.
- Nunca `service_role` en `frontend/`, `mobile/` ni `dist/` (la prueba `tests/frontend-no-service-role.test.mjs` debe seguir en verde).
- Textos de interfaz en español; el texto "Datos demo · no producción" se conserva en modo demo y no aparece con backend real.
- Umbrales: `sin_senal` > 90 s sin posición; `detenido` = velocidad < 1 m/s durante > 5 min con corrida activa; polling del centro de control = 5 s; lote máximo = 200 puntos; retención de posiciones = 90 días.
- Muestreo del teléfono: cada 10 s o 25 m (constantes existentes `DRIVER_APP_MAX_INTERVAL_MS`, `DRIVER_APP_MIN_DISTANCE_METERS`).
- Semana de reporte: lunes a domingo en zona `America/Santo_Domingo`.
- Contraste mínimo 4.5:1 (texto normal) y 3:1 (texto grande); objetivos táctiles de la app del chofer ≥ 48 px.
- Cada `tests/*.test.mjs` corre como proceso independiente. Pruebas que necesitan Supabase local se agregan a la lista de exclusión del job `unit-tests` y corren en `integration-tests` de `.github/workflows/tests.yml`.
- Helpers SQL existentes que se reutilizan: `has_municipality_role(target_municipality_id uuid, allowed_roles text[])`, `current_driver_id(target_municipality_id uuid)`, `assert_same_municipality(reference_table text, reference_id uuid, expected_municipality_id uuid)`.
- Dato verificado: `vehicle_positions.source` ya admite `'driver_app'` (migración `sw013`).

## Review Focus

Entradas que la especificación implica pero ninguna tarea cubriría sin esta lista (la prueba de cada una está en la tarea indicada):

1. **Reloj del teléfono desfasado:** un punto con `captured_at` más de 5 minutos en el futuro no debe fijar el estado vivo ni dejarlo "congelado" (Task 1).
2. **Punto viejo fuera de orden:** un lote que llega tarde con puntos más antiguos no debe sobrescribir `vehicle_live_state` (Task 1).
3. **Saltos de GPS con mala precisión:** puntos con `accuracy` > 100 m no suman distancia ni mueven la estela (Task 13 y Task 16).
4. **Camión que se mueve sin corrida activa:** se muestra como `disponible` con aviso, no como `en_ruta` ni se rompe la vista (Task 1 y Task 13).
5. **Semana sin datos o semana anterior vacía:** el reporte no divide por cero y los límites de semana usan la zona de Santo Domingo (Task 17).

---

## Task 0: Preparación (Miguel + agente)

**Files:** Create `docs/superpowers/specs/2026-10-12-sw080-plataforma-flotilla-design.md`, `docs/superpowers/plans/2026-10-12-sw080-plataforma-flotilla.md`.

- [ ] **Step 1:** Miguel autoriza el commit de la especificación y el plan en una rama `docs/sw080-spec-plan` desde `main`.
- [ ] **Step 2:** Revisar el PR #92 (`feature/sw074-driver-app`): correr sus pruebas y la prueba de escaneo del paquete; Miguel decide el merge. SW-083 parte de ese resultado.
- [ ] **Step 3:** Confirmar que `npm test`-equivalente (cada `tests/*.test.mjs` con `node`) pasa en `main` antes de empezar; anotar las 7 pruebas que requieren Supabase.

---

## Sub-hito SW-081 — Datos y backend (rama `feature/sw081-fleet-backend`)

### Task 1: Estado vivo, ingesta idempotente y vista de flotilla

**Files:**
- Create: `supabase/migrations/202610120001_sw081_fleet_live_state.sql`
- Create: `tests/fleet-ingest.test.mjs` (integración, patrón de `tests/rls-adversarial.test.mjs`)
- Modify: `.github/workflows/tests.yml` (agregar el archivo a la lista de exclusión)

**Interfaces:**
- Produces (SQL): `vehicle_positions.battery_pct smallint` (0-100, nullable); índice único `(device_id, vehicle_id, captured_at)`; tabla `vehicle_live_state(municipality_id, vehicle_id PK, route_run_id, latitude, longitude, speed, heading, battery_pct, captured_at, status text, updated_at)`; función `derive_vehicle_status(has_active_run boolean, last_captured_at timestamptz, last_speed numeric, stopped_since timestamptz, now_ts timestamptz) returns text` (valores `en_ruta|detenido|sin_senal|disponible`); `ingest_positions(batch jsonb) returns jsonb` con `{inserted int, ignored int, rejected int}`; `fleet_overview() returns table(vehicle_id uuid, unit text, plate text, status text, driver_name text, route_id uuid, route_name text, progress int, latitude numeric, longitude numeric, speed numeric, battery_pct smallint, captured_at timestamptz, seconds_since_report int)`.

- [ ] **Step 1: Escribir `tests/fleet-ingest.test.mjs` con estos casos** (cada uno falla antes de la migración): mismo lote enviado dos veces → `inserted` solo la primera vez (CA-081-1); chofer sin asignación al vehículo → todo `rejected` (CA-081-2); punto con `captured_at` > 5 min en el futuro → `rejected` y `vehicle_live_state` sin cambio (Review Focus 1); lote con punto más viejo que el estado vivo → insertado en historial pero `vehicle_live_state.captured_at` no retrocede (Review Focus 2); lote de 201 puntos → error; `fleet_overview()` de un usuario de otro municipio devuelve 0 filas (CA-081-4).
- [ ] **Step 2: Correr** `node tests/fleet-ingest.test.mjs` con Supabase local; esperado: FALLA (función inexistente).
- [ ] **Step 3: Escribir la migración.** `ingest_positions` es `security invoker` y se apoya en las políticas RLS existentes de `vehicle_positions` más `current_driver_id`; usa `insert ... on conflict (device_id, vehicle_id, captured_at) do nothing`; actualiza `vehicle_live_state` con `upsert ... where excluded.captured_at > vehicle_live_state.captured_at`; `derive_vehicle_status` implementa las reglas de Global Constraints. `fleet_overview` une `vehicles`, `vehicle_assignments`, `drivers`, `route_runs` activos y `vehicle_live_state` y es `security invoker` (RLS por municipio). Un camión con posición reciente y sin corrida activa devuelve `disponible` (Review Focus 4).
- [ ] **Step 4: Correr de nuevo**; esperado: PASA. Correr `node tests/rls-coverage.test.mjs` (CA-081-5); esperado: PASA.
- [ ] **Step 5: Commit** (solo con autorización de Miguel): `feat(sw081): estado vivo de flotilla e ingesta idempotente`.

### Task 2: Alertas, combustible y retención

**Files:**
- Create: `supabase/migrations/202610120002_sw081_alerts_fuel_retention.sql`
- Create: `tests/fleet-alerts-fuel.test.mjs` (integración)

**Interfaces:**
- Produces (SQL): tabla `fleet_alerts(id uuid, municipality_id, vehicle_id, route_run_id nullable, type text check in ('sin_senal','detenido_largo','bateria_baja','ruta_retrasada'), status text check in ('abierta','atendida'), opened_at, closed_at)` con índice único parcial `(vehicle_id, type) where status='abierta'`; `refresh_fleet_alerts() returns int` (abre/cierra sin duplicar; `bateria_baja` < 20 %); `acknowledge_fleet_alert(alert_id uuid) returns void`; tabla `fuel_logs(id uuid, municipality_id, vehicle_id, route_run_id nullable, liters numeric check (liters > 0), odometer_km numeric nullable, logged_at timestamptz default now(), logged_by uuid)`; `purge_old_positions(days int default 90) returns bigint`. RLS: lectura por `has_municipality_role` (administración y despacho); `fuel_logs` insertable por el chofer asignado al vehículo y por administración.

- [ ] **Step 1: Escribir pruebas:** `refresh_fleet_alerts()` llamado dos veces con el mismo camión sin señal deja 1 alerta abierta (CA-084-2); al volver a reportar, la alerta se cierra; `fuel_logs` con `liters = 0` es rechazado; un chofer no puede registrar combustible de un vehículo ajeno; `purge_old_positions(90)` borra solo puntos con más de 90 días y no toca `vehicle_live_state`; dos municipios no se ven entre sí (CA-081-4).
- [ ] **Step 2: Correr**; esperado: FALLA.
- [ ] **Step 3: Escribir la migración** con RLS activada y al menos una política por tabla nueva; agregar la tabla a la verificación de cobertura si la prueba la necesita.
- [ ] **Step 4: Correr** las pruebas nuevas y `tests/rls-coverage.test.mjs`; esperado: PASAN.
- [ ] **Step 5: Commit** (con autorización): `feat(sw081): alertas, combustible y retención`.

### Task 3: Adaptador JS y lógica de estado pura

**Files:**
- Create: `shared/fleet-status.js`
- Create: `tests/fleet-status.test.mjs` (unitaria)
- Modify: `shared/operations-adapter.js` (ambos adaptadores, demo y Supabase)
- Modify: `tests/operations-adapter.test.mjs`

**Interfaces:**
- Produces: `deriveVehicleStatus({ hasActiveRun, lastCapturedAt, lastSpeed, stoppedSince, now }): 'en_ruta'|'detenido'|'sin_senal'|'disponible'` (misma tabla de reglas que el SQL); métodos del adaptador `fleetOverview(opts) → ok([{vehicle_id, unit, status, ...}])`, `ingestPositions(batch, opts) → ok({inserted, ignored, rejected})`, `logFuel({vehicle_id, route_run_id, liters, odometer_km}, opts)`, `listFleetAlerts(opts)`, `acknowledgeFleetAlert(alertId, opts)`.

- [ ] **Step 1: Escribir `tests/fleet-status.test.mjs`** con la tabla de casos: 89 s → `en_ruta`; 91 s → `sin_senal`; corrida activa, velocidad 0.5 durante 6 min → `detenido`; sin corrida y posición reciente → `disponible`.
- [ ] **Step 2: Correr**; esperado: FALLA. **Step 3:** implementar `deriveVehicleStatus`. **Step 4:** correr; esperado: PASA.
- [ ] **Step 5: Extender `tests/operations-adapter.test.mjs`** (cliente simulado): `fleetOverview()` llama a la RPC `fleet_overview`; `ingestPositions()` rechaza lotes de más de 200 puntos sin llamar a la red; el adaptador demo devuelve 5 camiones derivados de `shared/demo-data.js` con los mismos campos. Implementar los métodos; correr la prueba; esperado: PASA.
- [ ] **Step 6: Commit** (con autorización): `feat(sw081): adaptador de flotilla`.

---

## Sub-hito SW-082 — Sistema de diseño (rama `feature/sw082-design-system`)

### Task 4: Tokens y verificación de contraste

**Files:**
- Create: `frontend/styles/tokens.css`, `scripts/check-contrast.mjs`
- Create: `tests/design-contrast.test.mjs`
- Modify: `frontend/index.html` (enlazar `tokens.css` antes de `styles.css`), `scripts/build-frontend-config.mjs` (copiar `frontend/styles/` a `dist/`)

**Interfaces:**
- Produces: variables `--color-primary`, `--color-primary-contrast`, `--color-warning`, `--color-danger`, `--color-success`, `--color-surface`, `--color-text`, `--color-muted`, `--status-en-ruta|detenido|sin-senal|disponible|fuera-servicio`, `--space-1..8`, `--radius-1..3`; `contrastRatio(hexA: string, hexB: string): number` exportada por `scripts/check-contrast.mjs`.

- [ ] **Step 1: Escribir `tests/design-contrast.test.mjs`:** lee `tokens.css`, resuelve los pares texto/fondo declarados en un mapa `PAIRS` dentro de la prueba y exige `contrastRatio >= 4.5` (texto normal) o `>= 3` (texto grande/iconos) (CA-082-1). Incluir un caso que falla a propósito con colores de contraste 2:1 para probar la prueba.
- [ ] **Step 2: Correr**; esperado: FALLA (archivos inexistentes). **Step 3:** escribir `tokens.css` partiendo del verde institucional actual (`styles.css`) y `contrastRatio` según WCAG. **Step 4:** correr; esperado: PASA.
- [ ] **Step 5: Commit** (con autorización): `feat(sw082): tokens de diseño`.

### Task 5: Componentes base y guía de textos

**Files:**
- Create: `frontend/components/button.js`, `badge.js`, `field.js`, `toast.js`, `empty-state.js`, `frontend/styles/components.css`, `docs/UX_COPY_GUIDE.md`
- Create: `tests/components.test.mjs`

**Interfaces:**
- Produces: `button({ label, variant: 'primary'|'secondary'|'danger', onClick }): HTMLElement`; `badge({ status, label }): HTMLElement` (siempre color + icono + texto); `field({ id, label, hint, type, value }): HTMLElement` (la etiqueta es un `<label for>` visible); `toast({ message, tone }): void`; `emptyState({ title, action }): HTMLElement`.

- [ ] **Step 1: Pruebas (DOM simulado o sin DOM con funciones que devuelven cadenas HTML)**: `field` siempre emite `<label for=id>` (CA-082-3); `badge` incluye texto además de color; `button` primario del chofer declara `min-height: 48px` en `components.css` (CA-082-2, verificado leyendo el CSS).
- [ ] **Step 2:** correr; falla. **Step 3:** implementar los componentes y `UX_COPY_GUIDE.md` (verbos de acción, español claro, errores que dicen qué hacer). **Step 4:** correr; pasa.
- [ ] **Step 5: Commit** (con autorización): `feat(sw082): componentes base`.

### Task 6: Etiquetas del asistente y textos demo condicionados

**Files:**
- Create: `frontend/ui-mode.js`, `tests/ui-mode.test.mjs`
- Modify: `frontend/app.js` (asistente de configuración inicial y encabezados con texto demo fijo), `frontend/index.html`

**Interfaces:**
- Produces: `demoBannerText({ backendReal: boolean, hideDemo: boolean }): string` → `''` si hay backend real o `hideDemo`; `'Datos demo · no producción'` en demo.

- [ ] **Step 1: Prueba:** `demoBannerText({ backendReal: true, hideDemo: true }) === ''` y el modo demo conserva el texto (CA-082-4, regla 7). **Step 2:** correr; falla. **Step 3:** implementar y usar `demoBannerText` en cada lugar de `frontend/app.js` donde hoy está el texto fijo ("Datos demo · no producción · Municipio piloto: Laguna Salada…"); agregar etiquetas visibles con `field()` a los campos del asistente: Unidad, Matrícula, Paradas máximas por viaje, Nombre del chofer, Teléfono, Correo. **Step 4:** correr `node tests/ui-mode.test.mjs` y `node tests/auth-gate.test.mjs`; pasan.
- [ ] **Step 5: Commit** (con autorización): `feat(sw082): etiquetas del asistente y textos demo condicionados`.

---

## Sub-hito SW-083 — App del chofer Android (rama `feature/sw083-driver-android`, parte de sw074 ya mergeado)

### Task 7: Envío por lotes con latido

**Files:**
- Modify: `shared/driver-app-telemetry.js`, `mobile/www/` (se regenera desde `shared/`)
- Create: `shared/driver-app-heartbeat.js`
- Create: `tests/driver-app-batching.test.mjs`

**Interfaces:**
- Consumes: `createPersistentTelemetryQueue` (existente), `adapter.ingestPositions(batch)` (Task 3).
- Produces: `flushInBatches({ queue, send, maxBatch = 200 }): Promise<{ sent: number, failed: number }>`; `createHeartbeat({ intervalMs = 30000, now, onBeat })` con `start()`/`stop()`; backoff `nextRetryDelayMs(attempt: number): number` (1 s, 2 s, 4 s … tope 60 s).

- [ ] **Step 1: Pruebas:** 450 puntos pendientes → 3 envíos (200, 200, 50) en orden de `captured_at` (CA-083-1); si `send` falla en el lote 2, los lotes 2 y 3 siguen en la cola y el 1 se marca enviado; reintento tras reconexión no duplica; `nextRetryDelayMs(10) === 60000`; el latido emite cada 30 s aunque no haya movimiento.
- [ ] **Step 2:** correr; falla. **Step 3:** implementar. **Step 4:** correr `node tests/driver-app-batching.test.mjs` y `node tests/driver-app-telemetry.test.mjs` (existente en sw074); pasan.
- [ ] **Step 5: Commit** (con autorización): `feat(sw083): envío por lotes y latido`.

### Task 8: Batería en cada lote

**Files:** Modify `shared/driver-app-telemetry.js` (`positionFromDriverLocation` acepta `battery_pct`), `mobile/package.json` (plugin `@capacitor/device`), `tests/driver-app-batching.test.mjs`.

**Interfaces:** `positionFromDriverLocation(location, { ..., battery_pct })` incluye `battery_pct` entero 0-100 o `null`.

- [ ] **Step 1: Prueba:** con `battery_pct: 0.37` (nivel decimal del plugin) el payload lleva `37`; sin valor lleva `null`. **Step 2:** correr; falla. **Step 3:** implementar conversión y lectura del plugin con degradación silenciosa si no está disponible. **Step 4:** correr; pasa.
- [ ] **Step 5: Commit** (con autorización): `feat(sw083): batería en la telemetría`.

### Task 9: Combustible al finalizar y vista del chofer rediseñada

**Files:**
- Modify: `frontend/app.js` (`renderDriverSection` y `driverRouteLifecycleControl`) o crear `frontend/views/driver-view.js` y delegar desde `app.js`
- Create: `shared/fuel-entry.js`, `tests/fuel-entry.test.mjs`

**Interfaces:**
- Produces: `parseFuelLiters(input: string): { ok: true, liters: number } | { ok: false, message: string }` (acepta coma o punto decimal, rechaza ≤ 0 o > 500, mensaje en español).

- [ ] **Step 1: Prueba de `parseFuelLiters`:** `'45,5'` → 45.5; `'0'` → error "Escribe los litros cargados (mayor que 0)"; `''` → `{ ok: true, liters: null }` tratado como "omitido" (el registro es opcional). **Step 2:** correr; falla. **Step 3:** implementar y conectar al diálogo de "Finalizar recorrido" que llama `adapter.logFuel(...)` con `vehicle_id` y `route_run_id` de la corrida (CA-083-4). La vista del chofer muestra un solo botón primario por estado, indicadores de GPS y conexión, y contador de paradas, usando los componentes de Task 5. **Step 4:** correr; pasa.
- [ ] **Step 5: Commit** (con autorización): `feat(sw083): combustible y vista del chofer`.

### Task 10: APK de lanzamiento e instalación

**Files:** Modify `.github/workflows/android-test-apk.yml` (job de APK firmado con secretos del repositorio `ANDROID_KEYSTORE_*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`), `docs/DRIVER_APP_INSTALL.md`; reutilizar la prueba de escaneo de secretos del paquete (SW-074 CA5).

- [ ] **Step 1:** el flujo falla con error claro si falta `SUPABASE_URL` o `SUPABASE_ANON_KEY` (modo estricto como `SMARTWASTE_REQUIRE_BACKEND`). **Step 2:** correr el flujo en una rama de prueba y confirmar que el APK final no contiene `service_role` (escaneo existente). **Step 3 (Miguel):** crear el keystore y cargar los secretos en GitHub; el agente no maneja claves. **Step 4:** documentar instalación y la exclusión del ahorro de batería por marca de teléfono.
- [ ] **Step 5: Commit** (con autorización): `ci(sw083): APK de lanzamiento firmado`.

---

## Sub-hito SW-084 — Centro de control (rama `feature/sw084-control-center`)

### Task 11: Modelo de vista y poller

**Files:**
- Create: `shared/fleet-view-model.js`, `shared/fleet-poller.js`
- Create: `tests/fleet-view-model.test.mjs`, `tests/fleet-poller.test.mjs`

**Interfaces:**
- Produces: `sortFleet(rows): rows` (orden `sin_senal`, `detenido`, `en_ruta`, `disponible`, `fuera_servicio`; dentro de cada grupo por `unit`); `staleLabel(secondsSinceReport: number): string` ("hace 12 s", "hace 3 min"); `trailPoints(positions, { minutes = 10, maxAccuracyMeters = 100 }): [lat, lon][]` (descarta puntos con `accuracy` > 100, Review Focus 3); `createFleetPoller({ fetchOverview, intervalMs = 5000, isHidden, onData, onError, maxFailures = 3 }): { start(), stop() }` (pausa si `isHidden()`; tras 3 fallos seguidos llama `onError({ persistent: true })`).

- [ ] **Step 1: Pruebas:** `sortFleet` pone `sin_senal` primero; `staleLabel(125) === 'hace 2 min'`; `trailPoints` excluye un punto con `accuracy: 250` y uno de hace 11 min; el poller no llama `fetchOverview` mientras `isHidden()` es verdadero y reanuda al volver; 3 fallos → `persistent: true`; un éxito reinicia el contador. **Step 2:** correr; fallan. **Step 3:** implementar. **Step 4:** correr; pasan.
- [ ] **Step 5: Commit** (con autorización): `feat(sw084): modelo de vista y poller de flotilla`.

### Task 12: Vista del centro de control

**Files:**
- Create: `frontend/views/control-center.js`, `frontend/styles/control-center.css`
- Modify: `frontend/index.html` (enlace de navegación), `frontend/app.js` (registrar la sección), `frontend/auth-gate.js` (`SECTION_ROLES`: solo `municipal_admin`, `dispatcher`, `supervisor`; no `driver`) (CA-084-4)

**Interfaces:**
- Consumes: `adapter.fleetOverview`, `createFleetPoller`, `sortFleet`, `staleLabel`, `trailPoints`, componentes de Task 5.
- Produces: `mountControlCenter(container: HTMLElement, { adapter, map }): { destroy(): void }`.

- [ ] **Step 1: Prueba** (`tests/auth-gate.test.mjs` extendida): un usuario `driver` no ve la sección del centro de control. **Step 2:** correr; falla. **Step 3:** implementar la vista: mapa con icono numerado y color por estado, estela, ruta asignada tenue, lista ordenada a la izquierda, indicador "datos de hace X segundos", fallback con lista y coordenadas si el mapa externo falla. **Step 4:** correr `node tests/auth-gate.test.mjs`; pasa. **Step 5 (verificación visual):** abrir en 1366×768 y 1920×1080 con el simulador de 5 camiones; sin errores de consola tras 30 minutos (CA-084-3, CA-084-5).
- [ ] **Step 6: Commit** (con autorización): `feat(sw084): centro de control de flotilla`.

### Task 13: Alertas y controles manuales

**Files:** Modify `frontend/views/control-center.js`; Create `tests/control-center-actions.test.mjs`.

**Interfaces:** Consumes `adapter.listFleetAlerts`, `adapter.acknowledgeFleetAlert`, `adapter.updateVehicle(id, { state: 'out_of_service' })`, `adapter.assignDriverToVehicle`.

- [ ] **Step 1: Prueba:** con un cliente simulado, marcar "Atendida" llama `acknowledgeFleetAlert` una vez; "Fuera de servicio" llama `updateVehicle` y el camión pasa al final de la lista (`fuera_servicio`). **Step 2:** correr; falla. **Step 3:** implementar panel de alertas y los dos controles. **Step 4:** correr; pasa.
- [ ] **Step 5: Commit** (con autorización): `feat(sw084): alertas y controles de flotilla`.

---

## Sub-hito SW-085 — Métricas y reportes (rama `feature/sw085-weekly-reports`)

### Task 14: Agregados SQL diarios y semanales

**Files:** Create `supabase/migrations/202610120003_sw085_fleet_reports.sql`, `tests/weekly-report-sql.test.mjs` (integración).

**Interfaces:**
- Produces (SQL): vista `daily_vehicle_stats(municipality_id, vehicle_id, day date, runs int, km numeric, hours_on_route numeric, hours_stopped numeric, stops_done int, liters numeric, km_per_liter numeric, fuel_is_estimated boolean)`; función `weekly_fleet_report(week_start date) returns jsonb` con `{ week_start, by_vehicle[], by_driver[], by_route[], totals, previous_totals }`. Días en `America/Santo_Domingo`; la distancia ignora puntos con `accuracy` > 100 m (Review Focus 3).

- [ ] **Step 1: Prueba con datos conocidos:** 2 corridas de 10 y 15 km en la semana → `totals.km = 25` y coincide con la suma de `route_runs.distance_meters` (CA-085-1); con `fuel_logs` presentes `fuel_is_estimated = false`, sin ellos `true`; un punto a las 23:30 hora local del domingo cuenta en esa semana, no en la siguiente (Review Focus 5); otro municipio no aparece (CA-085-5). **Step 2:** correr; falla. **Step 3:** escribir la migración (`security invoker`). **Step 4:** correr; pasa.
- [ ] **Step 5: Commit** (con autorización): `feat(sw085): agregados de flotilla`.

### Task 15: Lógica de variación y rotulado de estimados

**Files:** Create `shared/weekly-report.js`, `tests/weekly-report.test.mjs`.

**Interfaces:**
- Produces: `weekOverWeek(current: number, previous: number | null): { pct: number | null, direction: 'up'|'down'|'flat'|'none' }` (`previous` nulo o 0 → `{ pct: null, direction: 'none' }`); `formatMetric({ value, unit, estimated }): string` (agrega "(estimado)" cuando `estimated`); `weekBounds(date: Date): { start: string, end: string }` (lunes a domingo, `America/Santo_Domingo`).

- [ ] **Step 1: Pruebas:** `weekOverWeek(110, 100)` → `{ pct: 10, direction: 'up' }`; `weekOverWeek(5, 0)` no lanza y devuelve `none` (CA-085-2); `formatMetric({ value: 12.3, unit: 'km/L', estimated: true })` contiene "estimado" (CA-085-3); `weekBounds` de un domingo 23:30 local devuelve la semana que termina ese día. **Step 2:** correr; fallan. **Step 3:** implementar. **Step 4:** correr; pasan.
- [ ] **Step 5: Commit** (con autorización): `feat(sw085): lógica de reporte semanal`.

### Task 16: Pantalla Reportes y PDF

**Files:** Create `frontend/views/reports.js`, `frontend/styles/print.css`; Modify `frontend/index.html`, `frontend/app.js` (sección "Reportes", roles administración y supervisor), `scripts/build-frontend-config.mjs` si se agregan carpetas.

**Interfaces:** Consumes `adapter.weeklyReport(weekStart)` (agregar al adaptador con la RPC `weekly_fleet_report`; el demo devuelve datos de ejemplo rotulados como demo), `weekOverWeek`, `formatMetric`, `dataviz` para la tendencia de 8 semanas (km, litros, km/L, paradas).

- [ ] **Step 1: Prueba (`tests/reports-view.test.mjs`):** el generador de HTML del reporte con datos de 5 camiones incluye una fila por camión, rotula los estimados y no contiene la palabra "NaN" ni "Infinity" con una semana anterior vacía. **Step 2:** correr; falla. **Step 3:** implementar la vista con selector de semana, tarjetas, tablas por camión y chofer, gráfico, y `print.css` (A4, blanco y negro legible, encabezado con municipio y periodo, nota de estimados) (CA-085-4). **Step 4:** correr; pasa. **Step 5 (verificación visual):** imprimir a PDF con 5 camiones; ocupa ≤ 2 páginas A4.
- [ ] **Step 6: Commit** (con autorización): `feat(sw085): pantalla de reportes y PDF`.

---

## Sub-hito SW-086 — Pruebas de carga y campo (rama `feature/sw086-load-field-tests`)

### Task 17: Simulador de 5 camiones y humo de punta a punta

**Files:** Create `scripts/load-5-trucks.mjs`, `scripts/smoke-e2e.mjs`, `docs/LOAD_TEST.md`; Modify `docs/GPS_FIELD_TEST.md`.

**Interfaces:** `node scripts/load-5-trucks.mjs --minutes 60 --url <supabase> --anon <key>` imprime `{ points_sent, points_stored, p95_delay_ms, overview_ms_p95 }` y sale con código ≠ 0 si `points_stored < points_sent` (descontando la pérdida de señal declarada) o `p95_delay_ms > 10000` (CA-084-1, CA-086-1).

- [ ] **Step 1:** el script crea 5 vehículos de prueba en un municipio de prueba, simula 5 teléfonos con pérdida de señal aleatoria usando `ingest_positions`, y mide el retraso entre `captured_at` y la primera lectura en `fleet_overview()`. **Step 2:** correr 10 minutos en local y luego 60 en staging con un municipio de prueba (Miguel autoriza). **Step 3:** `smoke-e2e.mjs` ejecuta: crear ayuntamiento de prueba, vehículos, choferes, rutas, asignar, correr, cerrar, pedir el reporte; dos ejecuciones seguidas sin intervención manual (CA-086-3). **Step 4 (campo, Miguel):** seguir el checklist de `docs/GPS_FIELD_TEST.md` con 2 teléfonos Android reales 60 minutos con pantalla apagada (CA-086-2); registrar el resultado y la configuración de batería usada.
- [ ] **Step 5: Commit** (con autorización): `test(sw086): carga de 5 camiones y humo de punta a punta`.

---

## Sub-hito SW-087 — Seguridad y despliegue (rama `feature/sw087-hardening`)

### Task 18: Aislamiento, secretos y rollback

**Files:** Create `tests/fleet-rls-adversarial.test.mjs` (integración: dos municipios contra todas las RPC, vistas y tablas de SW-081 y SW-085); Modify `docs/GO_NO_GO.md`, `docs/ROLLBACK_PLAN.md`, `docs/SECURITY_PRELAUNCH.md`; Create `docs/OPERACION_FLOTILLA.md` (guía para el ayuntamiento).

- [ ] **Step 1:** la prueba adversarial intenta, como usuario del municipio B, leer y escribir en `vehicle_live_state`, `fleet_alerts`, `fuel_logs`, `fleet_overview()` y `weekly_fleet_report()` del municipio A; todo debe devolver 0 filas o error de permiso. **Step 2:** correr con Supabase local; pasa. **Step 3:** correr `node tests/frontend-no-service-role.test.mjs` y la prueba de escaneo del APK. **Step 4:** documentar el etiquetado previo (`git tag pre-sw080`), la promoción en Vercel y el rollback (las migraciones son aditivas: revertir es desplegar el código anterior).
- [ ] **Step 5 (Miguel, manual en los paneles):** desactivar el registro público en Supabase Auth y probar que falla registrarse; confirmar que "Ayuntamiento de Laguna Salada — Presentación" y sus dos usuarios ya no existen; pasar a un plan con respaldos automáticos y restaurar un respaldo de prueba (CA-087-1, CA-087-2).
- [ ] **Step 6:** completar `docs/GO_NO_GO.md` con todas las casillas en verde (CA-087-3). **Commit** (con autorización): `docs(sw087): seguridad, rollback y operación`.

---

## Self-Review

- **Cobertura de la especificación:** SW-081 → Tasks 1-3; SW-082 → Tasks 4-6; SW-083 → Tasks 7-10; SW-084 → Tasks 11-13; SW-085 → Tasks 14-16; SW-086 → Task 17; SW-087 → Task 18. Retención de 90 días: Task 2. Estados derivados: Tasks 1 y 3. Textos demo y etiquetas: Task 6. Combustible real: Tasks 2 y 9. PDF y comparación semanal: Tasks 15-16.
- **Consistencia de tipos:** `fleetOverview`, `ingestPositions`, `logFuel`, `listFleetAlerts`, `acknowledgeFleetAlert` se definen en Task 3 y se usan con los mismos nombres en Tasks 7, 9, 11-13; `weeklyReport` se agrega al adaptador en Task 16 y llama a la RPC `weekly_fleet_report` de Task 14.
- **Review Focus:** los cinco puntos tienen su prueba en las tareas 1, 11, 14 y 15.
- **Pendientes que no puede hacer el agente** (marcados "Miguel"): keystore y secretos de GitHub (Task 10), prueba de campo con teléfonos (Task 17), paneles de Supabase y plan con respaldos (Task 18), y toda autorización de commit, push, PR y merge.

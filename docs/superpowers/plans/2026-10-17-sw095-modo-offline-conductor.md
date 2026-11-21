# SW-095 Modo offline de la app del conductor — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el conductor abra la app, inicie, recorra y termine una ruta (con litros) sin internet, y que todo llegue a Supabase con las horas reales al volver la señal.

**Architecture:** Una copia local de "Hoy" (`driver-offline-cache`) y una cola local de acciones (`driver-action-queue`: iniciar, litros, terminar) que el controlador existente usa cuando no hay red. El adaptador acepta la hora real (`opts.at`) y la corrida exacta (`opts.runId`). El GPS conserva su cola actual; solo se le da una asignación en caché para poder arrancar sin red.

**Tech Stack:** JS vanilla (ESM) en `shared/` y `frontend/`, pruebas `node tests/*.test.mjs` con `node:assert/strict` (sin framework), Capacitor (WebView, `localStorage`). Sin migraciones.

**Spec:** `docs/superpowers/specs/2026-10-17-sw095-modo-offline-conductor-design.md` (incluye el apéndice "Hallazgos al planificar" de la Task 0).

## Global Constraints

- Rama `feature/sw095-modo-offline-conductor` (worktree `wt-sw095`); nunca en `main`; commit local con `$HOME/gc95.sh "<mensaje>"`; no hacer push/merge/deploy sin que Miguel lo autorice.
- TDD: cada tarea empieza con la prueba fallando. Pruebas que dependen de Supabase local (`fleet-ingest`, `route-repeat`, `rls-*`, `gps-route-metrics`, `route-geometry`, etc.) se marcan "pendiente de CI"; no se tocan.
- Sin migraciones ni cambios de RLS. Nunca `service_role` en frontend. Sin secretos.
- Los componentes de `frontend/components/*.js` solo importan desde `./`; el formato y los textos llegan por parámetro.
- Todo texto al conductor en español, tuteo ("tú"), sin voseo; todo dato dinámico pasa por `escapeHtml`.
- Compatibilidad: `createDriverController` sin `queue`/`cache`/`isOnline` se comporta exactamente igual que hoy (las pruebas existentes de `tests/driver-app.test.mjs` no cambian).
- Almacenamiento con contrato `getItem/setItem` (puede ser asíncrono), claves `smartwaste.driver-cache.v1` y `smartwaste.driver-actions.v1`.
- Horas: se descarta la hora del teléfono si es futura (> ahora + 5 min) o anterior a 2 días; `completed_at` nunca antes de `started_at`.
- No presentar nada como "IA"; conservar el chip "Datos demo · no producción" donde ya exista.

## Review Focus

- Reloj del teléfono mal puesto (año equivocado, adelantado): se usa la hora del servidor, nunca se rompe `completed_at >= started_at`.
- Corte de red a mitad de un envío (llegó al servidor pero no la respuesta): el reintento no duplica litros ni completa otra corrida.
- Reenviar `complete` después de que la corrida ya terminó y el servidor creó la siguiente (SW-086): no debe completar la siguiente.
- Dos corridas en cola a la vez (iniciar la segunda mientras la primera sigue pendiente): el rechazo de una no bloquea la otra.
- Copia de otra cuenta en el mismo teléfono, o JSON dañado en `localStorage`: no se muestra ni se reenvía nada ajeno.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `shared/driver-offline-cache.js` (nuevo) | Copia local de "Hoy" por usuario. |
| `shared/driver-offline-net.js` (nuevo) | `isNetworkFailure`, adaptador de asignación con caché. |
| `shared/driver-action-queue.js` (nuevo) | Cola de acciones, `sanitizeActionTime`, `flush` ordenado. |
| `shared/operations-adapter.js` (mod.) | `transitionRouteRun` acepta `opts.at` y `opts.runId`. |
| `frontend/driver-app.js` (mod.) | Controlador y montaje con modo offline. |
| `frontend/components/driver-screens.js` (mod.) | Franja sin conexión, chip de pendientes, acciones fallidas. |
| `frontend/app.js` (mod.) | Crear caché/cola, asignación en caché para el GPS, limpiar al cerrar sesión. |
| `tests/driver-offline-cache.test.mjs`, `driver-offline-net.test.mjs`, `driver-action-queue.test.mjs`, `driver-offline-controller.test.mjs`, `sw095-adapter-at.test.mjs`, `driver-offline-wiring.test.mjs` (nuevos); `driver-screens.test.mjs` (mod.) | Pruebas. |
| `docs/evidence/SW-095/`, `docs/superpowers/guides/2026-10-17-sw095-prueba-de-campo.md` | Capturas y guía de campo. |

---

### Task 0: Apéndice de hallazgos en el spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-sw095-modo-offline-conductor-design.md` (añadir sección al final)

- [ ] **Step 1: Añadir la sección «Hallazgos al planificar»** con estas tres decisiones, tal cual:
  1. `createDriverTelemetrySession` llama `operationsAdapter.findOwnVehicleAssignment` al arrancar el GPS; sin red el GPS no arrancaría. Solución: asignación en caché (`createOfflineAssignmentAdapter`, Task 3).
  2. `transitionRouteRun` actúa sobre la corrida más reciente de la ruta; tras completar, SW-086 crea la siguiente (`assigned`) y un `complete` reenviado la completaría por error. Solución: `opts.runId` fija la corrida exacta (Task 1); `start`/`complete` en cola llevan `runId`.
  3. Idempotencia de `start`/`complete`: con `runId`, `INVALID_ROUTE_TRANSITION` (ya iniciada/terminada) se trata como hecho.
- [ ] **Step 2: Commit** — `$HOME/gc95.sh "docs(SW-095): hallazgos al planificar"`.

---

### Task 1: Adaptador — hora real y corrida exacta

**Files:**
- Modify: `shared/operations-adapter.js` (`transitionRouteRun`, ~línea 510; `startRoute`, `completeRoute`/`updateProgress` ya le pasan `opts`)
- Test: `tests/sw095-adapter-at.test.mjs`

**Interfaces:**
- Produces: `adapter.startRoute(routeId, { at?: string, runId?: string })` y `adapter.completeRoute(routeId, { at?, runId? })` (verificar en `operations-adapter.js:240-243` que `completeRoute` reenvía `opts`; si no, reenviarlo). Con `runId` la consulta busca `route_runs.id = runId` (mismo `municipality_id`); sin `runId` el comportamiento actual no cambia. `at` es ISO y se usa en lugar de `new Date().toISOString()` solo si no hay valor previo.

- [ ] **Step 1: Prueba que falla** (cliente Supabase falso en memoria con `route_runs` y `vehicle_positions`; mirar cómo lo hacen `tests/sw090-adapter.test.mjs` / `tests/sw086*` para armar el falso):
  - `startRoute('r1', { at: '2026-10-17T09:00:00Z' })` → el `update` recibe `started_at: '2026-10-17T09:00:00Z'`.
  - `completeRoute('r1', { at: '2026-10-17T10:00:00Z', runId: 'run1' })` con `run1.started_at = '2026-10-17T09:00:00Z'` → `completed_at: '2026-10-17T10:00:00Z'`.
  - Con dos corridas de la ruta (`run1` `completed`, `run2` `assigned` más nueva): `completeRoute('r1', { runId: 'run1' })` devuelve `ok:false`, `error.code === 'INVALID_ROUTE_TRANSITION'` y **no** modifica `run2`.
  - Sin `at`/`runId` el resultado es el de antes (pruebas existentes verdes).
- [ ] **Step 2: Ejecutar** `node tests/sw095-adapter-at.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** en `transitionRouteRun(client, fallback, municipality_id, routeId, next, opts = {}, patch = {})`: si `opts.runId`, la consulta `findQuery` filtra `.eq('id', opts.runId)` en vez de `.eq('route_id', routeId).order(...).limit(1)`; `timingPatch.started_at = opts.at ?? new Date().toISOString()` (igual `completed_at`). Una línea de cuidado: `opts.at` ya viene saneado por la cola, el adaptador no valida.
- [ ] **Step 4: Ejecutar** la prueba nueva y `node tests/sw090-adapter.test.mjs` y `node tests/driver-app.test.mjs` → PASAN.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): hora real y corrida exacta en transiciones de ruta"`.

---

### Task 2: Copia local de "Hoy"

**Files:**
- Create: `shared/driver-offline-cache.js`
- Test: `tests/driver-offline-cache.test.mjs`

**Interfaces:**
- Produces:
  - `createDriverCache({ storage, key = 'smartwaste.driver-cache.v1', now = () => new Date() }) → { save(userId: string, snapshot: object): Promise<void>, load(userId: string): Promise<{ snapshot: object, savedAt: string } | null>, clear(): Promise<void> }`
  - `snapshot` = `{ driver, unit, runs, assignment }` (lo que devuelve `loadDriverToday` + `assignment` de `findOwnVehicleAssignment`; `assignment` puede ser `null`).

- [ ] **Step 1: Pruebas que fallan** (storage falso síncrono y otro asíncrono): `save` luego `load` devuelve el mismo snapshot y `savedAt` ISO; `load('otro-usuario')` → `null` (Review Focus: cuenta ajena); JSON dañado en el storage → `null` sin lanzar; `clear()` → `load` da `null`; storage que lanza al escribir (`setItem` lanza) → `save` no lanza.
- [ ] **Step 2: Ejecutar** `node tests/driver-offline-cache.test.mjs` → FALLA (módulo no existe).
- [ ] **Step 3: Implementar** `createDriverCache` en `shared/driver-offline-cache.js`: un solo registro JSON `{ userId, savedAt, snapshot }`; todo acceso a storage en `try/catch`.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): copia local de las rutas del día"`.

---

### Task 3: Detección de falta de red y asignación en caché

**Files:**
- Create: `shared/driver-offline-net.js`
- Test: `tests/driver-offline-net.test.mjs`

**Interfaces:**
- Produces:
  - `isNetworkFailure(result: { ok: boolean, error?: { code?: string, message?: string } } | null, { online = true } = {}): boolean` → `true` si `result.ok === false` y (`online === false` o el mensaje coincide `/failed to fetch|networkerror|network request failed|load failed|timeout|timed out|ECONN|ENOTFOUND|offline|sin conexi/i`). Errores de reglas/permisos (`42501`, `PGRST…`, `INVALID_ROUTE_TRANSITION`, `NO_ACTIVE_ROUTE_ASSIGNED`) → `false`.
  - `createOfflineAssignmentAdapter(adapter, { getCached: () => object | null, isOnline: () => boolean }) → adapter` — copia superficial de `adapter` con `findOwnVehicleAssignment(profileId, opts)` sustituido: llama al real; si `isNetworkFailure(result, { online: isOnline() })` y hay `getCached()`, devuelve `{ ok: true, source: 'OFFLINE_CACHE', data: cached }`; en cualquier otro caso devuelve el resultado real.

- [ ] **Step 1: Pruebas que fallan**: fallo `'TypeError: Failed to fetch'` → `true`; `{ code: '42501', message: 'new row violates row-level security' }` → `false`; `ok:true` → `false`; `online:false` con mensaje cualquiera → `true`; asignación: red caída + caché → `ok:true` con `data` del caché; red caída sin caché → resultado real (fallo); `NO_ACTIVE_ROUTE_ASSIGNED` con caché → **no** usa el caché; los demás métodos del adaptador siguen siendo los originales.
- [ ] **Step 2: Ejecutar** `node tests/driver-offline-net.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** ambas funciones. Antes, revisar cómo `run()` en `shared/operations-adapter.js` convierte un `fetch` caído en `fail(...)` y ajustar la expresión para que ese mensaje real quede cubierto (añadir un caso de prueba con ese mensaje exacto).
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): detección de falta de red y asignación en caché"`.

---

### Task 4: Cola de acciones

**Files:**
- Create: `shared/driver-action-queue.js`
- Test: `tests/driver-action-queue.test.mjs`

**Interfaces:**
- Consumes: `isNetworkFailure` (Task 3); adaptador con `startRoute(routeId, { at, runId })`, `completeRoute(routeId, { at, runId })`, `logFuel(entry)`, `listFuelLogs()`.
- Produces:
  - `sanitizeActionTime(at: string | undefined, { now: Date, startedAt?: string }): string | undefined` → ISO válido o `undefined` (usar hora del servidor). Reglas: no parseable → `undefined`; `> now + 5 min` → `undefined`; `< now − 2 días` → `undefined`; si `startedAt` y `at < startedAt` → `startedAt`.
  - `createDriverActionQueue({ storage, key = 'smartwaste.driver-actions.v1', now = () => new Date(), newId = () => crypto.randomUUID() }) → queue` con:
    - `enqueue(action: { type: 'start' | 'fuel' | 'complete', runId: string, routeId?: string, at?: string, entry?: object }): Promise<string>` (devuelve el id)
    - `list(): Promise<Array<{ id, type, runId, routeId, at, entry, status: 'pending' | 'failed', error?: string, createdAt: string }>>`
    - `pendingCount(): Promise<number>` (solo `pending` + `failed`)
    - `retry(id): Promise<void>` (`failed` → `pending`), `discard(id): Promise<void>`
    - `flush({ adapter, gpsFlush = async () => {}, isOnline = () => true }): Promise<{ sent: number, failed: number, stoppedByNetwork: boolean }>`

  Reglas de `flush` (orden por corrida, `createdAt` ascendente dentro de cada `runId`):
  1. `start` → `adapter.startRoute(routeId, { at: sanitize(at), runId })`. `INVALID_ROUTE_TRANSITION` = hecho.
  2. Antes del primer `fuel` o `complete` de esa corrida: `await gpsFlush()` (una vez por corrida).
  3. `fuel` → si `adapter.listFuelLogs()` ok y ya hay fila con mismo `route_run_id`, `vehicle_id` y `liters` → hecho; si no, `adapter.logFuel(entry)`.
  4. `complete` → `adapter.completeRoute(routeId, { at: sanitize(at, { startedAt: <at del start de esa corrida si está en cola> }), runId })`. `INVALID_ROUTE_TRANSITION` = hecho.
  5. Fallo de red (`isNetworkFailure`) → detener todo el vaciado, la acción sigue `pending`, `stoppedByNetwork: true`.
  6. Rechazo del servidor (otro error) → esa acción pasa a `failed` con `error` (mensaje), las siguientes acciones de **la misma** `runId` se saltan, las de otras corridas continúan.
  7. Dos `flush` simultáneos comparten la misma promesa (no se envía dos veces).

- [ ] **Step 1: Pruebas que fallan** (adaptador falso que registra llamadas): `sanitizeActionTime` con futuro (`now+10min` → `undefined`), muy viejo (3 días → `undefined`), `at < startedAt` → `startedAt`, basura → `undefined`, válido → mismo ISO. Cola: orden `start → gpsFlush → fuel → complete` aunque se encolen desordenadas entre corridas; `complete` reenviado tras `INVALID_ROUTE_TRANSITION` cuenta como enviado sin error; `fuel` ya existente en `listFuelLogs` no se vuelve a insertar (Review Focus: corte a mitad); corte de red en `fuel` → `complete` no se llama, `fuel` sigue `pending`; rechazo en la corrida A (`failed`) no frena la corrida B pero sí el `complete` de A; `retry` devuelve a `pending` y un nuevo `flush` lo envía; `discard` lo elimina; persistencia: una cola nueva sobre el mismo storage ve las acciones; JSON dañado → cola vacía; `flush` doble concurrente → cada llamada del adaptador ocurre una sola vez.
- [ ] **Step 2: Ejecutar** `node tests/driver-action-queue.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** en `shared/driver-action-queue.js`. Persistir tras cada mutación (mismo patrón que `createPersistentTelemetryQueue` en `shared/driver-app-telemetry.js`: estado en promesa perezosa, `setItem` tras cada cambio, storage posiblemente asíncrono).
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): cola de acciones del conductor con envío ordenado"`.

---

### Task 5: Controlador con modo offline

**Files:**
- Modify: `frontend/driver-app.js` (`createDriverController`)
- Test: `tests/driver-offline-controller.test.mjs` (y `tests/driver-app.test.mjs` sin cambios, debe seguir verde)

**Interfaces:**
- Consumes: `createDriverCache`, `createDriverActionQueue`, `isNetworkFailure`, `sanitizeActionTime` (Tasks 2–4).
- Produces: parámetros nuevos opcionales de `createDriverController({ ..., queue, cache, isOnline = () => globalThis.navigator?.onLine !== false })`; en `state`: `offline: boolean`, `savedAt: string | null`, `pendingActions: number`, `failedActions: Array<{ id, text }>`; en `c`: `c.syncQueue(): Promise<void>` (hace `queue.flush(...)` con `gpsFlush` y, si envió algo, `c.refresh()`), acciones nuevas `c.action('retry-action', id)` y `c.action('discard-action', id)`.

Comportamiento:
- `refresh()`: si `load()` ok → `cache.save(userId, { ...res, assignment })` (la asignación sale de `adapter.findOwnVehicleAssignment(userId)`, mejor esfuerzo; fallo → se conserva la anterior) y `state.offline = false`. Si `load()` falla con `isNetworkFailure`-compatible (mensaje de red u `isOnline() === false`) y `cache.load(userId)` devuelve copia → usa la copia (`state.offline = true`, `state.savedAt`); sin copia → error actual. Un error que no es de red **no** usa la copia.
- Las corridas con acciones pendientes en cola conservan su estado local (iniciada/terminada) sobre lo que diga la copia o el servidor desactualizado.
- `start(id)`: si `isOnline()` y cola vacía → camino actual pasando `{ runId: run.id }` al adaptador; si falla por red a mitad → encolar. Offline → estado local (`startedAt[run.id] = now ISO`, `gps.start()`, pantalla `run`) y `queue.enqueue({ type:'start', runId, routeId, at })`.
- `finish(text)`: validación de litros igual que hoy. Offline (o fallo de red) → con la asignación en caché arma `buildFuelEntry` y encola `fuel` (si hay litros y no `fuelSaved`) y `complete`, `gps.stop({ flush: true })`, vuelve a Hoy con la corrida marcada terminada localmente. La corrida terminada se oculta del siguiente "Hoy" local.
- `syncQueue()` se invoca desde `refresh()` al inicio cuando `isOnline()` y hay pendientes.

- [ ] **Step 1: Pruebas que fallan** reutilizando el `setup()` de `tests/driver-app.test.mjs` (copiar el patrón; storage falso en memoria): (a) abrir sin red con copia guardada → dibuja Hoy con `state.offline === true`; (b) abrir sin red sin copia → pantalla de error actual; (c) error de permisos (`42501`) con copia disponible → **no** usa la copia, muestra error; (d) iniciar offline → no llama `adapter.startRoute`, `gps.start` sí, hay 1 acción `start` con `runId`; (e) terminar offline con "45,5" → 0 llamadas de red, acciones `fuel` (litros `45.5`, `route_run_id` de la asignación en caché) y `complete` en cola, `gps.stop({ flush:true })`, pantalla Hoy; (f) `syncQueue()` con red de vuelta → orden `startRoute → logFuel → completeRoute` y la cola vacía, luego `refresh`; (g) acción rechazada → `state.failedActions` con texto en español y `retry-action`/`discard-action` funcionan; (h) sin `queue`/`cache` el flujo es idéntico al actual (se cubre con `tests/driver-app.test.mjs`).
- [ ] **Step 2: Ejecutar** `node tests/driver-offline-controller.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** los cambios en `createDriverController` descritos arriba, en `frontend/driver-app.js`.
- [ ] **Step 4: Ejecutar** `node tests/driver-offline-controller.test.mjs && node tests/driver-app.test.mjs && node tests/driver-today.test.mjs` → PASAN.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): controlador del conductor con modo offline"`.

---

### Task 6: Pantallas — estado sin conexión y pendientes

**Files:**
- Modify: `frontend/components/driver-screens.js` (`renderDriverToday`, `renderDriverRun`, `renderDriverFinish`)
- Test: `tests/driver-screens.test.mjs` (ampliar)

**Interfaces:**
- Consumes: nuevos campos de `state` (Task 5).
- Produces: las tres funciones aceptan `offline = false`, `savedAtText = ''`, `pendingCount = 0`, `failedActions = []` (`[{ id, text }]`) y los dibujan arriba con `escapeHtml`:
  - franja `<p class="sw-driver__offline" role="status">Sin conexión · datos de las {savedAtText}</p>` (solo si `offline`; si no hay hora: `Sin conexión`);
  - chip `<span class="sw-driver__chip" data-driver-field="queue">{N} pendiente(s) de enviar</span>` (solo si `pendingCount > 0`; singular/plural);
  - por cada fallida: `<li>` con `{text}` y botones `data-driver-retry-action="{id}"` ("Reintentar") y `data-driver-discard-action="{id}"` ("Descartar").

- [ ] **Step 1: Pruebas que fallan** en `tests/driver-screens.test.mjs`: con `offline:true, savedAtText:'07:42'` aparece "Sin conexión · datos de las 07:42"; sin `offline` no aparece; `pendingCount: 1` → "1 pendiente de enviar", `3` → "3 pendientes de enviar"; fallida con `text: '<b>x</b>'` sale escapada y trae ambos `data-` con el id; los textos existentes no cambian.
- [ ] **Step 2: Ejecutar** `node tests/driver-screens.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** un helper interno `offlineBlock({ offline, savedAtText, pendingCount, failedActions })` en `driver-screens.js` y llamarlo en las tres pantallas; añadir estilos mínimos `.sw-driver__offline`, `.sw-driver__failed` en `frontend/styles/driver.css` con las variables de tema existentes (sin colores literales).
- [ ] **Step 4: Ejecutar** `node tests/driver-screens.test.mjs` → PASA.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): estado sin conexión y pendientes en las pantallas del conductor"`.

---

### Task 7: Montaje y cableado en la app

**Files:**
- Modify: `frontend/driver-app.js` (`mountDriverApp`), `frontend/app.js` (`startDriverExperience` ~línea 3261, `startDriverGps` ~1185, `logout` ~3266)
- Test: `tests/driver-offline-wiring.test.mjs` (estática, patrón de `tests/driver-app-wiring.test.mjs`)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `mountDriverApp({ ..., storage, gpsFlush })`; el controlador recibe `cache`, `queue`, `isOnline`.

Cambios:
- `mountDriverApp`: crea `cache`/`queue` con `storage` (parámetro, `localStorage` desde `app.js`), pasa `queue`, `cache`, `isOnline: () => nav?.onLine !== false` al controlador; delega los clics `[data-driver-retry-action]` y `[data-driver-discard-action]` (`controller.action('retry-action'|'discard-action', id)`); en `online`, `visibilitychange` (visible), arranque y el intervalo de 60 s existente llama `controller.syncQueue()`; `setConn` también refresca el chip de pendientes.
- `startDriverExperience` (app.js): pasa `storage: localStorage` y `gpsFlush: () => driverTelemetrySession?.reconnect()`.
- `startDriverGps` (app.js): el `operationsAdapter` que recibe `createDriverTelemetrySession` es `createOfflineAssignmentAdapter(realAdapter, { getCached: () => <asignación de la copia>, isOnline: () => navigator.onLine !== false })`. `getCached` lee la asignación guardada por la copia (exponer `controller.cachedAssignment()` o leerla de `cache.load`; elegir una y dejarla en el test).
- `logout` (app.js): antes de `signOut` limpiar `smartwaste.driver-cache.v1` **y** `smartwaste.driver-actions.v1` solo si la cola está vacía; si hay pendientes, conservar la cola (se reenvía al volver a iniciar sesión con la misma cuenta) y borrar solo la copia.

- [ ] **Step 1: Pruebas estáticas que fallan** (`tests/driver-offline-wiring.test.mjs`, lectura de fuentes con regex): `app.js` contiene `createOfflineAssignmentAdapter(realAdapter` dentro de `startDriverGps`, `storage: localStorage` en `startDriverExperience`, `gpsFlush:`; `driver-app.js` contiene `createDriverActionQueue(`, `createDriverCache(`, `controller.syncQueue()` ligado a `'online'` y a `visibilitychange`, y las dos delegaciones `data-driver-retry-action` / `data-driver-discard-action`; `logout` menciona ambas claves de almacenamiento.
- [ ] **Step 2: Ejecutar** `node tests/driver-offline-wiring.test.mjs` → FALLA.
- [ ] **Step 3: Implementar** los cambios descritos. Mantener `node --check` limpio (copiar `frontend/app.js` a `/tmp/x.mjs` y `node --check`).
- [ ] **Step 4: Ejecutar** `node tests/driver-offline-wiring.test.mjs && node tests/driver-app-wiring.test.mjs && node tests/driver-app-session.test.mjs && node tests/driver-app-telemetry.test.mjs` → PASAN.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): modo offline conectado a la app del conductor"`.

---

### Task 8: Evidencia, guía de campo y cierre

**Files:**
- Create: `scripts/sw095-harness.mjs` (o ampliar `scripts/sw090-harness.mjs`), `docs/evidence/SW-095/*.png`, `docs/superpowers/guides/2026-10-17-sw095-prueba-de-campo.md`
- Modify: `claude/estado-rediseno-mando.md` (documento del proyecto, vía la herramienta de Proyectos)

- [ ] **Step 1: Capturas** con el harness (componentes reales, datos de ejemplo, salida en `.claude/harness/` ignorado por git) de: Hoy sin conexión con copia, En ruta con "2 pendientes de enviar", una acción fallida con Reintentar/Descartar; en tema claro y oscuro, ancho de teléfono (390 px). Guardar PNG en `docs/evidence/SW-095/`.
- [ ] **Step 2: Guía de campo** (español, tuteo, pasos numerados, para Miguel): modo avión → abrir app → iniciar → caminar/recorrer unos minutos → terminar con litros → ver "N pendientes" → quitar modo avión → esperar a "todo enviado" → en la web, Métricas › Corridas: la corrida con horas reales de inicio/fin, km medidos y litros; qué hacer si sale "No se pudo enviar"; recordar recompilar el APK (subir `ANDROID_VERSION_CODE` por encima del instalado, con `SUPABASE_URL`/`ANON_KEY`).
- [ ] **Step 3: Suite completa**: `for f in tests/*.test.mjs; do node $f >/dev/null 2>&1 || echo FALLA $f; done` → solo fallan las 13 de Supabase local ya conocidas ("pendiente de CI"); anotar cuáles.
- [ ] **Step 4: Documento del proyecto**: añadir SW-095 (alcance, ramas, qué probar, pendiente: recompilar APK) a `claude/estado-rediseno-mando.md`.
- [ ] **Step 5: Commit** — `$HOME/gc95.sh "feat(SW-095): evidencia visual y guía de prueba de campo"`; avisar a Miguel con el comando `git push -u origin feature/sw095-modo-offline-conductor` (desde `C:\mt-it\SmartWaste`) **sin ejecutarlo**.

---

## Self-review (hecha al escribir)

- **Cobertura del spec:** copia local → Task 2/5; cola y orden → Task 4; horas → Tasks 1 y 4; combustible sin duplicar → Task 4; controlador/pantallas → Tasks 5–6; sesión y limpieza al cerrar sesión → Task 7; GPS sin red → Tasks 3 y 7 (hallazgo nuevo, Task 0); corrida exacta → Task 1 (hallazgo nuevo).
- **Tipos:** `runId`/`at` consistentes entre Task 1 (adaptador), Task 4 (cola) y Task 5 (controlador); `createOfflineAssignmentAdapter` y `isNetworkFailure` solo se definen en Task 3 y se consumen en 4, 5 y 7.
- **Review Focus** cubierto por pruebas en: reloj (Task 4), corte a mitad (Task 4), reenvío tras siguiente corrida (Task 1), dos corridas (Task 4), cuenta ajena/JSON dañado (Task 2).

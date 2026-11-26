# SW-095 — Modo offline de la app del conductor (diseño)

Fecha: 2026-10-17 · Rama: `feature/sw095-modo-offline-conductor` (desde `main` tras PR #111)

## Objetivo
Que el conductor pueda abrir la app, iniciar una ruta, recorrerla y terminarla (con litros) **sin internet**, y que todo llegue a Supabase, con las horas reales, cuando vuelva la señal. Sirve para completar las pruebas de campo (el Android no tenía internet) y para uso real en zonas sin cobertura.

Alcance elegido por Miguel: **ciclo completo offline** (sin mapa de fondo offline).

## Punto de partida (ya existe)
- `shared/driver-app-telemetry.js`: cola persistente del GPS (`createPersistentTelemetryQueue`, contrato `getItem/setItem`, idempotente por id, reenvío por lotes). **No se toca.**
- `frontend/driver-app.js`: `createDriverController` (recibe `load`, `adapter`, `gps`, `draw` por parámetro, sin DOM ni red propios) y `mountDriverApp`.
- `shared/driver-data.js::loadDriverToday` lee conductor, corridas, rutas, paradas y camión (solo lecturas).
- `shared/operations-adapter.js::transitionRouteRun` estampa `started_at`/`completed_at` con `new Date()` **del lado cliente** (no hay trigger), y al completar calcula distancia/puntos GPS desde `vehicle_positions`. Restricción de BD: `completed_at >= started_at`.
- RLS: el chofer ya puede actualizar su propia corrida (`driver_update_own_route_run`) → **no hace falta migración**.

## Qué falla hoy sin internet
Cargar las rutas del día, iniciar, guardar litros (además pide la asignación de vehículo por red), terminar. El mapa de fondo OSM no dibuja (se acepta).

## Diseño

### 1. Copia local de "Hoy" — `shared/driver-offline-cache.js` (nuevo)
- `createDriverCache({ storage, key })`: `save(userId, snapshot)`, `load(userId)`, `clear()`.
- Snapshot = resultado de `loadDriverToday` + `assignment` (de `findOwnVehicleAssignment`, con `route_run_id`) + `savedAt`.
- Clave por usuario; `load` devuelve `null` si `userId` no coincide o el JSON está dañado. Se borra en `logout`.
- `loadDriverToday` ok → `save`. Falla de red (no un error de reglas) → `load`; si hay copia, se usa con `fromCache: true` y `savedAt`; si no, error actual.
- Distinguir "sin red" de "error real": un error de reglas/permisos **no** cae a la copia (para no ocultar un problema real). Criterio: `navigator.onLine === false` o error de `fetch` (TypeError/`Failed to fetch`/`Network`).

### 2. Cola de acciones — `shared/driver-action-queue.js` (nuevo)
- Acciones: `start` {routeId, at}, `fuel` {entry, runId, at}, `complete` {routeId, at}.
- Cada acción tiene `id` único (se genera al encolar), `createdAt`, estado `pending | failed`, `error`.
- `enqueue(action)`, `list()`, `retry(id)`, `discard(id)`, `flush({ adapter, gpsFlush })`.
- `flush` envía **en orden por corrida**: `start` → vaciar GPS pendiente (`gpsFlush`) → `fuel` → `complete`. `complete` va al final porque `transitionRouteRun` calcula distancia con los puntos ya subidos.
- Una acción `failed` por rechazo del servidor (reglas, transición inválida, ruta no encontrada) **no bloquea** las de otras corridas; sí bloquea las posteriores de **su misma corrida** (dependen unas de otras). Un fallo de red detiene el vaciado sin marcar `failed`.
- Idempotencia: `start`/`complete` ya aplicados en servidor (`canTransitionRoute` devuelve rechazo porque ya está en ese estado o estampado) se tratan como hechos; `fuel` lleva `client_ref` = id de acción y se omite si ya existe (ver «Combustible»).
- Persistencia con el mismo contrato de almacenamiento que la cola del GPS (sobrevive a cierres de app).

### 3. Horas reales
- `transitionRouteRun(..., opts)` acepta `opts.at` (ISO) para `started_at` / `completed_at`.
- Validación en `shared/driver-action-queue.js` (función pura `sanitizeActionTime(at, now, startedAt)`): se descarta (usa hora del servidor) si es futura (> now + 5 min) o anterior a 2 días; `completed_at` nunca antes de `started_at` (se sube a `started_at`).
- `distance_meters`/`gps_points_count` siguen saliendo del GPS ya sincronizado.

### 4. Combustible sin duplicar
- `fuel_logs` ya recibe `route_run_id` por `buildFuelEntry`. Para idempotencia sin migración: antes de insertar se consulta si ya hay un `fuel_logs` para ese `route_run_id` con los mismos litros y conductor creado en la ventana de la corrida; si existe, se da por hecho. (Si la tabla no se puede consultar, se encola y se acepta el riesgo mínimo de duplicado ante un corte justo entre insert y confirmación; se documenta.)

### 5. Controlador (`createDriverController`)
- Nuevos parámetros opcionales: `queue`, `cache`, `isOnline`. Sin ellos se comporta igual que hoy (compatibilidad con pruebas existentes).
- `start/finish`: si `isOnline()` y no hay cola pendiente → camino actual. Si no → se aplica **local** (estado, `startedAt` local, pantalla siguiente) y se encola. Si el camino en línea falla por red a mitad, se cae a encolar.
- Pantallas: franja "Sin conexión · datos de las HH:MM" (copia) y chip "N pendientes de enviar"; pendiente `failed` muestra "No se pudo enviar" con **Reintentar** / **Descartar**.
- Disparadores de `flush`: evento `online`, al abrir la app, `visibilitychange`, y el intervalo de 60 s existente. Tras `flush` con éxito → `refresh()`.
- `refresh()` offline no pisa una ruta en curso local: el estado local de corridas con acciones pendientes prevalece sobre la copia.

### 6. Sesión
- Sin internet la app usa la copia aunque el token haya caducado. Al volver la señal se renueva la sesión; si no se puede, se pide iniciar sesión **sin borrar la cola ni la copia** (solo `logout` explícito las borra).
- `mountDriverApp` crea `driverCache`/`queue` con `localStorage` (WebView de Capacitor), claves `smartwaste.driver-cache.v1` y `smartwaste.driver-actions.v1`.

### 7. Fuera de alcance
Tiles del mapa offline; rutas nuevas asignadas mientras el teléfono no tiene señal (aparecen al reconectar); cambios de BD/migraciones; sincronización de otros roles; reordenar paradas offline.

## Pruebas (TDD, sin red)
1. `driver-offline-cache`: guardar/cargar, usuario distinto → null, JSON dañado, borrado.
2. `driver-action-queue`: orden start→gps→fuel→complete, idempotencia, corte de red a mitad (reintenta sin duplicar), rechazo del servidor (marca `failed`, no bloquea otras corridas, sí la misma), retry/discard, persistencia tras recargar.
3. `sanitizeActionTime`: futuro, muy viejo, `completed < started`.
4. Adaptador: `opts.at` estampa `started_at/completed_at`; sin `at` igual que hoy.
5. Controlador offline: abrir con copia, iniciar offline, terminar con litros offline, reconexión que vacía la cola y refresca; online sin cambios (pruebas actuales intactas).
6. Cableado (`driver-app-wiring`): `localStorage`, evento `online`, textos de estado.
7. Las pruebas que dependen de Supabase local siguen "pendiente de CI".

## Entregables
Código + pruebas + capturas (Hoy offline, En ruta con pendientes, pendiente fallido) en `docs/evidence/SW-095/` + guía de prueba de campo para Miguel (modo avión → recorrer → terminar → reconectar → qué ver en Métricas) + nota: hay que recompilar el APK (subir `ANDROID_VERSION_CODE`).

## Riesgos
- Reloj del teléfono mal puesto → mitigado por `sanitizeActionTime` (rango y orden).
- `localStorage` limitado (~5 MB): la copia es pequeña (paradas de las rutas del día).
- Doble envío por corte: idempotencia por estado para `start/complete`, ventana por `route_run_id` para `fuel`.

# SW-029 — GPS del teléfono en la vista Conductor (modo demo/tour)

> Datos demo · no producción. Cerrado — **no hay fase 2 planeada**, ver "Decisión de cierre" abajo.

## Objetivo

La vista móvil del conductor (SW-021) solo mostraba posiciones simuladas vía `DeviceSimulator`. Este
hito agrega un selector "Simulado" / "GPS del teléfono" para que, en una demo o un tour del producto,
se pueda mostrar la posición real del navegador/teléfono en el mapa del propio conductor, sin
depender de ningún backend real conectado.

Esto es **distinto** del botón "Compartir mi ubicación real" que ya existe en la misma vista (roadmap
ítem 3, `shared/browser-geolocation.js` + `startDriverGps()`/`stopDriverGps()` en `frontend/app.js`):
ese botón es el flujo real, autenticado, ya `VERIFIED_REAL` (`docs/TECHNICAL_DEBT_REGISTER.md` ítem
#20) — persiste en `vehicle_positions` (`source: 'browser_geolocation'`), exige una sesión de chofer
real (`realAdapter`/`driverAuthContext`) y solo aparece con un backend conectado (`backendMode !==
'DEMO_ONLY'`). Es el flujo que va a usar el piloto real (SW-041) cuando arranque.

## Decisión de cierre (confirmada con el Project Owner, 2026-09-27)

**`shared/phone-gps.js` es demo/tour-only por diseño permanente, no una fase 1 de algo que se
completa después.** No se abre una fase 2 para conectarlo a Supabase ni para agregar `'phone'` al
esquema de `vehicle_positions`.

Razón: la necesidad de "ver GPS real del conductor" ya tiene solución técnica de punta a punta —
`browser_geolocation`, verificado contra Supabase real (ver ítem #20 del registro de deuda). Construir
un segundo camino de persistencia real para el mismo caso de uso sería trabajo redundante. Lo único
que falta para que un conductor real use GPS real en el piloto de Laguna Salada es que el piloto en sí
arranque (SW-041 — coordinación con el ayuntamiento, no ingeniería pendiente).

`phone-gps.js` queda tal como está hoy: un modo alternativo al simulado para demos/tours del
producto, sin sesión real ni backend, que nunca escribe a Supabase. Si en el futuro apareciera una
necesidad real distinta que justifique reabrir esto (por ejemplo, un caso de uso donde `'phone'` deba
ser una fuente real separada de `'browser_geolocation'`), es un hito nuevo con su propio número y su
propia justificación — no una continuación de este.

## Alcance (lo que sí se construyó, sin cambios desde el cierre)

- `shared/phone-gps.js` (puro, sin DOM/navigator): `isAccuracyAcceptable()` (descarta lecturas con
  `accuracy` peor a 50m), `shouldSendPhonePing()` (throttle de 4.5s por defecto, dentro del rango
  pedido de 4-5s), `buildPhoneGpsPing()` (arma el objeto de posición con `source: 'phone'` y
  `device_id`, mismo patrón que `positionFromGeolocationEvent()` pero sin exigir `route_run_id`, que
  este modo no necesita).
- `frontend/app.js`:
  - Selector `#driverGpsModeSelect` en `renderDriverMobile()` — "Simulado" (default, seleccionado en
    cada render) o "GPS del teléfono". Disponible sin importar `backendMode`.
  - `startPhoneGps()`/`stopPhoneGps()`: usan `navigator.geolocation.watchPosition()` con
    `enableHighAccuracy: true`. Los pings que pasan el filtro de precisión y el throttle se guardan
    con `positionHistory.record(...)` — el mismo almacén demo en memoria que ya usa el modo
    simulado (`tickDriverTelemetry()`), así que el trazo/marcador/paradas ya existentes en
    `drawDriverPositions()` funcionan sin cambios adicionales.
  - Mensajes explícitos y distintos para permiso denegado, GPS no disponible, tiempo de espera
    agotado, y señal débil (precisión fuera de rango) — nunca falla en silencio.
  - Marcador de posición real con color distinto (rojo) del simulado (azul), más un círculo de
    precisión (`L.circle` con radio = `accuracy` en metros) alrededor del punto actual.
  - Wake Lock API (`navigator.wakeLock`) mientras el modo teléfono está activo, para que la pantalla
    no se apague — con reserva silenciosa si el navegador no lo soporta (p. ej. Safari/iOS a la
    fecha de este hito).
  - Cambiar de vehículo en el selector `#driverVehicleSelect` vuelve automáticamente a "Simulado" —
    un watch de GPS real no debe seguir apuntando a un vehículo del que el conductor navegó lejos.
  - Mientras un vehículo está en modo teléfono, `tickDriverTelemetry()` deja de avanzar su
    `DeviceSimulator` (vía `phoneGpsActiveVehicleIds`), para que puntos simulados y reales no se
    mezclen en el mismo trazo.

## Fuera de alcance permanente (decisión de cierre, no pendiente de ingeniería)

- **Ningún ping de este modo llega a `vehicle_positions`, ni va a llegar.** Pasan por
  `positionHistory` (el mismo adaptador demo que ya usa el modo simulado), nunca por
  `createTelemetryIngestionAdapter(...).ingest()`. Verificable leyendo `startPhoneGps()` en
  `frontend/app.js`, que no importa ni llama a ese adaptador.
- `shared/telemetry-simulator.js`'s `TELEMETRY_SOURCES` no incluye `'phone'`, ni la migración de
  `vehicle_positions` tiene ese valor en su `CHECK` constraint — y no se va a agregar como parte de
  este hito. El camino real equivalente ya existe con `source: 'browser_geolocation'`.
- `device_id` real por dispositivo físico (este modo usa un valor por defecto fijo,
  `'phone-browser'`) no aplica — no hay dispositivo real que reconciliar en un modo demo/tour.

## Evidencia automática

`tests/phone-gps.test.mjs` (puro, sin navegador — mismo patrón que `tests/browser-geolocation.test.mjs`):
filtro de precisión (umbral exacto, por debajo/por encima, valores inválidos, umbral personalizado),
throttle (antes/exactamente en/después del intervalo mínimo), armado del ping (`source`/`device_id`
correctos, campos nulos del navegador default a 0, `device_id` personalizado).

Verificación interactiva pendiente del Project Owner (este sandbox no tiene navegador con GPS real):
confirmar en un teléfono real que el selector cambia el marcador a la posición real, que los 3 casos
de error muestran su mensaje correspondiente, y que la pantalla no se apaga mientras el modo está
activo. Esta verificación es sobre el modo demo/tour en sí, no sustituye ni depende de la
verificación del piloto real (SW-041).

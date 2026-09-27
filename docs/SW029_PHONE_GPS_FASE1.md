# SW-029 — GPS real del teléfono en la vista Conductor (fase 1)

> Datos demo · no producción. Fase 1 de 2 — ver "Fuera de alcance" abajo.

## Objetivo

La vista móvil del conductor (SW-021) solo mostraba posiciones simuladas vía `DeviceSimulator`. Esta
fase agrega un selector "Simulado" / "GPS del teléfono" para que el propio conductor pueda ver su
posición real (la del navegador/teléfono) en su propio mapa, sin todavía conectar esa posición a
Supabase — esa conexión es la fase 2, deliberadamente fuera de alcance acá.

Esto es distinto del botón "Compartir mi ubicación real" que ya existe en la misma vista (roadmap
ítem 3, `shared/browser-geolocation.js`): ese botón sí persiste en `vehicle_positions`
(`source: 'browser_geolocation'`) y solo aparece con un backend real conectado. El selector de esta
fase funciona siempre, incluso en modo 100% demo, y nunca toca Supabase.

## Alcance

- `shared/phone-gps.js` (nuevo, puro, sin DOM/navigator): `isAccuracyAcceptable()` (descarta
  lecturas con `accuracy` peor a 50m), `shouldSendPhonePing()` (throttle de 4.5s por defecto, dentro
  del rango pedido de 4-5s), `buildPhoneGpsPing()` (arma el objeto de posición con
  `source: 'phone'` y `device_id`, mismo patrón que `positionFromGeolocationEvent()` pero sin exigir
  `route_run_id`, que esta fase no necesita).
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

## Fuera de alcance (fase 2, no construida en este hito)

- **Ningún ping de esta fase llega a `vehicle_positions`.** Pasan por `positionHistory` (el mismo
  adaptador demo que ya usa el modo simulado), nunca por
  `createTelemetryIngestionAdapter(...).ingest()`. Esto es intencional, no un olvido — verificable
  leyendo `startPhoneGps()` en `frontend/app.js`, que no importa ni llama a ese adaptador.
- `shared/telemetry-simulator.js`'s `TELEMETRY_SOURCES` no incluye `'phone'` todavía, ni la
  migración de `vehicle_positions` tiene ese valor en su `CHECK` constraint — agregar ambos es
  trabajo de fase 2, cuando de verdad se persista.
- Reconciliar `device_id` real por dispositivo (esta fase usa un valor por defecto fijo,
  `'phone-browser'`) queda para cuando la fase 2 identifique dispositivos físicos distintos.

## Evidencia automática

`tests/phone-gps.test.mjs` (puro, sin navegador — mismo patrón que `tests/browser-geolocation.test.mjs`):
filtro de precisión (umbral exacto, por debajo/por encima, valores inválidos, umbral personalizado),
throttle (antes/exactamente en/después del intervalo mínimo), armado del ping (`source`/`device_id`
correctos, campos nulos del navegador default a 0, `device_id` personalizado).

Verificación interactiva pendiente del Project Owner (este sandbox no tiene navegador con GPS real):
confirmar en un teléfono real que el selector cambia el marcador a la posición real, que los 3 casos
de error muestran su mensaje correspondiente, y que la pantalla no se apaga mientras el modo está
activo.

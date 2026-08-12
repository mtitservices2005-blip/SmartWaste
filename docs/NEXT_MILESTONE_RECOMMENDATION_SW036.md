# Recomendación de próximo hito — SW-036

> Datos demo · no producción. Basado en `docs/TECHNICAL_DEBT_REGISTER.md` (ítems #14 y #20) y en la conversación de planeación posterior a los PR #49/#50 (2026-08-07).

## Por qué este hito y no otro

Todo lo que hoy le falta al sistema para soportar una demo cerrada con datos reales — operadores y choferes reales, rutas atendidas de verdad — se reduce a una sola cosa: **el despachador nunca ve la posición real de un camión**, solo la simulación. El chofer ya puede activar "Compartir mi ubicación real" (roadmap ítem 3, ya entregado) y esa posición se persiste en Supabase (`vehicle_positions`, `source: browser_geolocation`), pero el mapa de Operaciones/Municipal sigue leyendo únicamente el motor de simulación (`simState`/`drawMapLayers()`). Es una brecha, no un bug: fue una decisión de alcance explícita en el hito que entregó el GPS real (ver `docs/TECHNICAL_DEBT_REGISTER.md` ítem #20).

Construir cualquier otra cosa (nuevas vistas, más automatizaciones) antes de cerrar esto no acerca al piloto real — esta es la brecha que importa.

## Alcance

1. **GPS real en el mapa de Operaciones, vía polling — no Realtime.** Corrección tras revisión de Codex en PR #51: la vista propia del conductor (`drawDriverPositions()`) usa un `setInterval` (`startDriverPolling()`, cada `DRIVER_POLL_INTERVAL_MS`), pero lo que lee es `positionHistory` — el historial demo en memoria — nunca `realAdapter.listPositions()` contra Supabase. Ni siquiera la propia posición real que un chofer envía con "Compartir mi ubicación real" se refleja hoy en su propio mapa. Lo que este hito reutiliza del patrón existente es solo la **forma del loop** (temporizador + redibujado, en vez de una suscripción Realtime); la llamada asíncrona a Supabase con manejo de errores/ciclo de vida (¿qué pasa si `realAdapter` no está listo, si la consulta falla, si el componente se desmonta a mitad de un poll?) es trabajo nuevo, no algo ya probado. Reutilizar Realtime sigue estando descartado por la misma razón (ítem #14: no determinístico, 3 corridas idénticas de CI con 3 comportamientos distintos, uno sin ninguna señal de error visible). Los camiones sin GPS real activo siguen mostrando la simulación exactamente como hoy (no se toca `simState`/`drawMapLayers()` para nadie más).
2. **Distinción visual obligatoria entre posición real y simulada** en el mapa de Operaciones (badge/pill tipo "GPS real" vs "Simulación"). Sin esto, cualquier posición mostrada corre el riesgo de leerse como real cuando no lo es — choca directo con la regla 6/7 de `CLAUDE.md` (no afirmar integraciones reales sin evidencia, preservar la etiqueta de datos demo).
3. **Regla de frescura/heartbeat para el GPS real.** Corrección tras revisión de Codex en PR #51: `stopDriverGps()` solo limpia el `watchPosition` local (`navigator.geolocation.clearWatch()`) — no escribe ningún estado "dejé de compartir" a Supabase, y `vehicle_positions` no tiene columna de estado, solo `captured_at`/`received_at`. Si el chofer cierra el navegador, pierde conectividad, o el proceso muere sin pasar por el botón "Detener GPS real", el polling seguiría mostrando la última posición conocida como "real" indefinidamente. Este hito debe definir un umbral de frescura (a determinar, orden de magnitud del intervalo de polling — ej. 2-3x) contra `captured_at`: pasado ese umbral, el camión cae automáticamente a mostrar la simulación en vez de una posición real potencialmente vieja.
4. **Regresión de gating dirigida a las sub-vistas de Operaciones** (`OPS_SUBVIEW_ROLES` en `frontend/auth-gate.js`), no una verificación de login desde cero. Corrección tras revisión de Codex en PR #51: el login con roles reales **ya está verificado interactivamente y clasificado `VERIFIED_REAL`** (`docs/CURRENT_STATE_AUDIT.md`, fila "Control de acceso por rol en UI", 2026-07-30; detalle en `docs/FRONTEND_LOGIN_SETUP.md`) — mi borrador original lo daba por pendiente basándose en una entrada desactualizada del registro de deuda (ítem #6) sin cruzarla con el audit. Lo que sí es nuevo y no tiene evidencia interactiva: las 4 sub-vistas de Operaciones (Fase 3 UX, PR #49) son posteriores a esa verificación de 2026-07-30. Este hito solo necesita un chequeo dirigido: con cada uno de los 5 roles sembrados, confirmar en navegador real que `pickVisibleOpsViews()` oculta/muestra las pestañas/paneles de Mapa/Rutas/Flota/Incidencias como espera la tabla ya documentada — no repetir la verificación completa de login.
5. **Definir el piloto mínimo** (documentación, no código): 1-2 camiones, 1-2 choferes reales, ventana de tiempo acotada (ej. una semana), criterios de éxito explícitos.

## Criterios de aceptación

- Un camión con "Compartir mi ubicación real" activo aparece en el mapa de Operaciones con su posición real (no la simulada), actualizándose por polling contra Supabase (`realAdapter.listPositions()` o equivalente) en un intervalo definido (a determinar, mismo orden de magnitud que `DRIVER_POLL_INTERVAL_MS`).
- Si la posición real más reciente de un camión supera el umbral de frescura definido, el mapa deja de mostrarla como real y cae a la simulación — nunca una posición real indefinidamente vieja presentada como vigente.
- La UI distingue sin ambigüedad, en cada camión visible, si su posición es real o simulada.
- Los camiones sin GPS real activo siguen exactamente igual que hoy — sin regresión al motor de simulación existente.
- Gating de las 4 sub-vistas de Operaciones verificado en navegador real contra Supabase local para los 5 roles sembrados, con evidencia reproducible (comando/pasos, resultado) — no solo código revisado.
- `docs/CURRENT_STATE_AUDIT.md` refleja el nuevo estado (GPS real en mapa de Operaciones, regresión de sub-vistas) con esa evidencia.

## Fuera de alcance (explícito)

- No tocar Realtime en sí ni intentar depurar la infraestructura self-hosted — queda documentado como no resoluble desde este lado (ítem #14).
- No persistir la reoptimización dinámica (ítem #21) ni la estimación de viviendas (ítem #22) — quedan como están, sin relación con este hito.
- No catastro municipal real, no otros municipios, no exponer `service_role` al frontend ni a dispositivos físicos (regla 8).
- El piloto en sí (elegir choferes, coordinar fechas) es decisión del Project Owner, no de este hito de código — este hito solo deja el sistema listo para que esa decisión se pueda tomar con confianza.

## Alternativas menores — no priorizadas por ahora

- Reemplazar/depurar Realtime en profundidad (ya investigado a fondo en SW-022, sin causa raíz resoluble desde el cliente).
- Persistir la reoptimización dinámica o la estimación de viviendas.

Quedan documentadas como trabajo futuro, no como parte de SW-036.

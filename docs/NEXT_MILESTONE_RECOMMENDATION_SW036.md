# Recomendación de próximo hito — SW-036

> Datos demo · no producción. Basado en `docs/TECHNICAL_DEBT_REGISTER.md` (ítems #14 y #20) y en la conversación de planeación posterior a los PR #49/#50 (2026-08-07).

## Por qué este hito y no otro

Todo lo que hoy le falta al sistema para soportar una demo cerrada con datos reales — operadores y choferes reales, rutas atendidas de verdad — se reduce a una sola cosa: **el despachador nunca ve la posición real de un camión**, solo la simulación. El chofer ya puede activar "Compartir mi ubicación real" (roadmap ítem 3, ya entregado) y esa posición se persiste en Supabase (`vehicle_positions`, `source: browser_geolocation`), pero el mapa de Operaciones/Municipal sigue leyendo únicamente el motor de simulación (`simState`/`drawMapLayers()`). Es una brecha, no un bug: fue una decisión de alcance explícita en el hito que entregó el GPS real (ver `docs/TECHNICAL_DEBT_REGISTER.md` ítem #20).

Construir cualquier otra cosa (nuevas vistas, más automatizaciones) antes de cerrar esto no acerca al piloto real — esta es la brecha que importa.

## Alcance

1. **GPS real en el mapa de Operaciones, vía polling — no Realtime.** La vista propia del conductor ya resuelve el mismo problema con polling cada `DRIVER_POLL_INTERVAL_MS` en lugar de Realtime, precisamente porque Realtime demostró ser no determinístico (ítem #14 del registro de deuda: 3 corridas idénticas de CI, mismo código, 3 comportamientos distintos, uno de ellos sin ninguna señal de error visible desde el cliente). En vez de perseguir un bug de infraestructura self-hosted ajeno al código de este repo, extender el mismo patrón de polling ya probado al mapa del despachador, para los camiones con GPS real activo únicamente — los camiones sin GPS real activo siguen mostrando la simulación exactamente como hoy (no se toca `simState`/`drawMapLayers()` para nadie más).
2. **Distinción visual obligatoria entre posición real y simulada** en el mapa de Operaciones (badge/pill tipo "GPS real" vs "Simulación"). Sin esto, cualquier posición mostrada corre el riesgo de leerse como real cuando no lo es — choca directo con la regla 6/7 de `CLAUDE.md` (no afirmar integraciones reales sin evidencia, preservar la etiqueta de datos demo).
3. **Verificación interactiva de login con roles reales** (ítem #6, pendiente desde SW-032) en LabPC, contra Supabase local — confirmar que un chofer real puede loguearse y ver solo lo que le corresponde (`SECTION_ROLES`/`OPS_SUBVIEW_ROLES` en `frontend/auth-gate.js`) antes de entregarle credenciales de verdad a alguien.
4. **Definir el piloto mínimo** (documentación, no código): 1-2 camiones, 1-2 choferes reales, ventana de tiempo acotada (ej. una semana), criterios de éxito explícitos.

## Criterios de aceptación

- Un camión con "Compartir mi ubicación real" activo aparece en el mapa de Operaciones con su posición real (no la simulada), actualizándose por polling en un intervalo definido (a determinar, mismo orden de magnitud que `DRIVER_POLL_INTERVAL_MS`).
- La UI distingue sin ambigüedad, en cada camión visible, si su posición es real o simulada.
- Los camiones sin GPS real activo siguen exactamente igual que hoy — sin regresión al motor de simulación existente.
- Login de un usuario con rol `driver` verificado en navegador real contra Supabase local, con evidencia reproducible (comando/pasos, resultado) — no solo código revisado.
- `docs/CURRENT_STATE_AUDIT.md` reclasifica estos ítems a `VERIFIED_REAL` con esa evidencia.

## Fuera de alcance (explícito)

- No tocar Realtime en sí ni intentar depurar la infraestructura self-hosted — queda documentado como no resoluble desde este lado (ítem #14).
- No persistir la reoptimización dinámica (ítem #21) ni la estimación de viviendas (ítem #22) — quedan como están, sin relación con este hito.
- No catastro municipal real, no otros municipios, no exponer `service_role` al frontend ni a dispositivos físicos (regla 8).
- El piloto en sí (elegir choferes, coordinar fechas) es decisión del Project Owner, no de este hito de código — este hito solo deja el sistema listo para que esa decisión se pueda tomar con confianza.

## Alternativas menores — no priorizadas por ahora

- Reemplazar/depurar Realtime en profundidad (ya investigado a fondo en SW-022, sin causa raíz resoluble desde el cliente).
- Persistir la reoptimización dinámica o la estimación de viviendas.

Quedan documentadas como trabajo futuro, no como parte de SW-036.

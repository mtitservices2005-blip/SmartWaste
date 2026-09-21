# SW-062 — Persistencia de recorrido GPS y métricas de ruta

## Objetivo

Demostrar de forma reproducible que una corrida real conserva su rastro GPS y que, al cerrarla,
SmartWaste persiste métricas derivadas de ese mismo rastro. Este hito no convierte datos simulados
en reales: solo acepta como evidencia del recorrido las posiciones cuyo `source` no sea
`simulator` y que estén vinculadas al `route_run` activo.

## Cambios

- `vehicle_positions.route_run_id` vincula cada muestra a una ejecución exacta.
- El GPS del navegador obtiene `vehicle_id`, `route_id` y `route_run_id` desde la corrida activa del
  chofer; ya no consulta ambiguamente todas sus asignaciones.
- Al finalizar desde la vista Conductor, se detiene la captura y se esperan los envíos GPS que aún
  estén pendientes antes de calcular métricas.
- `route_runs` conserva:
  - `distance_meters`;
  - `gps_points_count`;
  - `gps_started_at`;
  - `gps_ended_at`;
  - `started_at`, `completed_at` y `progress`, ya existentes.
- El detalle de la ruta muestra la cantidad de puntos GPS reales guardados y el intervalo cubierto.

## Evidencia automática

La prueba `tests/gps-route-metrics.test.mjs` ejecuta contra Supabase local el ciclo completo:

1. asigna vehículo y chofer;
2. inicia la ruta;
3. resuelve la corrida activa del chofer;
4. inserta tres muestras `browser_geolocation` asociadas a esa corrida;
5. verifica el rastro persistido;
6. completa la ruta;
7. verifica distancia, cantidad de puntos, límites temporales y agregación municipal.

Comandos:

```text
npm ci
npx supabase start
node tests/gps-route-metrics.test.mjs
npx supabase stop
```

## Prueba manual con teléfono

Requiere staging HTTPS con la migración SW-062 aplicada y la aplicación configurada contra ese
Supabase.

1. Como administrador, crear o escoger una ruta real, un vehículo real y un chofer con cuenta.
2. Asignar vehículo y chofer a la ruta.
3. En el teléfono, iniciar sesión como chofer y abrir **Conductor**.
4. Pulsar **Iniciar recorrido** y permitir ubicación precisa. Ese botón también activa el GPS.
5. Confirmar que aparece `Última posición real enviada` y desplazarse por un trayecto corto.
6. En Operaciones, confirmar el marcador identificado como GPS real.
7. En el teléfono, pulsar **Finalizar recorrido**. La aplicación espera las escrituras pendientes
   antes de cerrar la corrida.
8. Abrir el detalle de la ruta y confirmar:
   - duración marcada como medida;
   - distancia marcada como medida;
   - evidencia GPS con más de un punto;
   - consumo claramente marcado como estimado.
9. Recargar la aplicación y confirmar que los valores continúan presentes.
10. Abrir **Operaciones → Estadísticas** y confirmar que la corrida se acumula por ruta y chofer.

## Criterio de aprobación

La prueba solo se considera aprobada cuando la prueba de integración está verde y una prueba móvil
en staging confirma persistencia después de recargar. Código, mocks o datos `source='simulator'`
por sí solos no constituyen evidencia real.

## Limitaciones vigentes

- La actualización del mapa usa polling; Supabase Realtime continúa fuera de la ruta crítica.
- `distance_meters` es distancia GPS calculada entre muestras, no odómetro certificado.
- El consumo se estima a partir de distancia y eficiencia configurable; no es combustible medido.
- Las posiciones históricas anteriores a SW-062 no tienen `route_run_id` y no se atribuyen
  retroactivamente sin una revisión de datos.

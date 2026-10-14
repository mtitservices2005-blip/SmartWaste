# SW-080: Plataforma de flotilla (5 camiones) — posiciones, centro de control, métricas y reportes semanales

> Especificación maestra (SDD) · una sola corrida de implementación · Estado: APROBADA por Miguel el 2026-10-13 (ver nota de aprobación)
> Fecha: 2026-10-12 · Autor: Claude (Cowork) con Miguel (MT IT Services) · Ayuntamiento: Laguna Salada
> **Aprobación (2026-10-13):** Miguel aprueba la especificación completa con las decisiones por defecto de la sección 8, con UN cambio: la retención del GPS crudo pasa de 90 a **180 días**, configurable (no un número fijo en el código). Combustible sigue opcional. Los resúmenes diarios y semanales se conservan siempre. Hermes no participa; Claude es el único ejecutor. Commits locales autorizados dentro de cada sub-hito; push, PR, merge, despliegue y paso al siguiente sub-hito requieren autorización específica.
> Convención del repo: cada sub-hito SW-08x va en su propia rama y PR (CLAUDE.md regla 2). Nada se commitea ni se hace merge sin autorización de Miguel (reglas 3 y 10).

## 1. Contexto

El ayuntamiento recibe hoy un segundo camión compactador y proyecta una flotilla de unos 5 camiones recogiendo en simultáneo, una zona fija por camión. Hoy SmartWaste funciona con 1 camión, 1 chofer y 1 ruta reales guardados en Supabase. La meta es una plataforma completa, desde la posición GPS hasta el reporte semanal, que se pueda operar con 5 camiones sin rehacer nada.

**Decisiones ya tomadas por Miguel**
- Prioridad del centro de control: ver todos los camiones en vivo.
- GPS: teléfono Android del chofer con la app nativa (Capacitor, rama `feature/sw074-driver-app`). El navegador queda solo para el centro de control y la administración.
- Operación: una zona fija por camión (5 rutas permanentes), con reasignación manual si un camión se daña.
- Una sola corrida: todo se analiza y se aprueba antes; luego se ejecuta paso a paso sin rediseñar en el camino.

## 2. Hallazgos de la auditoría (estado real al 2026-10-12)

| # | Hallazgo | Evidencia | Consecuencia para 5 camiones |
|---|---|---|---|
| H1 | El mapa lee posiciones por polling con consultas a `vehicle_positions` ordenadas por fecha, sin una vista de "última posición por camión". | `shared/operations-adapter.js` (`listPositions`, `listLatestPositions`) | Con 5 camiones y 1 punto cada 10 s la consulta crece sin control. Hace falta una consulta única y barata. |
| H2 | Supabase Realtime no entrega eventos de forma confiable (fallo no determinístico). | `docs/TECHNICAL_DEBT_REGISTER.md` #14 | Realtime no puede ser la vía principal. Polling corto es la base. Realtime queda como mejora opcional. |
| H3 | Existe app Android con servicio en primer plano, cola persistente sin señal y muestreo de 10 s o 25 m. | Rama `feature/sw074-driver-app`: `shared/driver-app-telemetry.js`, `driver-app-background.js`, `mobile/` (PR #92, sin mergear) | Base sólida. Falta envío por lotes, latido (heartbeat), batería, APK firmado y variables de Supabase en el build. |
| H4 | `vehicle_positions` guarda `route_run_id`, `source`, `device_id`. Índices por vehículo y por corrida. Sin batería, sin estado derivado, sin retención. | Migraciones `sw007`, `sw013`, `sw062` | Verificado: el CHECK `vehicle_positions_source_check` (migración `sw013`) ya acepta `driver_app`; no hace falta migrar eso. |
| H5 | Métricas por corrida existen (duración, distancia GPS, puntos GPS) y agregados por ruta/chofer. No hay agregados por camión ni por semana, ni comparación semana contra semana, ni reporte. | `shared/route-run-stats.js`, `shared/impact-center.js`; búsqueda de "semanal/weekly" sin resultados en código | Todo el bloque de reportes semanales es nuevo. |
| H6 | El consumo de combustible es una estimación con eficiencia fija (4.8 km/L, precio 76). No hay combustible real medido. | `shared/cost-parameters.js` | Para decisiones de mejora hace falta capturar litros reales cargados y calcular km/L real por camión. |
| H7 | `frontend/app.js` es un monolito de 2.838 líneas con HTML en cadenas de texto; `styles.css` pesa 13 KB. Sin sistema de diseño. Textos demo fijos ("Datos demo · no producción · Municipio piloto: Laguna Salada") aunque haya backend real. Campos del asistente sin etiquetas visibles. | `frontend/app.js`, `frontend/styles.css`, capturas del 2026-10-11 | El rediseño debe hacerse con tokens y vistas nuevas en módulos, no creciendo `app.js`. |
| H8 | Seguridad: RLS por municipio con pruebas adversariales (CI con Supabase local). Registro público habilitado en Auth. Sin copias de seguridad en el plan gratuito. Dos usuarios/municipios viejos pueden seguir en la base. | `tests/rls-*.test.mjs`; sesión de limpieza del 2026-10-11 | Antes de operar con datos reales: cerrar el registro público, tener respaldo y verificar aislamiento entre municipios. |
| H9 | OSRM y Overpass públicos (sin SLA) se usan al crear rutas. | Deuda #18 y #22 | Aceptable para 5 rutas permanentes (se crean una vez). Se documenta el riesgo. |
| H10 | Pruebas: 44 archivos en `tests/`. 7 de integración necesitan Docker/Supabase y no corren en el entorno de Claude. | Sesión actual | Las pruebas de integración nuevas se ejecutan en CI y en la PC de Miguel. |

## 3. Alcance de la plataforma

**Incluye**
- Ingesta de posiciones desde la app Android, robusta y con lotes.
- Estado en vivo de cada camión, alertas y centro de control con mapa de flotilla.
- Captura de combustible real y cierre de corrida con datos.
- Métricas por viaje, camión, chofer y ruta; agregados diarios y semanales; comparación semana contra semana.
- Reporte semanal imprimible/descargable en PDF para el alcalde.
- Sistema de diseño y rediseño de las pantallas del centro de control, la app del chofer y los reportes.
- Pruebas de carga con 5 camiones simulados, prueba de campo con APK real, endurecimiento de seguridad y plan de despliegue/rollback.

**No incluye (versión posterior)**
- Rastreadores GPS dedicados, app iOS, envío automático del reporte por correo/WhatsApp, optimización dinámica de rutas aplicada en vivo, catastro real, integración con el chatbot municipal.
- Reescritura de `app.js` con otro framework.

## 4. Arquitectura objetivo

```
Teléfono Android (app Capacitor, servicio en primer plano)
  └─ cola persistente (ya existe) → envío por LOTES cada 10-15 s
        └─ Supabase: RPC ingest_positions(batch)  [idempotente]
              ├─ vehicle_positions (historial, retención configurable, 180 días por defecto)
              └─ vehicle_live_state (1 fila por camión: última posición, estado, batería)
Centro de control (web)
  └─ polling cada 5 s a RPC fleet_overview()  (1 consulta, 1 fila por camión)
  └─ (opcional) Realtime como acelerador; nunca la única vía
Métricas
  └─ vistas/funciones SQL: daily_vehicle_stats, weekly_fleet_report(week)
  └─ pantalla "Reportes" + exportación a PDF (hoja de impresión)
```

**Estados derivados de un camión** (calculados en SQL, reglas explícitas):
- `en_ruta`: corrida activa y última posición con menos de 90 s.
- `detenido`: corrida activa, velocidad menor a 1 m/s durante más de 5 minutos.
- `sin_senal`: corrida activa y última posición con más de 90 s de antigüedad.
- `disponible`: sin corrida activa, asignado.
- `fuera_servicio`: marcado manualmente.

## 5. Sub-hitos (orden de ejecución fijo)

Cada uno es una rama y PR propios. El orden respeta dependencias; no se reordena durante la corrida.

### SW-081 — Datos y backend de flotilla
**Alcance:** migraciones nuevas (no se editan las existentes).
- Columnas nuevas en `vehicle_positions`: `battery_pct` (smallint, nullable).
- Tabla `vehicle_live_state` (municipality_id, vehicle_id PK, route_run_id, lat, lon, speed, heading, battery_pct, captured_at, status, updated_at) con RLS por municipio.
- RPC `ingest_positions(batch jsonb)`: valida pertenencia (chofer asignado al vehículo, corrida coincide), inserta con `on conflict do nothing` sobre (device_id, vehicle_id, captured_at) y actualiza `vehicle_live_state` solo si la posición es más nueva. Rechaza lotes de más de 200 puntos.
- RPC `fleet_overview()`: devuelve una fila por camión del municipio del usuario, con estado derivado (sección 4), ruta, chofer y progreso.
- Tabla `fleet_alerts` (tipo: sin_senal, detenido_largo, bateria_baja, ruta_retrasada; estado abierta/atendida; vehículo; corrida; fechas) + función que las abre y cierra de forma idempotente.
- Tabla `fuel_logs` (municipality_id, vehicle_id, route_run_id nullable, liters, odometer_km nullable, logged_at, logged_by).
- Retención: función `purge_old_positions(days)` con el valor por defecto leído de configuración (180 días por defecto, no fijo en el código) programada con `pg_cron` si el plan lo permite; si no, procedimiento manual documentado.

**Criterios de aceptación**
- [ ] CA-081-1: `ingest_positions` con el mismo lote enviado dos veces no duplica filas.
- [ ] CA-081-2: un chofer no puede insertar posiciones de un vehículo no asignado ni de otro municipio (prueba adversarial).
- [ ] CA-081-3: `fleet_overview()` devuelve 5 filas para 5 camiones en menos de 100 ms con 500.000 posiciones históricas cargadas (prueba de rendimiento).
- [ ] CA-081-4: dos municipios de prueba no ven filas del otro en ninguna tabla ni RPC nuevas.
- [ ] CA-081-5: `tests/rls-coverage.test.mjs` sigue en verde (ninguna tabla con RLS sin políticas).

**Archivos:** `supabase/migrations/2026101200xx_sw081_*.sql`, `tests/fleet-*.test.mjs` (nuevos), `shared/operations-adapter.js` (métodos `fleetOverview`, `ingestPositions`, `logFuel`).

### SW-082 — Sistema de diseño (tokens y componentes base)
**Alcance:** se hace antes de las pantallas nuevas para que todo nazca con el mismo lenguaje.
- Tokens en `frontend/styles/tokens.css`: paleta con contraste AA verificado (verde institucional existente como color primario, ámbar y rojo para alertas, grises neutros), tipografía, espaciado, radios, sombras, estados de camión con color + icono + texto (no solo color).
- Componentes: botón (primario, secundario, peligro), tarjeta de estado, insignia de estado, tabla, formulario con etiqueta visible y ayuda, aviso (toast), estado vacío, esqueleto de carga.
- Guía de textos (español dominicano claro, verbos de acción, sin jerga técnica): todos los campos del asistente con etiqueta visible; mensajes de error que dicen qué hacer.
- Quitar los textos demo fijos cuando hay backend real conectado (se conservan en modo demo, regla 7).
- Modo de alto contraste para uso a la intemperie en la app del chofer.

**Criterios de aceptación**
- [ ] CA-082-1: contraste de texto normal mínimo 4.5:1 y de texto grande 3:1 en todos los componentes (verificado con script de contraste).
- [ ] CA-082-2: objetivos táctiles de al menos 48 px en la vista del chofer.
- [ ] CA-082-3: ningún campo de formulario depende solo de un placeholder.
- [ ] CA-082-4: con backend real, el texto "Datos demo · no producción" no aparece; en modo demo, sí.

**Archivos:** `frontend/styles/*.css`, `frontend/components/*.js` (módulos nuevos pequeños), ajustes mínimos en `frontend/index.html` y `app.js`. Skills de apoyo: `design:design-system`, `design:ux-copy`, `design:accessibility-review`.

### SW-083 — App del chofer (Android) lista para flotilla
**Alcance:** se parte de `feature/sw074-driver-app` (PR #92) tras su revisión y merge.
- Envío por lotes con `ingest_positions` cada 10-15 s y reintento con espera exponencial; la cola persistente existente se conserva.
- Latido cada 30 s aunque no haya movimiento (para distinguir "detenido" de "sin señal").
- Lectura de batería e incorporación a cada lote.
- Pantalla del chofer rediseñada: un solo botón primario por estado (Iniciar recorrido / Finalizar), estado de GPS y de conexión visibles, contador de paradas, registro de combustible al finalizar (litros, opcional pero recomendado).
- Inicio de sesión por chofer (cuenta ya creada desde Flotilla), sesión persistente, cierre remoto no requerido en esta versión.
- Build firmado (APK de lanzamiento) con `SUPABASE_URL` y `SUPABASE_ANON_KEY` inyectadas en el build (hoy faltan, ver PR #92). Distribución por APK directo y guía de instalación en `docs/DRIVER_APP_INSTALL.md`.
- Prueba de que la clave `service_role` no entra al paquete (ya existe, se mantiene).

**Criterios de aceptación**
- [ ] CA-083-1: sin señal 10 minutos, al reconectar se suben todos los puntos pendientes en orden y sin duplicados.
- [ ] CA-083-2: con la pantalla apagada y la app en segundo plano, el teléfono reporta durante 60 minutos continuos (prueba de campo, sección 7).
- [ ] CA-083-3: el estado "sin señal" del centro de control aparece a los 90 s de cortar los datos del teléfono y desaparece al reconectar.
- [ ] CA-083-4: el registro de combustible queda asociado a la corrida y al vehículo correctos.

**Archivos:** `shared/driver-app-telemetry.js`, `shared/driver-app-background.js`, `mobile/**`, `frontend/` (vista Conductor), `.github/workflows/android-test-apk.yml` (APK de lanzamiento).

### SW-084 — Centro de control de flotilla
**Alcance:** nueva vista como módulo propio (`frontend/views/control-center.js`), sin crecer `app.js`.
- Mapa a pantalla completa con los camiones: icono con número, color por estado, estela de los últimos 10 minutos y la ruta asignada en trazo tenue.
- Panel izquierdo con la lista de camiones (estado, chofer, ruta, progreso, última señal, batería), ordenada por prioridad: sin señal, detenido, en ruta, disponible.
- Panel de alertas abiertas con botón "Atendida".
- Detalle de camión (al hacer clic): corrida actual, distancia recorrida, tiempo, paradas, historial de hoy.
- Polling de `fleet_overview()` cada 5 s, con pausa si la pestaña está oculta y marca visible de "datos de hace X segundos". Si falla 3 veces seguidas: aviso claro y reintento.
- Control manual: marcar camión fuera de servicio y reasignar chofer o camión a una ruta.
- Mapa de respaldo si el proveedor de mosaicos falla (lista y coordenadas ya existen como fallback).

**Criterios de aceptación**
- [ ] CA-084-1: con 5 camiones simulados, el mapa se actualiza con menos de 10 s de retraso en el 95 % de las actualizaciones (prueba de carga).
- [ ] CA-084-2: un camión sin reportar 90 s pasa a "sin señal" y genera una alerta única (no repetida).
- [ ] CA-084-3: la pantalla es usable en 1366×768 y en pantalla completa de 1920×1080.
- [ ] CA-084-4: el usuario con rol chofer no puede abrir el centro de control (gating por rol existente).
- [ ] CA-084-5: no hay errores de consola tras 30 minutos abierta.

### SW-085 — Métricas y reportes semanales
**Alcance**
- Vista SQL `daily_vehicle_stats` (por camión y día: corridas, km GPS, horas en ruta, horas detenido, paradas completadas, litros, km/L real) y función `weekly_fleet_report(week_start date)` con totales por camión, chofer y ruta, más la variación contra la semana anterior.
- Cálculo de **combustible**: litros reales cuando existen `fuel_logs`; si no, estimación marcada como "estimado" (se conserva el modelo actual).
- Impacto ambiental y ahorro usando los parámetros ya existentes (`cost-parameters.js`), con la distinción real/estimado visible.
- Pantalla "Reportes": selector de semana, tarjetas de resumen, tabla por camión y por chofer, gráfico de tendencia de 8 semanas (km, litros, km/L, paradas), indicadores de mejora o empeoramiento con flecha y color + texto.
- Exportación a PDF mediante hoja de estilos de impresión (sin servidor), con encabezado del municipio, periodo y la nota de qué datos son estimados.
- Skill de apoyo para gráficos: `dataviz`.

**Criterios de aceptación**
- [ ] CA-085-1: el total de km de la semana coincide con la suma de `distance_meters` de las corridas de la semana (prueba con datos conocidos).
- [ ] CA-085-2: la comparación semana contra semana devuelve variación porcentual y maneja semana anterior vacía sin errores ni divisiones por cero.
- [ ] CA-085-3: todo valor estimado se rotula "estimado" en pantalla y en el PDF.
- [ ] CA-085-4: el PDF de una semana con 5 camiones cabe en 2 páginas A4 y es legible en blanco y negro.
- [ ] CA-085-5: ningún reporte mezcla datos de otro municipio (prueba adversarial).

### SW-086 — Pruebas de carga y de campo
- **Carga:** script que simula 5 camiones reportando durante 60 minutos contra Supabase local/staging, con pérdida de señal aleatoria. Mide retraso extremo a extremo, filas por hora y tiempo de `fleet_overview()`.
- **Campo:** checklist en `docs/GPS_FIELD_TEST.md` con 2 teléfonos Android reales durante una ruta de 60 minutos (pantalla apagada, app en segundo plano, cambio de red, batería ahorro).
- **Humo (smoke) de punta a punta:** crear ayuntamiento, vehículos, choferes, rutas, asignar, correr, cerrar, ver reporte.

**Criterios de aceptación**
- [ ] CA-086-1: sin pérdida de puntos en la prueba de carga más allá de los desconectados a propósito.
- [ ] CA-086-2: el teléfono Android real reporta durante 60 minutos con pantalla apagada (o el hallazgo queda documentado con la configuración de batería necesaria).
- [ ] CA-086-3: el humo de punta a punta pasa dos veces seguidas sin intervención manual de base de datos.

### SW-087 — Seguridad, respaldo y despliegue
- Cerrar el registro público en Supabase Auth.
- Confirmar que el municipio "Presentación" y sus usuarios viejos fueron eliminados.
- Respaldo: pasar a un plan con copias automáticas **antes** de operar con datos reales o, como mínimo, un volcado programado semanal con restauración probada.
- Pruebas adversariales con dos municipios para todo lo nuevo (RPC, vistas, reportes).
- Revisar que el APK y `dist/` no contengan `service_role` (pruebas existentes).
- Procedimiento de despliegue y rollback documentados: etiqueta previa, promoción en Vercel, plan para revertir migraciones (solo aditivas).
- Documentación de operación para el ayuntamiento: instalación de la app, uso diario, qué hacer si un camión sale "sin señal".

**Criterios de aceptación**
- [ ] CA-087-1: `signup` público desactivado y verificado intentando registrarse.
- [ ] CA-087-2: existe respaldo restaurable y se probó restaurarlo.
- [ ] CA-087-3: lista `docs/GO_NO_GO.md` actualizada con todos los puntos en verde antes de la entrega.

## 6. Protocolo de ejecución en una sola corrida

1. **Aprobación única:** Miguel aprueba esta especificación completa (con las decisiones por defecto de la sección 8).
2. **Plan:** `writing-plans` convierte cada sub-hito en tareas pequeñas con su prueba, en el orden SW-081 → SW-082 → SW-083 → SW-084 → SW-085 → SW-086 → SW-087.
3. **Ejecución:** subagentes por tarea con TDD (prueba que falla primero, luego el código). Cada sub-hito termina con: pruebas en verde, revisión de código, verificación con evidencia.
4. **Compuertas:** al cerrar cada sub-hito se prepara la rama y el PR y se detiene a esperar la autorización de Miguel para commit, push y merge (regla 10). Las verificaciones en staging las hace Miguel o yo con su sesión, nunca con credenciales mías.
5. **Sin rediseño en el camino:** si aparece complejidad oculta, se detiene y se informa; no se cambia el alcance en silencio.

## 7. Riesgos principales

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Android detiene la app en segundo plano (ahorro de batería de ciertos fabricantes) | Media | Alto | Servicio en primer plano ya implementado, instrucción de excluir la app del ahorro de batería, latido y alerta "sin señal", prueba de campo CA-086-2 |
| Realtime no confiable | Alta (conocido) | Medio | Se diseña sobre polling; Realtime solo como acelerador opcional |
| Costo/datos móviles de los choferes | Media | Medio | Lotes comprimidos, intervalo de 10 s o 25 m, estimar consumo de datos en la prueba de campo |
| Plan gratuito de Supabase (sin respaldo, límites) | Alta | Alto | SW-087: plan con respaldo antes de datos reales; medir filas por día (≈ 14.000/día con 5 camiones) |
| Rediseño demasiado grande para una sola corrida | Media | Medio | Tokens y vistas nuevas en módulos; no se reescribe `app.js` |
| OSRM/Overpass públicos sin SLA | Baja | Bajo | Rutas permanentes (se crean una vez), con respaldo ya implementado |
| El PR #92 (app Android) tiene pendientes de revisión | Media | Medio | Se revisa y se cierra antes de SW-083 |

## 8. Decisiones por defecto (Miguel puede cambiarlas antes de aprobar)

1. **Entrega del reporte semanal:** pantalla "Reportes" + descarga a PDF. El envío automático por correo o WhatsApp queda para una versión posterior.
2. **Combustible real:** el chofer registra los litros al terminar la corrida (opcional); si falta, se estima y se marca "estimado".
3. **Distribución de la app:** APK directo (sideload) con guía de instalación. Google Play interno queda para después.
4. **Retención de posiciones:** 180 días de historial crudo, configurable (cambio aprobado el 2026-10-13; antes 90); agregados diarios y semanales sin límite.
5. **Zonas:** 5 rutas permanentes, una por camión, ya creadas por el administrador; la reasignación manual existe en el centro de control.
6. **Base de datos:** subir a un plan con respaldos antes de la operación real con el ayuntamiento.

## 9. Pruebas (transversal)

- Comando base: ejecutar cada `tests/*.test.mjs` con `node`, uno por uno (como en `.github/workflows/tests.yml`).
- Pruebas nuevas esperadas: `fleet-ingest`, `fleet-overview`, `fleet-alerts`, `fuel-logs`, `weekly-report`, `design-contrast`, `control-center-states`, `driver-app-batching`, `fleet-rls-adversarial`, `load-5-trucks` (script).
- Integración (requiere Docker/Supabase): se ejecuta en CI y en la PC de Miguel, no en el entorno de Claude (limitación H10).

## 10. Fuera de la especificación pero registrado

- Panel de onboarding de plataforma para `mt_superadmin` (reutiliza `create-municipality-account`).
- Flujo de recuperación de contraseña propio en `frontend/auth-gate.js`.
- Comparativas avanzadas entre municipios, predicción de llenado de contenedores, rastreadores GPS dedicados.

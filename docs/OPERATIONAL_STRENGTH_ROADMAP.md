# Roadmap de fortaleza operativa — hacia un piloto real con ayuntamiento

> Datos demo · no producción — este documento propone trabajo futuro, no lo ejecuta. Basado en `docs/CURRENT_STATE_AUDIT.md` (2026-07-29/30, SW-020), `docs/TECHNICAL_DEBT_REGISTER.md` y el historial de PRs #45-#50 (2026-08-06).

Fecha: 2026-08-11 (revisado 2026-08-16 tras trabajo en paralelo en Claude Code, ver nota abajo). Rama: `docs/operational-strength-roadmap`.

> **Nota de coordinación (2026-08-16):** este roadmap se escribió el 2026-08-11 y proponía SW-036 a SW-040. Entre esa fecha y esta revisión, trabajo hecho directamente en Claude Code (fuera de esta conversación) ya cerró SW-036 (PR #51/#52) y dejó en curso SW-037 (rama `feature/sw037-ux-cleanup`, PR #54) con un alcance distinto al que aquí se había imaginado para ese número. Esta revisión marca SW-036 como hecho, reconoce el SW-037 real, y renumera lo que sigue pendiente a partir de **SW-038** para no chocar. No se tocó nada de git en esta revisión (Claude Code seguía con el repo abierto al momento de escribir esto) — es edición de contenido únicamente, pendiente de commit/push coordinado.

Secuencia actualizada: **SW-036 (hecho) → SW-037 (en curso, otro equipo/sesión) → SW-038 → SW-039 → SW-040 → SW-041**. Cada uno es una rama y un PR independiente (regla 2 de `CLAUDE.md`); no se mezclan entre sí.

---

## SW-036 — Telemetría en vivo confiable y mapa municipal con posición real — ✅ HECHO

**Estado:** completado y mergeado (PR #51 propuesta, PR #52 implementación; commits `f3ca8cd`, `bdfbc66`). Ver `docs/NEXT_MILESTONE_RECOMMENDATION_SW036.md` para el alcance real tal como se ejecutó — coincide en esencia con lo que se proponía aquí (GPS real en el mapa de Operaciones vía polling, no Realtime; regla de frescura/heartbeat; distinción visual real vs. simulado), con dos correcciones de una revisión de Codex en PR #51 que vale la pena leer ahí: el polling de posición real era trabajo nuevo (no una reutilización directa del loop del conductor), y el login por rol ya estaba `VERIFIED_REAL` desde el 2026-07-30 — solo faltaba verificar el gating de las 4 sub-vistas de Operaciones nuevas.

Se deja esta sección como referencia histórica del roadmap original; el detalle vivo está en el documento SW-036 dedicado, no aquí.

---

## SW-037 — En curso en paralelo (no propuesto por este documento)

**Estado:** rama `feature/sw037-ux-cleanup` activa, PR #54 con hallazgos de Codex ya corregidos (commits `c23afcc`, `fe428a7`, `1891534`, `0f03dab`). Alcance real, por los mensajes de commit y `scripts/seed-empty-municipality.mjs`: limpieza de UX (Impacto en pestañas, rutas colapsadas, detalle enfocado) más un **wizard de configuración inicial para municipio real vacío** — cuando un `municipal_admin` real inicia sesión en un municipio sin vehículos/choferes/rutas sembrados, `bootstrapRealBackend()` (`frontend/app.js`) muestra un wizard de onboarding en vez de datos con forma de demo.

Esto no estaba en el roadmap original bajo este número, pero **sí resuelve por adelantado una parte de lo que aquí se llamaba "datos reales del municipio piloto"** (ver SW-041 abajo, ya recortado para no duplicarlo): la UI para que un municipio arranque desde cero ya existe; lo que sigue pendiente es cargar ahí datos reales aprobados por un ayuntamiento concreto, no la mecánica de onboarding en sí.

---

## SW-038 — Persistencia operativa sin huecos

**Por qué segundo:** son dos ítems de severidad alta ya diagnosticados con causa raíz conocida (`docs/TECHNICAL_DEBT_REGISTER.md` #3 y #4) — no requieren investigación, solo ejecución, y bloquean que un ayuntamiento confíe en los números que ve.

**Alcance:**
1. Agregar columna `progress` a `route_runs` con su migración correspondiente (o, alternativa a decidir con el Project Owner, remover `progress` del contrato del adapter si el modelo real solo necesita `status`) — `shared/operations-adapter.js:157` (`transitionRouteRun`) hoy descarta ese valor en silencio.
2. Resolver la falta de atomicidad entre `202607150002_sw008_rls_draft.sql` y `202607150004_sw014_auth_rls_policies.sql`: combinar en una migración atómica, o documentar y automatizar un mecanismo de despliegue/rollback que garantice que ambas se apliquen juntas o ninguna.
3. Re-ejecutar `tests/operational-cycle.test.mjs` y `tests/rls-adversarial.test.mjs` contra Supabase local tras los cambios, con evidencia.

**Criterios de aceptación:**
- Un `updateProgress(routeId, progress)` real se refleja al leer `route_runs` desde Supabase, verificado con un test que falle sin el fix.
- Simular una interrupción entre `sw008` y `sw014` (o su reemplazo atómico) ya no deja tablas bloqueadas sin política.

---

## SW-039 — Frontend 100% conectado a Supabase real

**Por qué tercero:** SW-034/035 ya conectaron vehículos, conductores y rutas reales al cargar la página. Pero el portal ciudadano y las incidencias son la interfaz que usarán los vecinos del municipio, y hoy siguen `DEMO_ONLY` — sin esto, el piloto no puede recibir reportes ciudadanos reales aunque el backend ya lo soporte (`anon_insert_citizen_report` ya existe y está verificado desde SW-020).

**Alcance:**
1. Conectar `shared/citizen-portal.js` a Supabase para folios/reportes reales (la política RLS anónima ya existe, ver auditoría SW-020 punto 4).
2. Implementar subida real de evidencias (fotos de incidencias) contra storage seguro — hoy no existe ("sin upload real" en la clasificación de componentes).
3. Auditar cada flujo restante de `frontend/app.js` que siga escribiendo solo en `createDemoOperationsAdapter()` en memoria y migrarlo al adapter real donde aplique.

**Criterios de aceptación:**
- Un reporte ciudadano creado desde el navegador (sin sesión) es legible después por `service_role`/staff, con evidencia fotográfica adjunta persistida.
- Ningún flujo crítico del piloto (crear ruta, reportar incidencia, ver progreso) depende exclusivamente del adapter demo.

**Fuera de alcance:** rediseño visual del portal — es conexión de datos, no UX nueva.

---

## SW-040 — Activación en entorno remoto (staging) ✅ Hecho (2026-08-19)

**Por qué cuarto:** todo lo de SW-020/036/038/039 se verifica contra Supabase **local** (Docker en LabPC). Un ayuntamiento no va a entrar a una laptop — hace falta un entorno real accesible por navegador, y esto requiere decisiones de seguridad (regla 8) que no se deben apurar.

**Alcance:**
1. Provisionar un proyecto Supabase remoto (staging), aplicar las migraciones ya verificadas localmente con `supabase db push` revisado (no a ciegas, ver `docs/ACTIVATION_CHECKLIST.md` punto 9).
2. Definir y documentar dónde vive cada credencial: `anon key` es la única que toca el navegador; `service_role` nunca se expone a frontend ni a dispositivos físicos (regla 8) — confirmar esto explícitamente en el PR, no darlo por hecho.
3. Decidir y documentar dónde se despliega `frontend/` (hosting estático) para que sea accesible fuera de una laptop local.
4. Re-ejecutar la suite completa de tests contra staging, no solo local.

**Criterios de aceptación:**
- Un usuario externo al equipo de desarrollo puede abrir la URL de staging, iniciar sesión con un rol real y operar el ciclo completo sin acceso a LabPC.
- Revisión de seguridad explícita antes de considerar esto listo (regla 8) — no es un checkbox automático de este hito, es una condición de cierre.

**Fuera de alcance:** producción final — staging es el paso intermedio antes de decidir con el Project Owner si se pasa a producción.

### Resultado

- Proyecto Supabase remoto dedicado provisionado (`smartwaste-staging`, ref `wcgkmqeuzemhaexzhyrx`, región `us-east-2`), con las 10 migraciones aplicadas vía `supabase db push` tras revisión con `--dry-run` (nunca a ciegas). Edge Function `create-driver-account` redesplegada contra ese proyecto (usa las env vars que Supabase inyecta automáticamente al runtime — sin `service_role` hardcodeado en ningún lado).
- `frontend/` desplegado como sitio estático en Vercel (`https://smartwaste-staging.vercel.app`), con `SUPABASE_URL`/`SUPABASE_ANON_KEY` configuradas como variables de entorno de Vercel (nunca commiteadas) e inyectadas en `dist/index.html` en build time por `scripts/build-frontend-config.mjs` (nuevo). Solo la `anon key` toca el navegador — confirmado, `service_role` solo se usó localmente en la terminal del Project Owner para `scripts/seed-remote.mjs` (nuevo, nunca pegada a este chat/IA por diseño explícito).
- Verificación interactiva end-to-end del Project Owner contra staging real, sin acceso a LabPC: login real (`municipal_admin`), creación de ruta, asignación del vehículo real sembrado, login como `driver` real y activación de "Compartir mi ubicación real" (GPS del navegador), y confirmación visual de la insignia de GPS real en el mapa de Operaciones visto por `municipal_admin` — cumple el criterio de aceptación central de este hito.
- **3 bugs reales encontrados y corregidos durante esta activación** (ninguno visible en local, todos específicos de un deploy hosteado):
  1. `scripts/build-frontend-config.mjs` copiaba `frontend/` a `dist/` pero nunca `shared/` — los imports estáticos `../shared/...` de `app.js`/`auth-gate.js` 404eaban en Vercel y el módulo entero fallaba en silencio (sin login, sin botones, sin ningún error visible al usuario). Corregido copiando `shared/` a `dist/shared/` y reescribiendo los imports copiados a `./shared/`.
  2. `frontend/auth-gate.js` importaba `@supabase/supabase-js` en tiempo de ejecución desde `esm.sh` — cuando ese CDN no era alcanzable desde la red del usuario (bloqueo de firewall corporativo), el login fallaba en silencio, mismo síntoma que el bug anterior. Corregido vendorizando el paquete (`frontend/vendor/supabase-js.mjs`, bundle autocontenido vía esbuild, sin llamadas a CDN en tiempo de ejecución).
  3. No existía ningún botón de "Cerrar sesión" en la interfaz — imposible probar con múltiples roles sin borrar el storage del navegador a mano. Agregado un botón en la barra superior, visible solo con sesión real activa.
- **Brechas aceptadas, documentadas, no bloqueantes para este hito:**
  - `SUPABASE_MUNICIPALITY_ID` no se configuró en Vercel (se perdió la salida de la primera corrida de `seed-remote.mjs`) — el portal ciudadano sigue en modo demo en este deploy de staging. Corregible seteando esa env var y re-desplegando cuando se quiera probar ese flujo específico.
  - La hidratación de datos reales (`bootstrapRealBackend()`) es **aditiva**: mezcla los vehículos/rutas reales con los 5 demo pre-cargados en vez de reemplazarlos (por diseño, para no romper la demo — regla 5), lo que puede confundir a un usuario nuevo que no sepa distinguir un `SW-LS-0X` (demo) de un `SW020-...` (real).
  - **Brecha real de producto encontrada en esta verificación**: no existe ninguna pantalla para asignar un chofer a un vehículo — ese vínculo solo se puede crear escribiendo directamente en `vehicle_assignments` (lo que hizo `seed-remote.mjs`). Ver `docs/TECHNICAL_DEBT_REGISTER.md` #24 y la propuesta de hito siguiente.
- Suite de tests completa no se re-ejecutó contra staging de forma automatizada (punto 4 del alcance) — este sandbox no tiene salida de red hacia el proyecto Supabase remoto ni hacia Vercel; toda la verificación de este punto fue manual e interactiva por el Project Owner, documentada arriba. Automatizar esto (p. ej. una suite de Playwright corrida desde la máquina del Project Owner contra staging) queda como mejora futura, no bloqueante.

---

## SW-041 — Datos reales del municipio piloto (técnico + no técnico)

**Por qué último:** depende de que la plataforma ya sea confiable (SW-036 a SW-040); cargar datos reales y entrenar personas sobre una herramienta que todavía miente en el mapa sería contraproducente.

**Recortado respecto a la versión original de este documento:** SW-037 (en curso, ver arriba) ya construyó el wizard de onboarding para un municipio real vacío (`bootstrapRealBackend()`, `scripts/seed-empty-municipality.mjs`). Este hito ya no necesita construir esa mecánica — solo usarla con datos de un ayuntamiento concreto.

**Alcance (retomando `docs/PILOT_PLAN.md`, pasos 1-2 y 6):**
1. Confirmar con el ayuntamiento: municipio, sectores reales, usuarios de prueba por rol — y correrlos a través del wizard de SW-037 en vez de un seed de desarrollo.
2. Cargar rutas y sectores reales aprobados por el ayuntamiento — evaluar si la estimación de viviendas vía OpenStreetMap/Overpass (deuda #22) es suficientemente precisa para esa zona o si hace falta catastro municipal real, ya identificado como mejora futura confirmada por el Project Owner.
3. Confirmar que el trazado vía OSRM público (deuda #18) se comporta bien en las calles reales del municipio piloto; si no, evaluar servidor propio.
4. Entrenamiento a supervisores y conductores (roadmap, fase Piloto).
5. Definir métricas semanales de cumplimiento (roadmap, fase Piloto) y quién las revisa.
6. Actualizar `docs/PILOT_READINESS.md` y `docs/ACTIVATION_CHECKLIST.md`, que hoy están desactualizados (siguen diciendo "Supabase local: NO" cuando SW-020 ya lo verificó) — corregirlos como parte de este cierre para que reflejen el estado real antes de que el ayuntamiento vea el proyecto.

**Criterios de aceptación:**
- Una jornada operativa simulada con datos reales del municipio (no demo) corre de principio a fin sin intervención del equipo de desarrollo.
- El ayuntamiento tiene al menos un supervisor y un conductor entrenados y capaces de operar sin soporte directo.

---

## SW-042 — Asignación de chofer a vehículo desde la UI ✅ Hecho (2026-08-19)

**Por qué:** encontrado durante la verificación interactiva de SW-040 (ver esa sección) — no existía ninguna pantalla para vincular un chofer a un vehículo; ese vínculo (`vehicle_assignments`) solo podía crearse escribiendo directamente contra Supabase. En operación real esto bloquea a cualquier despachador que no tenga acceso directo a la base de datos.

**Alcance:**
1. `shared/operations-adapter.js`: nuevos métodos `listVehicleAssignments()`/`assignDriverToVehicle()` en ambos adaptadores (demo y real). El real hace dos `update()` (terminar cualquier asignación `assigned` previa por vehículo y por chofer — `vehicle_assignments` no tiene constraint único que lo impida) y luego un `insert()`; el demo deriva la misma forma a partir de `truck.driverId`, que ya existía en los datos demo.
2. `frontend/app.js`: control "Asignar chofer"/"Reasignar chofer" en el panel de detalle del camión (`renderTruckDetail()`), filtrando el selector para ofrecer solo choferes del mismo tipo que el vehículo (reales para un vehículo real, demo para uno demo — un chofer demo no tiene cuenta real que vincular). Mismo patrón dual-write que `assignTruckToRoute()` ya usaba para vehículo↔ruta.
3. Corrección del bug cosmético relacionado (mismo origen, documentado junto con este hito en `docs/TECHNICAL_DEBT_REGISTER.md` #24): `hydrateVehiclesAndDrivers()` hardcodeaba `driverId: null` en cada vehículo real hidratado sin consultar `vehicle_assignments` — ahora lo resuelve con `listVehicleAssignments()`, así que el panel de detalle refleja el chofer real ya vinculado (p. ej. por `seed-remote.mjs`) en vez de mostrar "Sin asignar" incorrectamente.

**Fuera de alcance:** ninguna pantalla nueva de "gestión de flota" agregada — el control vive en el panel de detalle del camión que ya existía. Historial de reasignaciones (quién tuvo cada vehículo y cuándo) no se expone en la UI, solo queda como filas con `status:'reassigned'` en la tabla.

**Criterios de aceptación:**
- Un despachador puede asignar y reasignar un chofer a un vehículo (demo o real) sin tocar Supabase directamente.
- Un vehículo real hidratado desde Supabase muestra su chofer real ya vinculado, si lo tiene.

### Resultado

Verificado con `tests/operations-adapter.test.mjs` (extendido: demo adapter — asignar, reasignar limpia al chofer del vehículo anterior, throw en vehículo inexistente; adaptador real con cliente simulado — `listVehicleAssignments()` y `assignDriverToVehicle()` incluyendo las 2 llamadas de `update()` antes del `insert()`, y el camino de fallback sin cliente) y `node --check` sobre los 2 archivos JS tocados. No requirió ninguna migración nueva — la política RLS `tenant_insert_staff`/`tenant_update_staff` ya cubre `vehicle_assignments` desde `sw014_auth_rls_policies.sql`. Pendiente de verificación interactiva en staging real por el Project Owner (mismo patrón que otros hitos: el sandbox de esta sesión no tiene salida de red hacia Supabase/Vercel).

---

## SW-043 — Selector de ruta en el mapa + seguir al camión ✅ Hecho (2026-08-19)

**Por qué:** dos brechas de UX encontradas al probar SW-042 en staging — el combobox junto al botón "Iniciar" (arriba del mapa de Operaciones) estaba poblado con vehículos pero nunca conectado a nada, y el mapa no seguía al camión cuando se enfocaba una sola ruta (se reajustaba a los límites estáticos del trazo completo en cada redibujo).

**Resultado:** el combobox se repropuso como selector de rutas — elegir una llama a `selectRoute()`, mismo efecto que clickear su fila/trazo, con sincronización en ambas direcciones. `drawMapLayers()` solo hace `fitBounds()` una vez al enfocar una ruta por primera vez; en cada redibujo posterior (incluido el polling de GPS real) hace `panTo()` a la posición actual del camión, manteniéndolo centrado. Sin migración — solo `frontend/app.js`. PR #60, verificado interactivamente en staging por el Project Owner.

---

## SW-044 — "Iniciar ruta" + duración real medida ✅ Hecho (2026-08-19)

**Por qué:** al revisar el ciclo operativo completo tras SW-042/043, se confirmó un hueco real — nada en la interfaz llamaba nunca a `startRoute()` (existía en ambos adaptadores desde antes, sin conectar). Una ruta pasaba directo de "asignada" a "completada" sin ningún momento de arranque capturado, así que su duración solo se podía **estimar** por fórmula (`shared/impact-center.js`, pestaña "Uso"), nunca medir de verdad. Sin un timestamp real de inicio tampoco tenía sentido construir nada de duración medida ni histórico entre corridas.

**Alcance:**
1. Migración: `route_runs.started_at`/`completed_at` (`supabase/migrations/202607150012_sw044_route_run_timing.sql`) — sin backfill inventado para filas previas a la migración (quedan `null`, tratadas como "no medido", nunca se les asigna un timestamp falso).
2. `shared/operations-adapter.js`: `transitionRouteRun()` (real) y `transitionRoute()`/`updateRoute()` (demo) sellan `started_at`/`completed_at` la primera vez que se alcanza ese estado — idempotente, nunca pisa un timestamp ya existente.
3. Botón "Iniciar ruta" en el detalle de ruta (admin/dispatcher) y "Iniciar recorrido" en la vista Conductor (el propio chofer) — ambos disparan la misma `startRouteManually()`, mismo patrón dual-write (local + espejo a Supabase) que el resto de las transiciones de ruta. Solo visible con vehículo asignado y antes de haber arrancado (`ROUTE_TRANSITIONS` en `shared/contracts.js` solo permite `assigned→started`).
4. Duración medida vs. estimada en el detalle de ruta: cuando existen ambos timestamps, muestra `completed_at - started_at` marcado "medido"; si no, cae a la estimación por fórmula existente marcada "estimado" — mismo criterio de "nunca inventar un dato real" que la insignia GPS real/simulado del mapa (SW-036).
5. Histórico entre corridas: para una ruta real, al abrir su detalle se calcula de forma asíncrona (vía `listRouteRuns()`, ya existente) cuántas corridas completadas tienen duración medida, con su promedio y la última — sin tabla nueva, `route_runs` ya modela una fila por corrida.
6. Bug preexistente corregido en el camino, necesario para que esto funcione tras un reload: `hydrateRoutes()` tomaba `status` de `routes` (que solo avanza una vez, de "planned" a "assigned", y nunca más) en vez de `route_runs.status` (el que sí refleja started/in_progress/completed/verified) — una ruta real recargada quedaba mostrando "Asignada" para siempre, lo que además habría escondido el botón "Iniciar ruta" detrás de la condición equivocada.

**Fuera de alcance (confirmado explícitamente con el Project Owner):** tiempo promedio entre paradas medido (requiere correlacionar GPS real con cada parada individual — más ambicioso, evaluado como posible extensión futura de este mismo hito). Calendario de rutas (confirmado que no hace falta por ahora — cada ruta es la misma corrida semanal salvo excepción).

### Resultado

Verificado con `tests/operational-cycle.test.mjs` (extendido: `started_at`/`completed_at` deben persistir y `completed_at >= started_at`, contra Supabase local real — no ejecutable en este sandbox sin Docker, mismo límite de siempre) y `tests/operations-adapter.test.mjs` (extendido: demo adapter estampa y no pisa los timestamps; adaptador real con cliente simulado cubre `transitionRouteRun()` estampando en `started`/`completed` y NO estampando cuando el timestamp ya existe). `node --check` sobre los archivos JS tocados y verificación del pipeline de build de Vercel (grafo de imports). Verificación visual en navegador pendiente del Project Owner en staging — este sandbox no tiene salida de red hacia el CDN de Leaflet.

### Revisión tras pruebas en staging (mismo día)

La verificación interactiva del Project Owner en staging confirmó los pasos básicos ("Iniciar ruta" → "Marcar como completada" → duración medida), pero encontró dos ajustes reales:

1. **Decisión de producto confirmada:** el flujo principal debe ser 100% del chofer — "Iniciar recorrido" arranca la ruta **y** prende el GPS real en un solo toque; "Finalizar recorrido" la completa **y** apaga el GPS. Admin/dispatcher conservan sus propios botones (`renderRouteDetail()`) como respaldo para una emergencia (chofer sin señal, celular sin batería), pero esos nunca tocan el GPS de otra persona — atributos `[data-driver-start-route]`/`[data-driver-complete-route]` separados de los `[data-start-route]`/`[data-complete-route]` de admin, cada uno con su propio handler (`driverStartRoute()`/`driverCompleteRoute()` vs. `startRouteManually()`/`completeRouteManually()` directamente).
2. **Bug real encontrado:** la fila "Duración" mostraba "medido" (dato local optimista) mientras el histórico de corridas debajo mostraba "todavía no hay corridas medidas" al mismo tiempo — condición de carrera entre la consulta del histórico (disparada apenas se abre el detalle) y la escritura real de `completed_at` en Supabase, que todavía no había terminado. Corregido repitiendo la consulta del histórico después de que la escritura real se confirma.

### Cierre — verificación interactiva completa en staging (2026-08-19)

La sesión de verificación en staging terminó destapando una cadena larga de bugs reales preexistentes (ninguno introducido por este hito, todos expuestos por ser la primera vez que se ejercitaba el ciclo completo con un vehículo real, reasignado varias veces, en un navegador real) — todos documentados con su hallazgo/causa/fix en `docs/TECHNICAL_DEBT_REGISTER.md` ítems **#27 a #31**:

- #27: un vehículo quedaba "ocupado" para siempre después de su primera ruta (`truck.routeId` nunca se liberaba).
- #28: `assignTruckToRoute()` explotaba en silencio para una ruta real hidratada tras un reload ("Asignar vehículo" no hacía nada, sin error visible).
- #29: `hydrateRoutes()` le asignaba a un vehículo la primera ruta con la que se cruzaba en vez de la más reciente (una ruta vieja completada "ganaba" para siempre sobre una nueva).
- #30: la Edge Function `create-driver-account` nunca manejó CORS — nunca se había invocado desde un navegador real en un dominio propio.
- #31: la mezcla demo+real dificultaba probar — se agregó `SUPABASE_HIDE_DEMO` (opt-in por despliegue, no cambia el comportamiento por defecto), lo que a su vez destapó dos crashes de módulo completo por asumir que `trucks`/`routes` nunca están vacíos (`trucks[0].id` sin verificar, y `driverVehicleId` nunca se sincronizaba con el primer vehículo real cuando arrancaba en `null`).

**Resultado final verificado en staging por el Project Owner:** ciclo completo funcionando de punta a punta — crear ruta → asignar vehículo real → reasignar sin quedar "atascado" → el chofer inicia el recorrido (arranca la ruta y el GPS real en un solo toque) → se mueve en el mapa con seguimiento en vivo → finaliza (cierra la ruta y apaga el GPS) → duración real medida visible en el detalle, con histórico entre corridas. Con `SUPABASE_HIDE_DEMO=true`, un municipio real ya no muestra ningún dato demo, sin importar cuántos datos reales acumule.

SW-044 queda cerrado. Pendiente de que el Project Owner mergee el PR #61 (varios commits, todos en la misma rama `feature/sw044-route-start-duration` — se mantuvieron juntos porque cada fix era un prerrequisito directo para poder seguir verificando el mismo hito, no hitos separados).

---

## SW-045 — Distancia real medida + consumo de combustible estimado ✅ Hecho (2026-08-19)

**Por qué:** con SW-044 ya midiendo duración real, la distancia de una ruta seguía siendo siempre el trazo dibujado al crearla (estimado), nunca lo que el vehículo recorrió de verdad — y sin distancia real, cualquier estimación de consumo de combustible tampoco podía apoyarse en un dato medido.

**Alcance:**
1. Migración: `route_runs.distance_meters` (numeric, nullable), sin backfill inventado — mismo criterio que `started_at`/`completed_at` en SW-044.
2. `shared/operations-adapter.js`: `transitionRouteRun()`, al completar una corrida con `vehicle_id` y `started_at` presentes, suma la distancia real recorrida (`haversineMeters`, ya existente en `shared/route-engine.js`) entre las posiciones GPS reales registradas desde que arrancó (`vehicle_positions`, filtrando `source != 'simulator'`). Nunca inventa un valor: con menos de 2 posiciones (sin GPS activo durante la corrida), `distance_meters` queda sin sellar y la ruta cae a la distancia estimada del trazo, igual que siempre. Best-effort — cualquier error en esta consulta nunca bloquea la finalización de la ruta en sí.
3. `frontend/app.js`: fila "Distancia" en el detalle de ruta, mismo criterio medido/estimado que "Duración". Fila nueva "Consumo estimado" (siempre estimado — nada mide combustible realmente cargado), calculado como distancia (real si existe, estimada si no) ÷ rendimiento configurable en "Impacto y Ahorros → Economía" (reutiliza el supuesto existente, no uno nuevo y desconectado).
4. Histórico entre corridas (ya existía para duración desde SW-044): extendido para mostrar también cuántas corridas tienen distancia real medida, su promedio y la última.

**Fuera de alcance (confirmado con el Project Owner):** consumo medido de verdad (requeriría capturar cargas de combustible manualmente — más trabajo de captura en campo, evaluado y descartado por ahora a favor de la estimación por fórmula).

### Resultado

Verificado con `tests/operational-cycle.test.mjs` (extendido: sin ingesta de GPS en ese escenario, `distance_meters` debe quedar `null`, nunca inventado — no ejecutable en este sandbox sin Docker) y `tests/operations-adapter.test.mjs` (extendido, cliente simulado: distancia se computa y sella con ≥2 posiciones reales, no se sella con menos de 2, se salta la consulta por completo si no hay `vehicle_id` en la corrida). `node --check` sobre los archivos tocados y verificación del grafo de imports del build de Vercel. Verificación interactiva en staging confirmada por el Project Owner.

---

## SW-046 — Ícono de camión real en el mapa (no propuesto por este documento)

**Estado:** ✅ Hecho (2026-08-20), mergeado. Reemplaza el marcador circular/genérico de cada camión en el mapa de Operaciones por una silueta de camión (SVG inline, `fill="currentColor"`), coloreada según el estado del vehículo, sin caja/fondo alrededor (ajuste pedido explícitamente por el Project Owner tras ver la primera versión con caja). No estaba en este roadmap — surgió de un pedido directo del Project Owner recordando una solicitud visual pendiente de una sesión anterior.

---

## SW-047 — Dashboard de eficiencia por ruta y por chofer ✅ Hecho (2026-08-20)

**Por qué:** con duración y distancia real ya medidas por corrida desde SW-044/045, esos datos solo se veían uno por uno en el detalle de cada ruta ("histórico entre corridas"). No había forma de comparar rutas entre sí a lo largo del tiempo, ni ver el rendimiento agregado de un chofer.

**Alcance:**
1. `shared/route-run-stats.js` (nuevo, puro, sin red/DOM): `summarizeRouteRunsByRoute()`/`summarizeRouteRunsByDriver()` agregan `route_runs` medidos (con `started_at`/`completed_at`) en promedio/última duración y distancia, agrupando por `route_id`/`driver_id`. Generaliza la misma matemática que `refreshRouteDurationHistory()` (SW-044) ya usaba para una sola ruta, sin tocar esa función.
2. `frontend/app.js`: nueva pestaña "Estadísticas" en Operaciones (`OPS_VIEWS`), con dos listas — por ruta y por chofer — pobladas de forma asíncrona (`refreshEfficiencyDashboard()`) al abrir la pestaña, vía `realAdapter.listRouteRuns()` y join contra los arrays locales `routes`/`drivers` (por `real_id`) para mostrar nombres. Requiere backend real conectado (la demo no persiste `route_runs`) — mismo criterio que el histórico por ruta; sin backend real muestra un aviso en vez de datos vacíos/engañosos.

**Fuera de alcance:** ningún cambio de esquema (toda la data ya existía en `route_runs` desde SW-044/045); no se persiste ningún agregado — se recalcula en cada apertura de la pestaña.

### Resultado

`tests/route-run-stats.test.mjs` (nuevo, puro, sin red): agrupación correcta por ruta/chofer, corridas sin `completed_at` excluidas, corridas sin `distance_meters` no inventan un promedio, corridas sin `driver_id` excluidas del agrupamiento por chofer, casos vacíos. `node --check` sobre los archivos tocados + suite completa sin regresiones (mismos tests dependientes de Docker de siempre). Verificación interactiva en staging pendiente del Project Owner.

---

## SW-048 — Reingeniería de usabilidad: asignación de ruta y estado de preparación (no propuesto por este documento) ✅ Hecho (2026-08-20)

**Por qué:** el Project Owner reportó que el flujo actual para poner una ruta en marcha "no sigue una lógica" — confirmado con auditoría de código: el camino más directo requiere 3-4 cambios de pestaña (Rutas → Mapa para asignar vehículo → Flota para asignar chofer → Mapa/Rutas o Conductor para iniciar), el chofer se asigna al **vehículo** en una pantalla separada sin ningún link de vuelta a la ruta, y no existe un indicador único de "qué falta" — hay que leer 3 campos sueltos (pastilla de status + 2 campos de texto) para inferirlo. Además se confirmó que el modo de seguimiento en pantalla completa (SW-043) es puramente visual — no arranca ni detiene nada — lo cual causó confusión real durante pruebas de SW-047 (el Project Owner pensó que "ver correr" el camión ahí era lo mismo que iniciar la ruta).

**Alcance (subconjunto A+B+C de las 5 opciones evaluadas; D y E quedaron fuera, ver abajo):**
1. **(A) Asignación de chofer embebida en el detalle de ruta**: `driverAssignmentControl()` (ya existía para el detalle de vehículo en Flota) ahora también se renderiza directamente en `renderRouteDetail()` cuando la ruta tiene un vehículo asignado sin chofer — reutiliza el mismo handler/`select` (`data-assign-driver`, `#assignDriverSelect`), sin wiring nuevo. Elimina el viaje obligatorio a Flota para este paso.
2. **(B) Badge único de preparación**: `shared/route-readiness.js` (nuevo, puro) — `routeReadinessStage(route, truck)` deriva *Falta vehículo* / *Falta chofer* / *Listo para iniciar* solo durante la ventana `planned`/`assigned`; para cualquier otro estado (en curso, completada, etc.) devuelve `null` y el llamador sigue usando la pastilla de status existente sin cambios — no se inventa un badge donde ya no aplica.
3. **(C) Link cruzado ruta → vehículo**: el campo "Unidad asignada" del detalle de ruta ahora es un botón (`data-truck`) que reutiliza el manejador delegado ya existente para saltar al detalle del camión — el link inverso (vehículo → "Ver ruta completa") ya existía desde antes y no se tocó.
4. **Bug real encontrado durante esta reingeniería**: el campo "Conductor" del detalle de ruta leía `route.driverId`, un campo que nada escribe jamás para una ruta real/creada (solo las 5 rutas demo precargadas lo traen de fábrica) — por eso siempre mostraba "Sin asignar" aunque el vehículo sí tuviera chofer. Corregido para derivar el chofer del vehículo realmente asignado (`assignedTruck?.driverId`), la fuente de verdad real desde SW-042.

**Fuera de alcance (confirmado con el Project Owner):**
- **(D) Aviso en modo pantalla completa** ("esto es solo visualización") — evaluado y descartado, no se ve necesario.
- **(E) Flujo guiado "Poner en marcha"** (wizard de un solo botón que encadene vehículo→chofer→inicio) — anotado como mejora futura opcional bajo una futura pestaña "Configuración", no se construye todavía.

### Resultado

`tests/route-readiness.test.mjs` (nuevo, puro): las 3 etapas de preparación se derivan correctamente, y todo estado post-arranque (`started`/`in_progress`/`delayed`/`completed`/`verified`/`cancelled`) devuelve `null` sin excepción, incluso sin vehículo asignado (caso de una ruta demo). `node --check` sobre los archivos tocados + suite completa sin regresiones (mismos tests dependientes de Docker de siempre). Verificación interactiva en staging pendiente del Project Owner.

---

## SW-049 — Flujo guiado "Poner en marcha" (opción E, opt-in) ✅ Hecho (2026-08-20)

**Por qué:** el Project Owner pidió construir la opción E que SW-048 había dejado como mejora futura — pero como una preferencia opcional del operador, no como el comportamiento por defecto (que sigue siendo el paso a paso de SW-048).

**Alcance:**
1. Nueva pestaña de nivel superior **Configuración** (`#configuracion`), visible para `municipal_admin`/`dispatcher` (mismos roles que ya pueden asignar vehículos/choferes) vía `frontend/auth-gate.js`'s `SECTION_ROLES`. Contiene un solo checkbox: "Activar flujo guiado 'Poner en marcha'".
2. La preferencia (`guidedAssignmentEnabled`) se guarda en `localStorage` del navegador — **no** en Supabase ni en ninguna tabla — porque es una preferencia de operador/equipo, no un dato del municipio. Apagada por defecto: sin tocar Configuración, el comportamiento es idéntico a SW-048.
3. Con la preferencia activa, `renderRouteDetail()` reemplaza los controles paso a paso (asignar vehículo → asignar chofer, por separado) por un solo formulario (`renderGuidedPutInMotion()`) que muestra únicamente los campos que realmente faltan (según `routeReadinessStage()`, SW-048), con un solo botón "Poner en marcha".
4. `putRouteInMotion()` encadena, reutilizando las funciones existentes sin duplicar lógica de transición: `assignVehicleToExistingRoute()` → `assignDriverToTruck()` → `startRouteManually()`, saltando cualquier paso que ya no haga falta (p. ej. si el vehículo ya estaba asignado, arranca directo en el chofer).

**Fuera de alcance:** ningún cambio de esquema — es orquestación del lado del cliente sobre funciones ya existentes.

### Resultado

`tests/auth-gate.test.mjs` extendido: `configuracion` visible para `dispatcher`/`municipal_admin`, no para `supervisor`/`driver`/`mt_superadmin`. `node --check` sobre los archivos tocados + suite completa sin regresiones. La orquestación (`putRouteInMotion`) vive en `frontend/app.js`, sin test unitario directo (mismo límite que el resto de este archivo — no tiene suite propia, solo verificación interactiva) — pendiente de verificación en staging por el Project Owner.

---

## SW-050 — Persistencia real del email de chofer + reenvío de invitación (no propuesto por este documento) ✅ Hecho (2026-08-20)

**Por qué:** encontrado en vivo durante pruebas de staging — el Project Owner creó un chofer con email, pero el botón "Crear cuenta de acceso" nunca apareció. Causa raíz: `drivers` en Supabase nunca tuvo columna `email` — el correo solo vivía en la memoria de la pestaña del navegador que creó el chofer (`createDriverFromForm()`), así que con solo recargar la página (o pasar tiempo y volver) se perdía para siempre, sin ninguna forma de recuperarlo. Además, el enlace de invitación que devuelve `create-driver-account` se muestra una sola vez en pantalla — si no se copiaba ahí mismo, tampoco había forma de regenerarlo sin entrar al panel de Supabase a mano.

**Alcance (confirmado con el Project Owner vía las 2 preguntas de scoping):**
1. **Migración** `supabase/migrations/202607150014_sw050_driver_email.sql`: agrega `drivers.email` (nullable, sin backfill — no hay forma de saber el email de choferes ya creados antes de este hito).
2. `createDriver()` (`frontend/app.js`) ahora reenvía `email` en el insert real (antes solo mandaba `display_name`); `hydrateVehiclesAndDrivers()` lo lee de vuelta (`row.email`) al hidratar — el botón "Crear cuenta de acceso" ya no depende de que la pestaña original siga abierta.
3. **Nueva función** `supabase/functions/resend-driver-invite`: para un chofer que YA tiene cuenta (`profile_id` seteado), le restablece la contraseña.

**Revisión (2026-08-22, tras verificación interactiva en staging):** el enfoque inicial de ambas funciones usaba `auth.admin.generateLink()` (enlaces de invitación/recovery). En staging, esos enlaces fallaban instantáneamente como "invalid or expired" para una cuenta que nunca había completado su invitación original — Supabase rechaza `'recovery'` para una cuenta sin confirmar, y aunque se corrigió a `'invite'`, seguía dependiendo de configuración del lado de Supabase (Site URL, Redirect URLs, formato hash vs. PKCE) fuera del control total de este repo. Se reemplazó por **contraseña temporal directa**, sin ningún enlace de por medio:
- `create-driver-account` ahora crea la cuenta con `email_confirm:true` y una contraseña temporal generada (`crypto.getRandomValues`), devuelta en la respuesta.
- `resend-driver-invite` ahora llama `auth.admin.updateUserById(profile_id, {password})` con una contraseña temporal nueva, en vez de generar un enlace.
- El chofer entra con su email + esa contraseña por el formulario de login normal que ya existe (`frontend/auth-gate.js`) — sin links, sin expiración, sin depender de la configuración de redirect URLs.
- Esto vuelve innecesaria la pantalla de "definir contraseña" propuesta en un hito aparte (ver nota de coordinación): ese hito quedó sin mergear y puede cerrarse sin aplicar, a criterio del Project Owner.

### Resultado

`tests/operations-adapter.test.mjs` (extendido, cliente simulado): `createDriver()` reenvía `email` al insert real sin descartarlo. `node --check` sobre los archivos tocados + suite completa sin regresiones. Las funciones Edge no tienen test unitario en Node — mismo criterio que el resto de funciones Deno de este repo. Verificación interactiva completa en staging (cuenta creada con contraseña temporal, login exitoso con email+contraseña) pendiente del Project Owner tras esta revisión.

---

## SW-052 — Repetir una ruta ya completada (no propuesto por este documento) ✅ Hecho (2026-08-22)

**Por qué:** encontrado en vivo mientras se verificaba la medición de duración/distancia en staging — el Project Owner señaló que en operación real las rutas se repiten 2-3 veces por semana con el mismo camión, y necesita que cada corrida quede guardada por separado para ver tendencias semanales (justo lo que alimenta el dashboard de eficiencia de SW-047). Al intentar reasignar un vehículo a una ruta ya `completed` para repetirla, la UI se quedaba mostrando la ruta como terminada para siempre — sin botón "Iniciar ruta", con la duración/distancia de la corrida vieja pegada en pantalla.

**Causa raíz:** el backend ya soportaba esto correctamente — `findOrCreateActiveRouteRun()` (`shared/operations-adapter.js`) ya abre un `route_run` nuevo en Supabase cuando el último para esa ruta está en un estado terminal (`completed`/`verified`/`cancelled`). El problema estaba solo en `frontend/app.js`: `assignTruckToRoute()` únicamente reseteaba `route.status` desde `'planned'`, nunca desde `'completed'`/`'verified'` — así que aunque el backend ya tenía la corrida nueva lista, la pantalla local seguía mostrando el estado y los tiempos de la corrida anterior.

**Alcance:**
1. `assignTruckToRoute()`: al reasignar un vehículo a una ruta `completed`/`verified`, ahora resetea `route.status` a `'assigned'` y limpia `started_at`/`completed_at`/`real_distance_meters`/`progress` locales — el resto del ciclo (iniciar/finalizar recorrido, medición real) funciona exactamente igual que para una ruta nueva, sin duplicar ninguna lógica de transición.
2. No se tocó `shared/operations-adapter.js` ni ninguna migración — el backend ya estaba listo.

**Fuera de alcance:** `route.covered`/`route.pending` (conteos de paradas) no se resetean — ya eran estáticos y desactualizados desde antes de este hito (limitación preexistente, no introducida ni agravada acá).

### Resultado

`node --check` sobre `frontend/app.js` + suite completa sin regresiones. Esta lógica vive enteramente en `frontend/app.js` (mutación de estado local, no un módulo puro en `shared/`), así que no tiene test unitario en Node — mismo criterio que el resto de la lógica de asignación en este archivo; verificación interactiva en staging pendiente del Project Owner (reasignar el mismo vehículo a una ruta ya completada y confirmar que aparece "Iniciar ruta" de nuevo, con duración/distancia limpias).

---

## SW-053 — Permitir completar una ruta directo desde "started" (no propuesto por este documento) ✅ Hecho (2026-08-23)

**Por qué:** encontrado en vivo verificando Estadísticas (SW-047) en staging — una corrida real (iniciar → GPS real → finalizar) mostraba "Duración: medido" en pantalla, pero en Supabase `route_runs` tenía `started_at` sellado y **`completed_at` en `null`**. La pantalla mentía: `completeRouteManually()` (`frontend/app.js`) sella `route.completed_at` localmente de forma optimista *antes* de confirmar con el servidor, así que un rechazo del backend queda invisible en la UI.

**Causa raíz:** `ROUTE_TRANSITIONS` (`shared/contracts.js`) no permitía `started → completed` directo — solo vía `in_progress`/`delayed` primero. Eso coincidía con la simulación demo (que siempre pasa por `in_progress` al avanzar el tick), pero el flujo real del chofer ("Iniciar recorrido"/"Finalizar recorrido", SW-044) nunca llama a `updateProgress()` — va directo de `started` a intentar `completed`, y `transitionRouteRun()` (`shared/operations-adapter.js`) rechazaba esa transición específica, silenciosamente.

**Alcance:**
1. `shared/contracts.js`: `ROUTE_TRANSITIONS.started` ahora incluye `'completed'` — una ruta corta que termina sin haber sido marcada explícitamente "en progreso" es un caso real legítimo, no un error.
2. No se tocó `shared/operations-adapter.js` ni el frontend — el motor de transición ya validaba correctamente contra `ROUTE_TRANSITIONS`, solo hacía falta corregir la tabla misma.

**Fuera de alcance:** el "falso positivo" de la UI (mostrar "medido" antes de confirmar con el servidor) no se corrigió en este hito — con la transición ahora permitida, el caso real que lo disparó deja de ocurrir, pero el patrón de UI optimista sin rollback ante un rechazo del servidor sigue ahí para cualquier otro fallo futuro. Queda anotado como mejora de robustez pendiente.

### Resultado

`tests/contracts.test.mjs` sin regresiones (no había ninguna aserción que dependiera de que `started->completed` fuera inválido). Suite completa sin regresiones. Verificación interactiva en staging pendiente del Project Owner: repetir el ciclo iniciar→GPS real→finalizar y confirmar que esta vez `route_runs.completed_at` sí queda sellado.

---

## SW-054 — Reorganización visual de Mapa/Rutas/Flotilla (no propuesto por este documento) ✅ Hecho (2026-08-23)

**Por qué:** el Project Owner reportó, tras varias sesiones de uso real, que estas 3 sub-vistas de Operaciones se sentían saturadas y desordenadas — auditoría de código confirmó cada queja puntual antes de tocar nada.

**Alcance (solo reordenar/reestilizar, sin cambios de esquema):**
1. **Mapa** (`renderMapPanel()`): eliminadas las 8 tarjetas KPI (`operationalKpis()`, función borrada por quedar sin otro uso) que se apilaban antes del mapa, duplicando números que ya viven en Resumen. El panel queda: selector de ruta → botón "Iniciar ruta" (nuevo, `mapStartAction()`, solo visible cuando la ruta seleccionada está lista para iniciar — reutiliza el manejador `data-start-route` existente) → mapa.
2. **Rutas** (`renderRutasPanel()`): "+ Nueva ruta" se movió arriba de la lista (antes era lo último del panel, colapsado, después de toda la lista — "muy difícil de encontrar"). El buscador/filtro de sector pasó de la clase `.controls` genérica a una propia `.search-bar`, para no heredar la alineación pensada para formularios. Cada fila de ruta (`renderRoutes()`) ahora lleva un borde izquierdo coloreado según su estado (mismos colores que ya usan los `pill()`), en una lista más compacta (`.list.compact`).
3. **Flota → Flotilla**: renombrada (solo la etiqueta visible — el id interno `flota`/`#operaciones/flota` no cambió, ningún link se rompe). `renderFleetManagement()` quedó solo con los 2 formularios de alta; las listas de vehículos y choferes se movieron a `renderFlotaPanel()`, ambas **debajo** de los formularios y una al lado de la otra (mismo `.panel-grid`, con una variante `.two-col` nueva) — antes la lista de vehículos vivía arriba de todo y la de choferes debajo de su propio formulario, dos criterios distintos en el mismo panel.

**Fuera de alcance:** el concepto de "Equipos" (camión+chofer como una sola unidad para asignar) — evaluado en la misma conversación, pero es un hito aparte porque toca esquema nuevo.

### Resultado

`node --check` sobre `frontend/app.js` + suite completa sin regresiones. Todo el cambio es de renderizado/CSS — ningún dato ni transición de estado se tocó. Verificación interactiva en staging pendiente del Project Owner.

---

## SW-055 — Aviso de confirmación (toast) para acciones que antes eran silenciosas (no propuesto por este documento) ✅ Hecho (2026-08-23)

**Por qué:** patrón repetido durante toda la sesión — acciones que sí funcionaban (completar ruta, iniciar ruta, asignar vehículo/chofer) solo se reflejaban como un re-render silencioso en algún lugar de la pantalla, así que repetidamente parecía que "no pasaba nada" aunque sí había pasado. El disparador puntual: el Project Owner tocó "Marcar como completada" y no notó ningún cambio, aunque el botón sí funcionaba.

**Alcance:**
1. `showToast(message, {type})` (nuevo, `frontend/app.js`): un aviso fijo arriba de la pantalla, auto-descartado a los ~3.2s, con transición de entrada/salida. Una sola instancia reutilizada — un segundo aviso reemplaza al anterior en vez de apilarse.
2. Enganchado en las acciones que más generaron confusión esta sesión: `completeRouteManually()` (incluye explícitamente qué vehículo quedó libre — la conexión "completar ruta → chofer/vehículo disponible" que antes era invisible y generó la confusión de "los choferes no se liberan"), `startRouteManually()`, `assignVehicleToExistingRoute()`, `assignDriverToTruck()`.
3. Aviso de **error** (mismo componente, color distinto) cuando una escritura al servidor falla pero el estado local ya cambió — incluye el caso real encontrado en staging: asignar un chofer que todavía no terminó de sincronizarse con Supabase (`driver.real_id` ausente) antes se guardaba solo local sin avisar nada.

**Fuera de alcance (por ahora, evaluado y diferido):**
- Estado "procesando…" en el botón mismo mientras espera confirmación del servidor.
- Transición de salida al desaparecer un botón que ya no aplica (hoy desaparece de golpe con el re-render).
- No se tocó `createDriverAccount()`/`resendDriverInvite()` — ya muestran la contraseña temporal en un texto inline persistente; un toast de 3s la haría desaparecer antes de que el admin la copie, así que ese patrón queda como está a propósito.

### Resultado

`node --check` sobre `frontend/app.js` + suite completa sin regresiones. Sin test unitario directo — es UI/DOM puro (mismo criterio que el resto de `frontend/app.js`, sin suite propia). Verificación interactiva en staging pendiente del Project Owner.

---

## Resumen de secuencia y dependencias

| Hito | Estado | Depende de | Severidad de lo que resuelve | Esfuerzo relativo |
|---|---|---|---|---|
| SW-036 | ✅ Hecho (PR #51/#52) | SW-020 (ya cerrado) | Alta | Alto (causa no determinística) |
| SW-037 | 🔄 En curso en paralelo (PR #54, `feature/sw037-ux-cleanup`) | SW-020 (ya cerrado) | — (UX + onboarding) | Medio |
| SW-038 | ✅ Hecho (PR #56) | SW-020 (ya cerrado) | Alta | Medio |
| SW-039 | ✅ Hecho (PR #57) | SW-038 | Media | Medio |
| SW-040 | ✅ Hecho (2026-08-19) | SW-036, SW-037, SW-038, SW-039 | — (habilitador) | Medio, con gate de seguridad |
| SW-041 | Propuesto | SW-037 (wizard ya construido), SW-040 | — (no técnico + ajuste de datos) | Bajo técnico, alto en coordinación con el ayuntamiento |
| SW-042 | ✅ Hecho (2026-08-19) | SW-040 | Media — sin esto, un despachador no podía operar sin editar la base de datos a mano | Bajo-medio |
| SW-043 | ✅ Hecho (2026-08-19) | SW-042 | Baja — UX del mapa | Bajo |
| SW-044 | ✅ Hecho (2026-08-19) | SW-042, SW-043 | Media — sin duración medida, las estadísticas de uso quedan siempre estimadas | Medio |
| SW-045 | ✅ Hecho (2026-08-19) | SW-044 | Media — mismo problema que SW-044 pero para distancia/consumo | Medio |
| SW-046 | ✅ Hecho (2026-08-20) | — (visual, no propuesto por este documento) | Baja — UX del mapa | Bajo |
| SW-047 | ✅ Hecho (2026-08-20) | SW-044, SW-045 | Media — sin esto, comparar rutas/choferes entre sí requería mirar el detalle uno por uno | Bajo-medio |

No se propone trabajar dos de estos hitos en paralelo en la misma rama (regla 2) — y, en la práctica, ya está pasando entre sesiones/herramientas distintas sobre el mismo repo (ver nota de coordinación al inicio); antes de arrancar SW-038 hay que confirmar con quien esté en Claude Code qué rama/hito real está tomando ese número para no repetir el choque de SW-037. SW-040 y SW-041 en particular requieren autorización explícita del Project Owner antes de tocar cualquier entorno remoto o dato real de un municipio, consistente con la regla 6 (no afirmar integraciones reales sin evidencia) y la regla 10 (esperar autorización antes de commit/push/PR).

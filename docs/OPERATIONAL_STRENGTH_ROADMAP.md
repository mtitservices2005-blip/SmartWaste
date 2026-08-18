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

## SW-040 — Activación en entorno remoto (staging)

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

## Resumen de secuencia y dependencias

| Hito | Estado | Depende de | Severidad de lo que resuelve | Esfuerzo relativo |
|---|---|---|---|---|
| SW-036 | ✅ Hecho (PR #51/#52) | SW-020 (ya cerrado) | Alta | Alto (causa no determinística) |
| SW-037 | 🔄 En curso en paralelo (PR #54, `feature/sw037-ux-cleanup`) | SW-020 (ya cerrado) | — (UX + onboarding) | Medio |
| SW-038 | Propuesto | SW-020 (ya cerrado) | Alta | Medio |
| SW-039 | Propuesto | SW-038 (progress consistente antes de exponerlo en UI real) | Media | Medio |
| SW-040 | Propuesto | SW-036, SW-037, SW-038, SW-039 | — (habilitador) | Medio, con gate de seguridad |
| SW-041 | Propuesto | SW-037 (wizard ya construido), SW-040 | — (no técnico + ajuste de datos) | Bajo técnico, alto en coordinación con el ayuntamiento |

No se propone trabajar dos de estos hitos en paralelo en la misma rama (regla 2) — y, en la práctica, ya está pasando entre sesiones/herramientas distintas sobre el mismo repo (ver nota de coordinación al inicio); antes de arrancar SW-038 hay que confirmar con quien esté en Claude Code qué rama/hito real está tomando ese número para no repetir el choque de SW-037. SW-040 y SW-041 en particular requieren autorización explícita del Project Owner antes de tocar cualquier entorno remoto o dato real de un municipio, consistente con la regla 6 (no afirmar integraciones reales sin evidencia) y la regla 10 (esperar autorización antes de commit/push/PR).

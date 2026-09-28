# SW-030 — Parámetros de costo configurables para Impacto y Ahorros

> Datos demo · no producción.

## Objetivo

Antes de este hito, `shared/impact-center.js`'s `calculateImpactMetrics()` usaba una constante
hardcodeada (`defaultImpactAssumptions`) para precio de combustible, rendimiento, costo por hora,
etc. — nada persistía los valores propios de un municipio; se reiniciaban en cada carga de página.
Este hito los hace configurables y persistentes por municipio, y agrega dos comparaciones nuevas con
datos operativos reales (cuando existen), separadas del escenario demo ya aprobado.

## Alcance

### 1. Parámetros de costo por municipio

`shared/cost-parameters.js` (nuevo): valida (`validateCostParameters()`), combina con valores por
defecto (`mergeCostParameters()`), y persiste (`fetchCostParameters()`/`saveCostParameters()`) los 10
parámetros que la fórmula ya usa (revisados en `shared/impact-center.js` antes de tocar nada — ningún
parámetro nuevo, ninguna fórmula reinventada): `fuelPrice`, `fuelEfficiency`, `operatingDays`,
`hourlyCost`, `baseDistanceKm`, `baselineOperatingHours`, `operatingHours`, `incidentAvoidanceCost`,
`minutesPerStop`, `avgSpeedKmh`. `currentDistanceKm` queda fuera a propósito: sigue siendo un dato
derivado de rutas reales/demo, nunca un parámetro configurable.

**Sin migración nueva.** Se reutiliza `municipality_settings` (tabla ya existente desde SW-007,
`settings jsonb`, una fila por municipio, `unique(municipality_id)`), guardando bajo la clave
`cost_parameters`. Esa tabla ya tenía exactamente las políticas RLS que este hito necesita
(`202607150004_sw014_auth_rls_policies.sql`):
- `tenant_read`/`tenant_insert_staff`/`tenant_update_staff`: un `municipal_admin`/`supervisor`/
  `dispatcher` puede leer y escribir **solo** la fila de su propio `municipality_id`
  (`has_municipality_role()` exige una fila de membresía activa para ese municipio exacto).
- `mt_superadmin` (Master Admin) pasa el mismo chequeo para **cualquier** `municipality_id`, vía el
  bypass de rol de plataforma que `has_municipality_role()` ya tenía incorporado.

Esto es el aislamiento estricto pedido (punto 2 del alcance) sin escribir una sola línea de política
nueva — la lectura/escritura de `shared/cost-parameters.js` simplemente respeta lo que Postgres ya
decide.

### 2. UI de edición

- **Panel municipal** (`frontend/app.js`, pestaña Economía de Impacto y Ahorros): formulario con los
  10 campos (`renderCostParameterFields()`), banner "Estimado, ajustá con tus datos reales" mientras
  `configured` sea `false` (nada guardado todavía para ese municipio), botón explícito "Guardar
  parámetros" (no se guarda solo por escribir — hay vista previa en vivo, pero persistir requiere el
  clic).
- **Master Admin** (`renderMaster()`): un `<details>` colapsado por municipio (mismo patrón que "+
  Nueva ruta"), con el mismo formulario, cargado de forma perezosa la primera vez que se abre
  (`loadMasterCostParameters()`) — evita N llamadas de red al renderizar la lista completa.
- Validación de rangos (`validateCostParameters()`): ningún campo puede ser negativo;
  `fuelEfficiency` y `avgSpeedKmh` (los dos únicos divisores de la fórmula) no pueden ser cero o
  negativos — el resto sí permite cero (p. ej. un municipio sin programa de incidencias todavía).

### 3. Ambas comparaciones con datos reales

`shared/route-savings.js` (nuevo): `compareManualVsOptimizedRoute()`/`aggregateRouteSavings()`
reutilizan el motor de rutas existente (`optimizeWaypointOrder()` de `shared/route-optimizer.js`,
`haversineMeters()` de `shared/route-engine.js`) — sin algoritmo nuevo.

`shared/impact-center.js`'s `calculateImpactMetrics()` acepta ahora un tercer parámetro opcional
`realData` (`{ operational, routeSavings }`) y devuelve `metrics.realComparison`:
- **a) Antes vs. después** (`hydrateRealComparisonData()`, `frontend/app.js`): usa
  `summarizeRouteRunsForMunicipality()` (ya existía, SW-047/SW-060) sobre `realAdapter.listRouteRuns()`
  — sin filtrar por `source`, tal como se pidió ("no distinguir origen"). Si no hay ninguna corrida
  medida (`runsCount === 0` o el fetch falla), `metrics.realComparison.operational` es `null` y la UI
  muestra "Pendiente de datos operativos reales" en vez de inventar un número.
- **b) Ruta optimizada vs. manual**: para cada ruta real (`route.real_id`) con paradas guardadas
  (`realAdapter.listRouteStops()`), compara el orden guardado ("manual") contra
  `optimizeWaypointOrder()` aplicado a esas mismas paradas. Sin rutas reales con ≥3 paradas,
  `metrics.realComparison.routeSavings` es `null` → "Pendiente de datos" en la UI.

**Deliberadamente separado** del escenario demo ya aprobado (`buildBeforeAfter()`,
`IMPACT_SCENARIO_NOTICE`) — ese sigue exactamente igual (regla 5), esta es una sección nueva y
adicional, no un reemplazo.

### 4. Persistencia demo/real

`createDemoCostParametersStore()` (in-memory, por `municipality_id`) se usa cuando no hay
`getAuthClient()` — la misma instancia sirve tanto al panel municipal (con
`pilotMunicipality.id`/`readSupabaseConfig()?.municipality_id`) como a Master Admin editando
cualquiera de los 2 municipios demo (`laguna-salada-rd`, `mun-norte`), sin tocar Supabase.

## Fuera de alcance / pendiente

- **Verificación real de aislamiento entre municipios contra Postgres.** El aislamiento demo (dos
  `municipality_id` en el store en memoria) está cubierto por test (`tests/cost-parameters.test.mjs`,
  casos 8-11). El aislamiento **real** —que un `municipal_admin` de un municipio no pueda leer/escribir
  la fila de otro— lo decide `has_municipality_role()` en RLS, ya usado y verificado para las otras 12
  tablas del mismo loop desde SW-014/SW-020, pero **no se re-verificó específicamente para
  `municipality_settings` en este hito** (este sandbox no tiene Docker/Supabase local, ítem #15 del
  registro de deuda). Pendiente de verificación interactiva o `tests/rls-adversarial.test.mjs`
  ampliado.
- Conectar el resto del formulario ciudadano/otros paneles a estos mismos parámetros: fuera de
  alcance, no pedido.
- **"Manual" en b) es el orden de paradas tal como quedó guardado (`listRouteStops()`), no
  necesariamente el trazo original que un despachador dibujó a mano** (hallazgo Codex, PR #88, P2).
  Si esas paradas ya pasaron por algún ajuste/snapping previo a guardarse, la comparación mide
  "orden guardado vs. orden que produciría `optimizeWaypointOrder()`", que es una pregunta útil pero
  distinta de "cuánto ahorraría optimizar lo que el despachador trazó a mano". No se reescribe el
  pipeline de guardado de paradas para resolver esto aquí — es una decisión de arquitectura mayor
  (¿debe persistirse el trazo original sin snapping, además del guardado actual?) fuera del alcance
  de este hito; se deja documentada para que el Project Owner decida si abre un hito propio. Mientras
  tanto, la UI (`frontend/app.js`, `renderRouteSavingsComparison()`) etiqueta la fila como "orden
  guardado" en vez de "trazo manual" para no sobreafirmar qué se está comparando.

## Evidencia automática

- `tests/cost-parameters.test.mjs` (18 casos): validación de rangos, merge con defaults,
  lectura/escritura real con cliente Supabase simulado (inserta si no existe la fila, actualiza
  preservando otras claves de `settings` si existe), aislamiento entre municipios en el store demo.
- `tests/route-savings.test.mjs` (mismo estilo que `tests/route-optimizer.test.mjs`): comparación
  manual vs. optimizada con fixture de zig-zag (ahorro real, positivo), orden ya óptimo (sin ahorro,
  pero comparable), agregación excluyendo rutas con menos de 3 paradas.
- `tests/impact-center.test.mjs` (casos nuevos): `realComparison` es `null` sin datos reales, se
  puebla correctamente con datos reales, `runsCount`/`routesCompared` en 0 sigue leyendo como
  "pendiente de datos", no como "0% real medido".
- Suite completa `tests/*.test.mjs` sin regresiones.
- Verificación interactiva en staging pendiente del Project Owner: confirmar en un municipio real que
  guardar parámetros persiste, que Master Admin puede editar cualquiera y el panel municipal solo el
  propio, y que las dos comparaciones reales aparecen con datos genuinos.

# SW-097 Mapa en vivo para el ciudadano — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página pública `/en-vivo?m=<slug>` que muestra los camiones con corrida activa hoy y su ruta, actualizada cada ~15 s, sin iniciar sesión.

**Architecture:** Una función SQL `public_live_fleet(slug)` (SECURITY DEFINER, solo lectura, solo campos públicos) es la única puerta de datos para `anon`. Lógica pura en `shared/` (normalizar + sondeo), HTML en `frontend/components/live-map.js`, y una entrada propia `frontend/en-vivo.html` + `en-vivo.js` con Leaflet. Maqueta con capturas ANTES de cablear datos reales.

**Tech Stack:** JS ESM vanilla, Leaflet 1.9.4 (unpkg, como `app.js`), Supabase (`rpc`), Vercel estático. Las pruebas son scripts `node tests/<nombre>.test.mjs` con `node:assert/strict` (sin framework).

**Spec:** `docs/superpowers/specs/2026-10-17-sw097-mapa-en-vivo-design.md`

## Global Constraints

- Migración **aditiva** (no editar migraciones existentes); la aplica Miguel en el SQL Editor; sin secretos en el repo.
- Cero tablas/policies nuevas; `anon` solo ejecuta la función. Nunca exponer: conductor, placa, batería, velocidad, historial, litros, corridas `is_test`.
- Solo corridas `started | in_progress | delayed`; máximo 50 camiones por respuesta.
- `POLL_INTERVAL_MS = 15000`; `STALE_AFTER_SECONDS = 180`; backoff 15 s → 30 s → 60 s.
- Español neutro con "tú"; componentes `frontend/components/*.js` importan solo desde `./`; claro/oscuro con los tokens existentes (`frontend/styles/tokens.css`).
- Pruebas que dependen de Supabase local: "pendiente de CI". Sin push/merge/deploy sin autorización de Miguel.
- Un commit por tarea con `$HOME/gc97.sh "<mensaje>"` (rama `feature/sw097-mapa-en-vivo`, worktree `wt-sw097`).

## Review Focus

- Slug inexistente / vacío / con comillas o `%`: la RPC devuelve `{municipality:null, vehicles:[]}` sin error ni inyección (Task 1).
- Camión con corrida `completed`, `cancelled` o `is_test=true`: no aparece (Task 1, prueba textual del filtro).
- Coordenadas `null`/NaN/fuera de rango en un camión: se descarta ese camión, el resto se pinta (Task 2).
- Reloj del servidor distinto al del navegador: la antigüedad se calcula con `server_time`, no con `Date.now()` solo (Task 2).
- Pestaña oculta mucho rato y vuelve: una consulta inmediata, sin ráfaga de consultas acumuladas (Task 3).
- Nombre de ruta con `<script>` o `&`: sale escapado (Task 4).
- Red caída: se conserva el último mapa visible y se muestra "Reintentando…", no se vacía (Tasks 3 y 6).

---

### Task 1: Migración `public_live_fleet`

**Files:**
- Create: `supabase/migrations/202610170001_sw097_public_live_fleet.sql`
- Test: `tests/sw097-migration.test.mjs`

**Interfaces:**
- Produces: `public.public_live_fleet(p_municipality_slug text) returns jsonb` con forma
  `{ municipality: { name, slug } | null, server_time: ISO, vehicles: [{ code, route_name, status ('en_ruta'|'detenido'|'sin_senal'), lat, lng, heading, captured_at, stopped_since, run_started_at, path: [[lat,lng],…] }] }`.

- [ ] **Step 1: Escribe la prueba** `tests/sw097-migration.test.mjs` (lee el SQL como texto) con aserciones: contiene `create or replace function public.public_live_fleet`, `security definer`, `set search_path = public`, `revoke all on function public.public_live_fleet(text) from public`, `grant execute on function public.public_live_fleet(text) to anon, authenticated`; filtra `status in ('started','in_progress','delayed')` y `is_test` falso; contiene `limit 50`; **no** contiene (en el cuerpo de la función) `plate`, `battery_pct`, `display_name`, `phone`, `liters`, `speed`; no contiene `create policy` ni `create table`; pasa el slug solo en comparaciones (`= p_municipality_slug`, sin `execute`/`format(`).
- [ ] **Step 2:** `node tests/sw097-migration.test.mjs` → FALLA (archivo no existe).
- [ ] **Step 3: Implementa** la función en el archivo nuevo: `language plpgsql stable security definer set search_path = public`. Busca municipio por `slug` y `status in ('active','onboarding')`; si no hay, devuelve `jsonb_build_object('municipality', null, 'server_time', now(), 'vehicles', '[]'::jsonb)`. Une `vehicle_live_state` (`municipality_id` = el del slug) con `route_runs` (id = `route_run_id`, estados activos, `coalesce(is_test,false)=false`), `vehicles` (solo `code`), `routes` (solo `name`), y `route_paths` ordenados por `sequence` agregados como arreglo de `[lat,lng]`. `status` público: `sin_senal` si `status='sin_senal'`, `detenido` si `detenido`, si no `en_ruta`. `run_started_at` = `route_runs.started_at`. `order by code limit 50`. Termina con `revoke`/`grant` de la prueba.
- [ ] **Step 4:** `node tests/sw097-migration.test.mjs` → PASA.
- [ ] **Step 5: Commit** `$HOME/gc97.sh "feat(SW-097): RPC pública public_live_fleet (solo lectura, datos mínimos)"`.

---

### Task 2: Lógica pura `shared/live-fleet.js`

**Files:**
- Create: `shared/live-fleet.js`
- Test: `tests/live-fleet.test.mjs`

**Interfaces:**
- Produces: `export const STALE_AFTER_SECONDS = 180`;
  `normalizeLiveFleet(payload, nowMs = Date.now()) → { municipality: {name,slug}|null, vehicles: Vehicle[], serverTimeMs: number }` donde `Vehicle = { code, routeName, status, lat, lng, heading, capturedAtMs, ageSeconds, stoppedSinceMs|null, runStartedAtMs|null, path: [[lat,lng]] }`;
  `describeVehicleStatus(vehicle) → string`.

- [ ] **Step 1: Escribe las pruebas** (nombres): `forma válida produce vehículos normalizados`; `payload null/sin vehicles → lista vacía sin lanzar`; `descarta camión con lat/lng nulos, NaN o fuera de rango y conserva los demás`; `ageSeconds usa server_time (no el reloj local)`; `fuerza sin_senal si ageSeconds > 180`; `path inválido → []`; `describeVehicleStatus` devuelve exactamente "En ruta", "Detenido hace 4 min" (con `stoppedSinceMs`), "Sin señal desde las 10:42" (hora local `es-DO`, 24 h → usa `HH:MM` con `Intl.DateTimeFormat('es-DO',{hour:'2-digit',minute:'2-digit',hour12:false})`).
- [ ] **Step 2:** `node tests/live-fleet.test.mjs` → FALLA.
- [ ] **Step 3: Implementa** las dos funciones en `shared/live-fleet.js` (módulo puro, sin DOM ni red). `ageSeconds = (serverTimeMs - capturedAtMs)/1000` redondeado, mínimo 0; `nowMs` solo se usa si falta `server_time`.
- [ ] **Step 4:** prueba → PASA.
- [ ] **Step 5: Commit** `$HOME/gc97.sh "feat(SW-097): normalización y textos de estado de la flota pública"`.

---

### Task 3: Sondeo `pollLiveFleet`

**Files:**
- Create: `shared/live-fleet-poll.js`
- Test: `tests/live-fleet-poll.test.mjs`

**Interfaces:**
- Consumes: ninguna (recibe `fetchFleet: () => Promise<payload>` por parámetro).
- Produces: `export const POLL_INTERVAL_MS = 15000`;
  `pollLiveFleet({ fetchFleet, onData, onError, intervalMs = POLL_INTERVAL_MS, timers = { setTimeout, clearTimeout }, doc = globalThis.document }) → { stop(): void, refreshNow(): Promise<void> }`.

- [ ] **Step 1: Escribe las pruebas** con temporizadores falsos inyectados (`timers`) y un `doc` falso (`hidden`, `addEventListener`): `consulta de inmediato al iniciar y luego cada 15000 ms`; `no solapa consultas (si una sigue en curso, espera)`; `con pestaña oculta no consulta; al volver visible consulta una sola vez de inmediato`; `tras error llama onError y reintenta a 30000 y luego 60000 ms; tras éxito vuelve a 15000`; `stop() cancela el temporizador y quita el listener`.
- [ ] **Step 2:** `node tests/live-fleet-poll.test.mjs` → FALLA.
- [ ] **Step 3: Implementa** con `setTimeout` encadenado (no `setInterval`), bandera `inFlight`, y listener `visibilitychange` en `doc`.
- [ ] **Step 4:** prueba → PASA.
- [ ] **Step 5: Commit** `$HOME/gc97.sh "feat(SW-097): sondeo cada 15 s con pausa en segundo plano y backoff"`.

---

### Task 4: Componente `frontend/components/live-map.js`

**Files:**
- Create: `frontend/components/live-map.js`
- Test: `tests/live-map.test.mjs`
- Modify: `tests/components-imports.test.mjs` solo si exige registrar archivos nuevos (verifica antes; si recorre la carpeta, no tocar).

**Interfaces:**
- Consumes: forma `Vehicle` de la Task 2 (se recibe ya con `statusText` calculado por quien llama: `{...vehicle, statusText}`).
- Produces (HTML string, texto escapado, sin imports externos): `renderLiveHeader({ municipalityName, updatedAgoText })`, `renderLiveVehicleList({ vehicles, selectedCode })` (cada tarjeta con `data-live-vehicle="<code>"`), `renderLiveEmpty()` ("Hoy aún no hay camiones en ruta"), `renderLiveError({ hasData })` ("No pudimos actualizar. Reintentando…"), `renderLiveNoMunicipality()`.

- [ ] **Step 1: Escribe las pruebas**: cada función devuelve el texto exacto de arriba; un `routeName` `<img src=x onerror=1>&` sale como `&lt;img…&amp;`; la tarjeta seleccionada lleva `aria-current="true"`; la lista muestra código, ruta, `statusText`; `sin_senal` agrega la clase `is-stale`; ningún HTML contiene `plate`, `battery`, `driver`.
- [ ] **Step 2:** → FALLA.
- [ ] **Step 3: Implementa** las cinco funciones; clases con prefijo `live-` (estilos en Task 5).
- [ ] **Step 4:** → PASA, y `node tests/components-imports.test.mjs` sigue PASANDO.
- [ ] **Step 5: Commit** `$HOME/gc97.sh "feat(SW-097): componente HTML del mapa en vivo"`.

---

### Task 5: Maqueta con capturas (PUERTA: aprobación de Miguel)

**Files:**
- Create: `frontend/styles/live.css`, `scripts/sw097-harness.mjs`, `docs/evidence/SW-097/*.png`

**Interfaces:**
- Consumes: componentes de la Task 4 y `normalizeLiveFleet`/`describeVehicleStatus`.
- Produces: `node scripts/sw097-harness.mjs <carpeta>` genera HTML estático (como `scripts/sw090-harness.mjs`: CSS inline desde `frontend/styles/`, datos de ejemplo, sin red; el mapa se sustituye por un recuadro con la ruta dibujada en SVG con los mismos puntos) para los escenarios: en ruta, detenido, sin señal, vacío, error con datos previos, sin municipio.

- [ ] **Step 1:** Escribe `frontend/styles/live.css` (móvil primero: mapa arriba ~55 % alto, lista debajo; escritorio: lista lateral 340 px; usa solo tokens; claro y oscuro).
- [ ] **Step 2:** Escribe el harness y ejecútalo; fotografía con Playwright (chromium) móvil 390×844 y escritorio 1280×800, claro y oscuro, los 6 escenarios; guarda PNG en `docs/evidence/SW-097/`.
- [ ] **Step 3:** Prueba `tests/sw097-harness.test.mjs`: el harness corre en una carpeta temporal y produce un HTML por escenario que contiene el texto esperado de cada escenario.
- [ ] **Step 4: Commit** `$HOME/gc97.sh "feat(SW-097): maqueta y capturas del mapa en vivo"`.
- [ ] **Step 5: DETENTE.** Muestra las capturas a Miguel y espera su aprobación explícita. No empieces la Task 6 sin ella.

---

### Task 6: Página `/en-vivo` y despliegue

**Files:**
- Create: `frontend/en-vivo.html`, `frontend/en-vivo.js`
- Modify: `scripts/build-frontend-config.mjs` (inyectar `SMARTWASTE_SUPABASE_CONFIG` también en `dist/en-vivo.html`, mismos marcadores START/END, mismo modo demo si faltan variables), `vercel.json` (`rewrites`: `/en-vivo` → `/en-vivo.html`)
- Test: `tests/en-vivo-wiring.test.mjs`; ampliar `tests/build-frontend-config.test.mjs` y `tests/dist-imports.test.mjs` solo si fallan por el archivo nuevo.

**Interfaces:**
- Consumes: `normalizeLiveFleet`, `describeVehicleStatus` (Task 2), `pollLiveFleet` (Task 3), componentes (Task 4), `live.css` (Task 5).
- Produces: `export function mountLiveMap({ root, win, fetchFleet, loadLeaflet, slug }) → { stop() }` en `frontend/en-vivo.js` (testeable con DOM/fetch falsos); al final del archivo, arranque automático solo si `typeof window !== 'undefined'` y hay `#liveRoot`.

- [ ] **Step 1: Escribe `tests/en-vivo-wiring.test.mjs`**: (a) lee `frontend/en-vivo.html`: contiene `<script type="module" src="./en-vivo.js">`, enlaza los CSS de tokens y `live.css`, sin `auth-gate`; (b) `vercel.json` tiene el rewrite; (c) `mountLiveMap` con `fetchFleet` falso: sin `slug` pinta `renderLiveNoMunicipality`; con datos pinta la lista y llama a `loadLeaflet`; si el segundo sondeo falla, **conserva** la lista anterior y añade el aviso de error; `stop()` detiene el sondeo; (d) ejecutar el build en carpeta temporal (patrón de `build-frontend-config.test.mjs`) con `SUPABASE_URL`/`SUPABASE_ANON_KEY` falsos produce `dist/en-vivo.html` con el bloque de config y `./shared/` reescrito en `dist/en-vivo.js`.
- [ ] **Step 2:** → FALLA.
- [ ] **Step 3: Implementa** `en-vivo.html` (estructura del `index.html`: tema temprano, fuentes, CSS, `<div id="liveRoot">`), `mountLiveMap` (lee `?m=`; `fetchFleet` = `supabase.rpc('public_live_fleet', { p_municipality_slug })` con el cliente de `frontend/vendor/supabase-js.mjs` creado con la anon key de `window.SMARTWASTE_SUPABASE_CONFIG`; Leaflet 1.9.4 desde unpkg igual que `app.js`; dibuja ruta como polilínea, camión como marcador con rumbo; encuadra la ruta solo la primera vez; seleccionar tarjeta enfoca el camión; "Actualizado hace N s" se refresca cada segundo sin consultar), el cambio al build script y el rewrite.
- [ ] **Step 4:** `node tests/en-vivo-wiring.test.mjs`, `build-frontend-config.test.mjs`, `dist-imports.test.mjs` → PASAN.
- [ ] **Step 5: Commit** `$HOME/gc97.sh "feat(SW-097): página pública /en-vivo con sondeo y despliegue"`.

---

### Task 7: Enlace desde Mando, guía y verificación

**Files:**
- Modify: la pantalla de Flotilla o Resumen de `frontend/app.js` / `frontend/components/fleet-screens.js` (un enlace discreto "Ver mapa público en vivo" que abre `/en-vivo?m=<slug>` en pestaña nueva, solo con sesión real y slug conocido; ubicar el slug donde `app.js` ya lo tenga, si no existe no mostrar el enlace)
- Create: `docs/evidence/SW-097/guia-prueba-campo.md`
- Test: `tests/en-vivo-link.test.mjs`

- [ ] **Step 1: Prueba** (render del componente): con slug aparece el enlace con `href="/en-vivo?m=laguna-salada-rd"` y `target="_blank" rel="noopener"`; sin slug no aparece.
- [ ] **Step 2:** → FALLA. **Step 3:** implementa. **Step 4:** → PASA.
- [ ] **Step 5:** Escribe la guía: aplicar la migración en Supabase (SQL Editor), abrir `/en-vivo?m=<slug>` en otro dispositivo, iniciar una corrida **real** (no marcada prueba) en el teléfono, ver el camión moverse y cambiar a "Detenido"/"Sin señal", qué esperar si no hay corrida activa. Nota: sin APK nuevo (no hay cambios en la app del conductor).
- [ ] **Step 6: Verificación final:** correr todos los `tests/*.test.mjs` (bucle `for f in tests/*.test.mjs; do node $f || echo FALLA $f; done`; los de Supabase local quedan "pendiente de CI"); revisar `git diff origin/main --stat`; confirmar con `grep` que ningún archivo nuevo expone `plate|battery|display_name|phone`.
- [ ] **Step 7: Commit** `$HOME/gc97.sh "feat(SW-097): enlace en Mando, guía de prueba y verificación"`.

---

## Auto-revisión

- **Cobertura del spec:** RPC y privacidad (T1), normalización/estados/180 s (T2), 15 s + pausa + backoff (T3), componente y estados vacío/error (T4), maqueta antes de cablear (T5), página, rewrite, build (T6), enlace/guía/pruebas (T7). Fuera de alcance respetado.
- **Aclaración sobre el spec:** el config del despliegue solo trae `municipality_id` (uuid), no slug; por eso, **si falta `?m=` la página muestra un aviso** en vez de usar un municipio por defecto. Si Miguel quiere un municipio por defecto, se añade una variable de build `SUPABASE_MUNICIPALITY_SLUG`.
- **Consistencia de tipos:** `Vehicle` (T2) → `{...vehicle, statusText}` (T4) → `mountLiveMap` (T6); `POLL_INTERVAL_MS` en T3 coincide con las restricciones globales.

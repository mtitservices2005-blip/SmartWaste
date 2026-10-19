# SW-097 — Mapa en vivo para el ciudadano (diseño)

Fecha: 2026-10-17 · Rama: `feature/sw097-mapa-en-vivo` (desde `main` tras PR #113)

## Objetivo
Que cualquier ciudadano del municipio abra una página pública y vea **dónde va el camión de recolección ahora mismo y qué ruta está haciendo hoy**, sin iniciar sesión. Decisiones de Miguel: contenido **camión + ruta del día**; actualización **casi en vivo, ~15 segundos**; enfoque A (RPC pública de solo lectura + página `/en-vivo`).

## Punto de partida (ya existe)
- `vehicle_live_state` (una fila por camión: `vehicle_id`, `route_run_id`, `lat`, `lng`, `speed`, `heading`, `battery_pct`, `captured_at`, `stopped_since`, `status` = `en_ruta | detenido | sin_senal | disponible`), alimentada por `ingest_positions` (SW-081).
- `route_runs` (estado `started | in_progress | delayed | completed…`), `routes`, `route_paths` (geometría), `route_stops`, `municipalities` (`slug` único, `status`).
- Realtime de Supabase no funciona (deuda técnica #14) → **polling**.
- Lectura pública previa: SW-060 (`anon_read_sectors`) como precedente de lectura anónima acotada.
- El mapa del frontend ya usa Leaflet/OSM (vendor local).

## Qué se expone (y qué no)
**Sí:** por cada camión con corrida activa hoy en ese municipio: un código/alias público del camión, nombre de la ruta, geometría de la ruta, posición actual (lat/lng), rumbo, estado simplificado (`en_ruta`, `detenido`, `sin_senal`), hora de la última señal, y la hora de inicio de la corrida.
**No (nunca):** nombre/teléfono/correo del conductor, placa, batería, velocidad exacta, historial de posiciones, litros/combustible, métricas de corridas, ids internos de usuarios, corridas de prueba (`is_test = true`).
Solo se muestran corridas en estado `started | in_progress | delayed` del día; si la señal tiene más de N minutos se marca `sin_senal` y se atenúa en el mapa (no se oculta, para no dar falsa idea de que no hay servicio).

## Diseño

### 1. Migración aditiva `supabase/migrations/202610170001_sw097_public_live_fleet.sql`
- Función `public.public_live_fleet(p_municipality_slug text) returns jsonb`, `SECURITY DEFINER`, `set search_path = public`, `stable`.
- Valida el slug contra `municipalities` (estado activo); si no existe devuelve `{ "municipality": null, "vehicles": [] }` (misma forma, sin error que filtre información).
- Une `vehicle_live_state` ← `route_runs` (estado activo, no `is_test`, del municipio) ← `routes` ← `route_paths`; devuelve **solo** los campos de la sección anterior, más `server_time`.
- `revoke all … from public; grant execute … to anon, authenticated;`. **Ninguna tabla nueva ni policy nueva**: las tablas base siguen cerradas para `anon`; la única puerta es la función.
- Límite defensivo: máximo 50 camiones por respuesta.
- La aplica Miguel en el SQL Editor (protocolo habitual).

### 2. Lógica pura — `shared/live-fleet.js` (nuevo)
- `normalizeLiveFleet(payload, now)`: valida la forma, descarta puntos con lat/lng inválidas, calcula `ageSeconds` y fuerza `sin_senal` si `ageSeconds` supera el umbral (`STALE_AFTER_SECONDS = 180`).
- `describeVehicleStatus(vehicle)` → texto en español ("En ruta", "Detenido hace 4 min", "Sin señal desde las 10:42").
- `pollLiveFleet({ fetchFleet, intervalMs = 15000, onData, onError })`: bucle con `setTimeout` (no `setInterval`), pausa si la pestaña está oculta (`visibilitychange`) y reanuda con una consulta inmediata; backoff simple tras errores (15 s → 30 s → 60 s) y vuelve a 15 s al recuperarse. Devuelve `stop()`.

### 3. Componente — `frontend/components/live-map.js` (nuevo)
Funciones que devuelven HTML (patrón de `components/*.js`, importan solo desde `./`): cabecera con nombre del municipio, indicador "Actualizado hace N s", lista/tarjetas de camiones (estado, ruta, última señal), estado vacío ("Hoy aún no hay camiones en ruta"), estado de error ("No pudimos actualizar. Reintentando…"). Móvil primero; claro/oscuro con los tokens de Mando.

### 4. Página `/en-vivo` — `frontend/en-vivo.html` + `frontend/en-vivo.js` (nuevos)
- Entrada propia (sin `auth-gate`, sin login). Lee `?m=<slug>`; si falta, usa el municipio por defecto del despliegue (`SMARTWASTE_SUPABASE_CONFIG`) o muestra un aviso.
- Cliente Supabase con la **anon key** que ya inyecta `build-frontend-config.mjs`; llama `rpc('public_live_fleet', { p_municipality_slug })`.
- Mapa Leaflet: ruta del día como línea, camión como marcador con rumbo; al primer dato encuadra la ruta; no recentra al usuario en cada actualización si ya movió el mapa. Seleccionar un camión en la lista lo enfoca.
- `vercel.json`: reescritura `/en-vivo` → `/en-vivo.html` (conservando `?m=`); `scripts/build-frontend-config.mjs` copia y configura la nueva página igual que `index.html`.
- Enlace "Ver camiones en vivo" desde la app web (Mando) para el administrador, fuera del flujo del conductor.

### 5. Seguridad y carga
- Solo lectura; sin parámetros que lleguen a SQL dinámico (slug solo se compara).
- Datos mínimos (sección «Qué se expone»); sin conductor, placa ni batería.
- Carga: cada visitante consulta cada 15 s; la función es una lectura pequeña indexada por municipio. Si el tráfico creciera, se puede añadir caché de borde (`s-maxage=10`) delante, sin cambiar el diseño. Se documenta, no se implementa ahora.
- Posibles abusos (scraping): la respuesta ya es pública por diseño y sin datos personales; el límite de 50 camiones acota el tamaño.

### 6. Fuera de alcance
Notificaciones push al ciudadano ("el camión está cerca de tu casa"), historial de recorridos públicos, hora estimada de llegada por parada, paradas en el mapa público, app nativa ciudadana, cambios a la app del conductor.

## Pruebas (TDD, sin red)
1. `live-fleet`: `normalizeLiveFleet` (forma válida, vacía, coordenadas inválidas, `sin_senal` por antigüedad), `describeVehicleStatus`.
2. `pollLiveFleet` con reloj/temporizadores falsos: intervalo de 15 s, pausa con pestaña oculta y consulta inmediata al volver, backoff tras error y recuperación, `stop()`.
3. `live-map` (componente): vacío, con camiones, error, escapado de HTML en nombres.
4. Estructura de la migración (texto): `security definer`, `search_path`, sin columnas sensibles (`phone`, `plate`, `battery`, `driver`), `revoke … from public`, `grant … to anon`.
5. Build/Vercel: `build-frontend-config` incluye `en-vivo.html`; la reescritura existe en `vercel.json`.
6. Pruebas de la RPC contra Supabase local: **pendiente de CI** (protocolo habitual).

## Entregables
Código + pruebas + **maqueta primero** (capturas móvil y escritorio, claro y oscuro, con camión en ruta / detenido / sin señal / vacío / error) en `docs/evidence/SW-097/` para tu aprobación antes de conectar datos reales; migración para que la apliques; guía de prueba con el teléfono del conductor en ruta y la página abierta en otro dispositivo.

## Riesgos y decisiones abiertas
- Si hay corridas de prueba activas, no aparecen (por `is_test`); Miguel debe tener una corrida real (no marcada prueba) para verla en vivo.
- El código/alias público del camión: se usa el que ya tenga el camión en Flotilla; si no es apto para público, se ajusta en el plan.
- El umbral de 180 s para `sin_senal` es ajustable.

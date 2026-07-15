# SmartWaste E2E Test Matrix SW-017

Status values: REAL_VERIFIED, REAL_NOT_RUN, PARTIAL, DEMO_ONLY, BLOCKED, FAILED.

| Step | Result | Evidence |
|---|---|---|
| Crear municipio/configuración/usuario/membership/login | REAL_NOT_RUN | Supabase CLI/Docker unavailable; no real Auth executed. |
| Resolver rol y municipality_id | PARTIAL | Shared auth context implemented and unit-tested statically. |
| Crear vehículo/conductor/sectores/ruta/paradas | REAL_NOT_RUN | Persistence adapter and migrations prepared; database not run. |
| Asignar vehículo/conductor e iniciar ruta | PARTIAL | Demo adapter tested; real adapter prepared but not executed. |
| Telemetría simulada, persistencia, Realtime, mapa | PARTIAL | Simulator and validation tested; DB/Realtime not run. |
| Incidencia/retraso/completar/verificar | PARTIAL | Demo flow tested; real persistence not run. |
| Historial/auditoría | REAL_NOT_RUN | Requires local Supabase execution. |
| Cross-tenant read/update/insert/assignments | PARTIAL | RLS and trigger SQL prepared; no real adversarial execution. |

Browser visual test: NOT_RUN because no browser/headless run was executed in this container.

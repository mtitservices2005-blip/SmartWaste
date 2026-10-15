-- SW-085: hora de inicio programada de cada corrida de ruta (route_runs).
-- La app del conductor la muestra en "Rutas de hoy" ("8:00 a. m.").
-- Aditiva y opcional: las corridas existentes quedan sin hora y la app no inventa una.
-- No cambia reglas de seguridad (RLS): la columna hereda las políticas actuales de route_runs.
alter table route_runs add column if not exists scheduled_start_at timestamptz;
comment on column route_runs.scheduled_start_at is 'Hora de inicio programada de la corrida (SW-085). Nula si la central no la fijó.';

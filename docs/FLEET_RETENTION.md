# Retención del GPS crudo (SW-081)

Decisión de Miguel (2026-10-13): el historial crudo de `vehicle_positions` se conserva **180 días** y el valor es **configurable** (antes de la aprobación eran 90). Los resúmenes diarios y semanales se conservan siempre.

## Dónde vive el valor

Tabla `fleet_settings`, fila `gps_retention_days` (JSON numérico, sembrada con `180` por la migración `202610120002_sw081_alerts_fuel_retention.sql`). El código de `purge_old_positions()` no lleva ningún número fijo: si la fila no existe y no se pasa un parámetro, la función falla con `retention_not_configured` en vez de borrar con un valor adivinado.

Solo `mt_superadmin` (o el dueño de la base / `service_role`) puede cambiarla. Para cambiarla, desde el SQL Editor de Supabase:

```sql
update fleet_settings set value = to_jsonb(365), updated_at = now() where key = 'gps_retention_days';
```

## Cómo se purga

`select purge_old_positions();` borra de `vehicle_positions` los puntos con `captured_at` anterior a la retención configurada y devuelve cuántos borró. `select purge_old_positions(120);` usa 120 días solo en esa llamada. Nunca toca `vehicle_live_state` (última posición de cada camión) ni las métricas ya guardadas en `route_runs` (distancia, duración, conteo de puntos GPS).

Ningún rol de aplicación (administrador de municipio, chofer) tiene política de `DELETE` sobre `vehicle_positions`, así que si lo invocan no borran nada. Debe ejecutarlo la base (pg_cron) o una persona con acceso de plataforma.

## Programación

La migración **no** crea la extensión `pg_cron` (en Supabase se activa desde el panel y no está garantizada en Supabase local/CI). Opciones:

1. **Con `pg_cron`** (si el plan lo permite): activar la extensión en Database → Extensions y programar una vez al día, por ejemplo a las 03:30 hora de Santo Domingo (07:30 UTC):

   ```sql
   select cron.schedule('sw-purge-gps', '30 7 * * *', $$select purge_old_positions()$$);
   ```

2. **Manual** (sin `pg_cron`): ejecutar `select purge_old_positions();` desde el SQL Editor una vez a la semana. Esta acción la hace Miguel; el agente no ejecuta nada en Supabase remoto.

## Pendientes relacionados

- SW-085 (reportes): las vistas de resumen diario no deben depender de puntos GPS más viejos que la retención; usar `route_runs` (distancia, duración) o materializar el resumen antes de purgar.
- SW-087 (respaldo): antes de activar la purga en producción confirmar que existe respaldo restaurable.

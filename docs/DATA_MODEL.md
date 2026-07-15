# Modelo de datos Alpha

> Datos demo · no producción

## Núcleo multiinstitución

- `municipalities`: ayuntamientos.
- `plans`: plan contratado.
- `users`: administradores, supervisores, conductores y Master Admin.
- `trucks`: camiones y estado operativo.
- `drivers`: conductores asignables.
- `sectors`: sectores geográficos.
- `routes`: rutas programadas.
- `stops`: paradas o segmentos.
- `assignments`: relación ruta-camión-conductor.
- `incidents`: incidencias ciudadanas u operativas.
- `audit_logs`: trazabilidad.
- `notifications`: avisos demo.

## Estados de camión

`active`, `stopped`, `delayed`, `offline`, `completed`.

## Flujo de ruta

`planned → assigned → started → in_progress → delayed → completed → verified`.

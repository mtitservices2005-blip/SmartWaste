# Arquitectura SmartWaste Alpha

> Datos demo · no producción

SmartWaste se plantea como SaaS multiinstitución. Cada ayuntamiento opera dentro de su propio tenant lógico, con usuarios, rutas, camiones, sectores, paradas, incidencias, auditoría y notificaciones aisladas por `municipalityId`.

## Roles

- Master Admin MT IT Services: administra municipios, planes, onboarding, métricas agregadas y alertas globales.
- Administrador municipal: configura sectores, rutas, usuarios y flota.
- Supervisor: monitorea operación diaria, valida incidencias y verifica rutas.
- Conductor: inicia rutas, reporta avances e incidencias desde móvil.
- Ciudadano: consulta servicio y reporta incidencias públicas.

## Capas

1. Frontend estático Alpha para demostración.
2. Backend futuro con API REST/Realtime.
3. Supabase futuro para autenticación, base de datos, storage de evidencias y RLS.
4. Shared domain con modelos, estados y datos demo reutilizables.

## Entidades principales

Ayuntamiento, usuario, rol, camión, conductor, sector, ruta, parada, asignación, incidencia, auditoría, notificación y plan contratado.

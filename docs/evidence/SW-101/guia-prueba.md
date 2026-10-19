# SW-101 · Guía de prueba

1. Aplica en Supabase `supabase/migrations/202610190001_sw101_public_route_schedule.sql` (SQL Editor). Comprueba:
   `select m.name, public.public_route_schedule(m.id) from municipalities m where m.status in ('active','onboarding');`
2. Para que aparezcan rutas en el calendario deben tener hora de inicio o días definidos (se editan al crear/editar la ruta).
3. Abre Ciudadanía (barra lateral, cuarto ícono): mapa a pantalla completa, panel de camiones, calendario semanal y,
   sin camiones en ruta, "Próxima salida: …". Las horas son de República Dominicana.
4. Incidencias está ahora en el menú «⋯». Ahí viven "Reportar incidencia" y "Consultar estado" (solo personal del ayuntamiento).
5. Sin corrida real activa el mapa dice "Hoy aún no hay camiones en ruta". Con una corrida real (no de prueba) el camión se mueve cada 15 s.

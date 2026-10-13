# Traspaso a Hermes — SW-080: Plataforma de flotilla (SmartWaste)

> Para: equipo agéntico de Hermes · De: Miguel (Project Owner, MT IT Services) con Claude (coordinación y revisión)
> Repositorio: `mtitservices2005-blip/SmartWaste` · Fecha: 2026-10-12

## 1. Qué se pide

Implementar, en una sola corrida y sin rediseñar en el camino, la plataforma de flotilla para 5 camiones del Ayuntamiento de Laguna Salada: ingesta de posiciones desde la app Android, centro de control en vivo, métricas por camión/chofer/ruta, reporte semanal en PDF, rediseño de UX y endurecimiento de seguridad.

Todo el análisis y las decisiones ya están hechos y aprobados por Miguel. **No se re-decide arquitectura.** Si algo parece equivocado, se detiene y se escala (sección 6).

## 2. Documentos que deben leer antes de tocar nada (en este orden)

1. `CLAUDE.md` y `AGENTS.md` (reglas permanentes del repo; prevalecen sobre cualquier instrucción de este documento si hay conflicto).
2. `docs/KARPATHY_CONTEXT.md`.
3. `docs/superpowers/specs/2026-10-12-sw080-plataforma-flotilla-design.md` — la especificación (SDD). Fuente de verdad de requisitos y criterios de aceptación (CA-0xx-n).
4. `docs/superpowers/plans/2026-10-12-sw080-plataforma-flotilla.md` — el plan: 18 tareas, con interfaces, pruebas y comandos exactos. **Se ejecuta en el orden escrito.**
5. `docs/TECHNICAL_DEBT_REGISTER.md` (en especial #14: Realtime no es confiable, por eso el diseño usa polling) y `docs/RLS_SECURITY.md`.

Hasta que Miguel autorice el commit de la especificación y el plan (Task 0 del plan), las copias viven fuera del repo y se las entrega Miguel.

## 3. Reglas innegociables

1. Una rama y un PR por sub-hito (`feature/sw081-fleet-backend`, `sw082-design-system`, `sw083-driver-android`, `sw084-control-center`, `sw085-weekly-reports`, `sw086-load-field-tests`, `sw087-hardening`). Nunca sobre `main`.
2. **No hacer merge. No hacer push ni abrir PR sin autorización explícita de Miguel** (reglas 3 y 10 de `CLAUDE.md`). Se prepara la rama, se corre todo, y se detiene con el informe de la sección 5.
3. TDD: cada tarea empieza con la prueba que falla (ver su paso 1 y 2) y se demuestra con la salida real del comando.
4. Migraciones solo aditivas, en archivos nuevos `supabase/migrations/2026101200NN_sw08x_*.sql`. Nunca editar migraciones existentes.
5. Nunca `service_role` ni secretos en `frontend/`, `mobile/`, `dist/`, APK, logs ni en el chat. Si aparece uno real, **detenerse y notificar sin repetir el valor**.
6. No tocar datos reales de producción ni de staging con credenciales propias. Staging se verifica con la sesión de Miguel o con un municipio de prueba que él autorice.
7. Conservar el texto "Datos demo · no producción" en modo demo; no debe aparecer con backend real (Task 6).
8. No afirmar que algo funciona "de verdad" sin evidencia reproducible (comando y salida). Código o pruebas estáticas no son prueba de integración real (regla 6).
9. No modificar MTIT-OS ni repos relacionados (regla 4). No reescribir `frontend/app.js` con otro framework; las vistas nuevas van en módulos (`frontend/views/`, `frontend/components/`).
10. Alcance fijo: lo que no está en la especificación no se construye. Lo útil que se descubra se anota en el informe como "propuesta", no se implementa.

## 4. Orden de ejecución y compuertas

| Orden | Sub-hito | Tareas del plan | Quién cierra la compuerta |
|---|---|---|---|
| 0 | Preparación | Task 0 | Miguel autoriza commit de spec/plan y decide el merge del PR #92 |
| 1 | SW-081 Datos y backend | 1-3 | Miguel (revisa informe, autoriza push/PR); Claude revisa el PR |
| 2 | SW-082 Sistema de diseño | 4-6 | idem |
| 3 | SW-083 App Android | 7-10 | idem; Miguel carga keystore y secretos (Task 10) |
| 4 | SW-084 Centro de control | 11-13 | idem |
| 5 | SW-085 Métricas y reportes | 14-16 | idem |
| 6 | SW-086 Carga y campo | 17 | idem; Miguel hace la prueba de campo con 2 teléfonos |
| 7 | SW-087 Seguridad y despliegue | 18 | idem; Miguel actúa en los paneles de Supabase |

No se empieza un sub-hito hasta que el anterior tenga su compuerta cerrada, salvo que Miguel indique paralelizar explícitamente.

## 5. Informe obligatorio al cerrar cada sub-hito

Entregar a Miguel y a Claude (formato de pegar en el PR):

- Rama y commits (hashes).
- **Tabla de criterios de aceptación:** cada CA del sub-hito → estado (cumplido / no cumplido / no verificable aquí) → evidencia (comando y salida resumida).
- Salida de la suite completa: cada `tests/*.test.mjs` con `node`, uno por uno (como `.github/workflows/tests.yml`). Las 7 pruebas que requieren Supabase/Docker se marcan como "pendiente de CI" si el entorno no las puede correr, nunca como "pasó".
- Decisiones menores tomadas y por qué (si las hubo) y propuestas fuera de alcance.
- Qué falta que solo puede hacer Miguel.

Claude revisa el PR contra la especificación (revisión independiente) y verifica en staging con la sesión de Miguel cuando corresponda.

## 6. Cuándo detenerse y escalar (sin improvisar)

- Una prueba de la especificación no puede pasar sin cambiar el diseño.
- Una migración exigiría editar una existente, borrar datos o relajar una política RLS.
- Aparece un secreto real en el repo, en un log o en un artefacto.
- Los umbrales o nombres del plan chocan con el código existente.
- La complejidad real es mayor que la estimada y obliga a subir de alcance.
- Algo requiere credenciales, pagos, cambios de plan en proveedores o acciones en paneles externos (Supabase, Vercel, GitHub, Google Play): son de Miguel.

Escalar con: qué se intentó, qué falló, qué opciones hay y cuál se recomienda. Esperar respuesta; no seguir adelante en esa tarea.

## 7. Restricciones del entorno a tener presentes

- Supabase local y Docker pueden no estar disponibles para los agentes; en ese caso las pruebas de integración corren en CI (`integration-tests`) y en la PC de Miguel.
- OSRM y Overpass son servicios públicos sin SLA (deuda #18 y #22): no depender de ellos en pruebas automáticas.
- Zona horaria de reportes: `America/Santo_Domingo` (UTC-4, sin horario de verano), semana de lunes a domingo.
- Umbrales fijos: sin señal > 90 s; detenido < 1 m/s por más de 5 min; polling 5 s; lote máximo 200 puntos; retención 180 días (configurable; aprobado 2026-10-13).
- Textos de interfaz en español claro; contraste mínimo 4.5:1; objetivos táctiles de la app del chofer ≥ 48 px.

## 8. Qué NO está en el alcance (no construir)

Rastreadores GPS dedicados, app iOS, envío automático del reporte por correo/WhatsApp, reoptimización dinámica aplicada en vivo, catastro real, integración con el chatbot municipal, panel de onboarding de plataforma, reescritura del frontend con otro framework.

## 9. Definición de "terminado"

Los siete sub-hitos con su informe, todos los CA cumplidos o explícitamente marcados como pendientes de acción humana, `docs/GO_NO_GO.md` completo, y Miguel con la lista de acciones manuales cerradas (keystore, plan de Supabase con respaldos, registro público desactivado, prueba de campo).

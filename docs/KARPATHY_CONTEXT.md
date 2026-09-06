# Contexto local — Infraestructura Karpathy

Esta es la copia local mínima del contexto que SmartWaste necesita para trabajar cuando un agente remoto no puede leer el repositorio `MTIT-Blueprint`.

- Fuente oficial: [MTIT-Blueprint](https://github.com/mtitservices2005-blip/MTIT-Blueprint).
- Revisión central sincronizada: `0dc8d6eb75f0fe1e578b9e90b340378088aaf837`.
- Revisión de SmartWaste al sincronizar: `023f400` (`main`, PR #75).
- Fecha de sincronización: 2026-09-06.
- Estado: copia de consulta; no sustituye las reglas ni la evidencia local.

## Orden de autoridad

1. `CLAUDE.md`, el código, las migraciones, las pruebas y la evidencia vigente de SmartWaste.
2. `AGENTS.md` y la documentación local del área afectada.
3. Este contexto sincronizado.
4. La ficha central más reciente, cuando el entorno permita consultarla.

Si existe una contradicción, no cambies el producto para acomodarlo a esta copia. Registra la discrepancia y propone actualizar la fuente desactualizada.

## Propósito de la infraestructura

La Infraestructura Karpathy conserva contexto, decisiones y conocimiento reutilizable entre proyectos y agentes. El código y la documentación operativa permanecen en cada producto. No se copian a la memoria central secretos, credenciales, datos municipales, información personal ni registros crudos.

## Ficha resumida de SmartWaste

SmartWaste es una plataforma de seguimiento inteligente de recogida de residuos para municipios. Abarca operaciones municipales, rutas, flotilla, conductores, incidencias, portal ciudadano y métricas de cumplimiento e impacto.

Mapa del repositorio:

- `frontend/`: aplicación web, vistas operativas y modos demo/real.
- `shared/`: contratos, reglas de negocio, adaptadores, telemetría y rutas.
- `supabase/`: migraciones, RLS, persistencia, Storage y funciones de servidor.
- `backend/`: contratos y límites futuros; no implica un servicio independiente activo.
- `tests/`: pruebas locales e integraciones contra Supabase.
- `docs/`: estado, evidencia, seguridad, deuda y planes cercanos al código.

La revisión inicial de la infraestructura verificó pruebas locales y CI con Supabase en verde sobre `4216e1e`. Después se integraron el flujo Karpathy mediante PR #74 y la resolución real de incidencias mediante PR #75. Esto no certifica producción ni un piloto municipal; el estado operativo vigente debe confirmarse con las fuentes locales.

## Ciclo mínimo de trabajo

1. Registrar la revisión de SmartWaste y la revisión de este contexto consultadas.
2. Contrastar el contexto con el código y la documentación actual antes de actuar.
3. Trabajar en una rama dedicada por hito `SW-XXX` y validar proporcionalmente al riesgo.
4. Al cerrar una tarea con conocimiento duradero, usar `docs/KARPATHY_TASK_HANDOFF.md`.
5. Indicar qué debería actualizarse en `MTIT-Blueprint`, o justificar que no hay conocimiento central nuevo.
6. No declarar la memoria sincronizada hasta que exista un commit o PR real en el repositorio correspondiente.

## Continuidad sin acceso al Blueprint

La ausencia del repositorio central no bloquea el trabajo seguro. Usa esta copia, registra su revisión y deja la actualización central como propuesta en la entrega. Un agente con acceso a ambos repositorios realizará después la reconciliación.

Cuando `MTIT-Blueprint` esté disponible, comparar al menos:

- `AGENTS.md`
- `knowledge/index.md`
- `knowledge/standards/karpathy-workflow.md`
- `knowledge/projects/smartwaste/index.md`

## Riesgos documentales conocidos

- Algunos documentos históricos todavía describen componentes ya implementados como futuros o ausentes.
- El registro de deuda mezcla elementos resueltos con pendientes vigentes.
- La combinación intencional de datos demo y reales exige mantener siempre sus etiquetas y límites.

Verifica fecha, commit y evidencia antes de convertir cualquier afirmación histórica en trabajo nuevo.


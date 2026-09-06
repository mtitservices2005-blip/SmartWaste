# Instrucciones para agentes y desarrolladores

SmartWaste forma parte de la [Infraestructura Karpathy de MT IT Services](https://github.com/mtitservices2005-blip/MTIT-Blueprint).

## Autoridad local

- Lee `CLAUDE.md` antes de trabajar. Sus reglas permanentes gobiernan este repositorio y prevalecen ante cualquier resumen externo.
- Lee `docs/KARPATHY_CONTEXT.md`, copia local versionada del contexto mínimo para entornos sin acceso a `MTIT-Blueprint`.
- Consulta `README.md`, `docs/CURRENT_STATE_AUDIT.md`, `docs/TECHNICAL_DEBT_REGISTER.md` y la documentación específica del área afectada.
- Trata la ficha central de SmartWaste como contexto y orientación, no como sustituto del código ni de la evidencia local.

## Ciclo de trabajo

1. Confirma la revisión de `main` y la revisión de `docs/KARPATHY_CONTEXT.md`; consulta la ficha central más reciente cuando sea accesible.
2. Contrasta todo resumen con el código, las migraciones, las pruebas y los documentos actuales.
3. Trabaja en una rama dedicada, conforme a `CLAUDE.md`, y ejecuta las pruebas relevantes.
4. Al cerrar una tarea con conocimiento duradero, completa `docs/KARPATHY_TASK_HANDOFF.md` en la entrega o PR. No es necesario actualizar memoria por cambios triviales.
5. Propón la actualización de `MTIT-Blueprint`; no la declares integrada hasta que exista un commit o PR real allí.

## Límites

- No copies código, secretos, datos municipales, registros crudos ni credenciales a la infraestructura central.
- No conviertas decisiones exclusivas de SmartWaste en estándares corporativos sin aprobación.
- No cambies SmartWaste solo para hacerlo coincidir con una síntesis central desactualizada; registra la discrepancia y corrige la síntesis.
- Si el repositorio central no está disponible, usa `docs/KARPATHY_CONTEXT.md`, continúa el trabajo seguro y deja la actualización central como propuesta.

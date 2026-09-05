# Instrucciones para agentes y desarrolladores

SmartWaste forma parte de la [Infraestructura Karpathy de MT IT Services](https://github.com/mtitservices2005-blip/MTIT-Blueprint).

## Autoridad local

- Lee `CLAUDE.md` antes de trabajar. Sus reglas permanentes gobiernan este repositorio y prevalecen ante cualquier resumen externo.
- Consulta `README.md`, `docs/CURRENT_STATE_AUDIT.md`, `docs/TECHNICAL_DEBT_REGISTER.md` y la documentación específica del área afectada.
- Trata la ficha central de SmartWaste como contexto y orientación, no como sustituto del código ni de la evidencia local.

## Ciclo de trabajo

1. Confirma la revisión de `main` y la revisión de la ficha central consultadas.
2. Contrasta todo resumen con el código, las migraciones, las pruebas y los documentos actuales.
3. Trabaja en una rama dedicada, conforme a `CLAUDE.md`, y ejecuta las pruebas relevantes.
4. Al cerrar una tarea con conocimiento duradero, completa `docs/KARPATHY_TASK_HANDOFF.md` en la entrega o PR. No es necesario actualizar memoria por cambios triviales.
5. Propón la actualización de `MTIT-Blueprint`; no la declares integrada hasta que exista un commit o PR real allí.

## Límites

- No copies código, secretos, datos municipales, registros crudos ni credenciales a la infraestructura central.
- No conviertas decisiones exclusivas de SmartWaste en estándares corporativos sin aprobación.
- No cambies SmartWaste solo para hacerlo coincidir con una síntesis central desactualizada; registra la discrepancia y corrige la síntesis.
- Si la infraestructura no está disponible, continúa el trabajo seguro con las fuentes locales y deja constancia de la limitación.


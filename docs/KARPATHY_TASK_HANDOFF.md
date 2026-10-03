# Entrega de conocimiento — Infraestructura Karpathy

Usa estas preguntas al cerrar una tarea que produzca una decisión, un cambio de estado o una lección duradera. La respuesta puede incluirse en el PR o en la entrega de la tarea; no se completa este archivo con datos de cada ejecución.

- Fecha, hito y tarea:
- Revisión de SmartWaste utilizada:
- Revisión o ficha de la infraestructura consultada:
- Decisión, resultado o lección duradera:
- Evidencia reproducible:
- Límites de la evidencia y pendientes:
- Información excluida por privacidad o seguridad:
- Página de `MTIT-Blueprint` que debería actualizarse, o motivo por el que no hace falta:
- Estado: sin actualización necesaria | propuesta | publicada en rama | integrada
- Commit o PR, si existe:
- Próximo paso:

---

## Propuesta de entrega — SW-070 (2026-10-03)

- Fecha, hito y tarea: 2026-10-03; SW-070, provisión municipal piloto reanudable por invitación.
- Revisión de SmartWaste utilizada: `4ea60c2d7e993f924d908bf5929727fdd1d0715d` (`main`) antes de abrir la rama SW-070.
- Revisión o ficha de la infraestructura consultada: `docs/KARPATHY_CONTEXT.md`, revisión central registrada `0dc8d6eb75f0fe1e578b9e90b340378088aaf837`.
- Decisión, resultado o lección duradera: la provisión remota conserva el estado parcial, reconsulta municipio y Auth en cada paso, y termina por upsert de perfil/membresía; no hace rollback ni imprime valores sensibles. El reenvío de invitación exige una opción explícita.
- Evidencia reproducible: `node tests/sw070-resumable-provisioning.test.mjs` usa un cliente simulado y cubre fallos tras crear municipio y tras invitar Auth, reintentos sin reinvitar y roles de equipo; las simulaciones CLI de municipio y archivo local se ejecutan sin crear cliente ni escribir. La matriz unitaria de 31 archivos y las 8 pruebas de integración local de Supabase terminaron con salida 0.
- Límites de la evidencia y pendientes: no se usó Supabase remoto, Vercel, credenciales ni identidades de un piloto; el despliegue y la ejecución real quedan para el operador autorizado.
- Información excluida por privacidad o seguridad: correos reales, URLs, claves, tokens, contraseñas, enlaces de invitación y datos municipales.
- Página de `MTIT-Blueprint` que debería actualizarse, o motivo por el que no hace falta: proponer el patrón reanudable y el runbook al cerrar el PR; no se declara publicado fuera de SmartWaste.
- Estado: propuesta.
- Commit o PR, si existe: pendiente de PR.
- Próximo paso: revisión y aprobación del PR; el operador ejecuta el runbook en staging.


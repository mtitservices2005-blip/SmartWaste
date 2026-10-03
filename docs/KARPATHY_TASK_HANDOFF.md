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
- Decisión, resultado o lección duradera: la provisión remota conserva el estado parcial, reconsulta municipio y Auth en cada paso, y termina por upsert de perfil/membresía; no hace rollback ni imprime valores sensibles. El reenvío de invitación exige una opción explícita. El alta de un `driver` no debe usar `maybeSingle()` sobre `(municipality_id, display_name)`: la tabla `drivers` no garantiza unicidad de esa combinación y dos homónimos romperían el alta; la búsqueda por nombre debe ser una consulta de colección que reutiliza/vincule solo una fila sin `profile_id` y cree una nueva cuando las homónimas ya pertenecen a otros perfiles.
- Excepción autorizada a la regla 2 de `CLAUDE.md`: SW-070, SW-071 y SW-072 permanecen juntos en la rama `feature/sw070-lanzamiento` y en un **único PR**, porque los tres specs declaran expresamente esa rama compartida (`specs/SW-070.md`, `specs/SW-071.md` y `specs/SW-072.md` indican `feature/sw070-lanzamiento`; SW-071 y SW-072 la citan como "misma de SW-070"). Es una excepción explícita a la regla 2 de `CLAUDE.md` ("una rama por hito"), aprobada por Miguel (Project Owner) el 3 de octubre de 2026. No se altera `CLAUDE.md` ni el contenido de `specs/SW-071.md` / `specs/SW-072.md`.
- Evidencia reproducible: `node tests/sw070-resumable-provisioning.test.mjs` usa un cliente simulado y cubre fallos tras crear municipio y tras invitar Auth, reintentos sin reinvitar, roles de equipo, y el fallback de `drivers` con homónimos múltiples (dos filas homónimas ajenas → se crea una tercera sin tocar las originales; varios homónimos con una fila sin `profile_id` → se vincula esa sola fila sin crear otra). La matriz unitaria que ejecuta la CI reproduce así el job `unit-tests` de `.github/workflows/tests.yml` (cada `tests/*.test.mjs` con `node`, saltando los 8 archivos del `skip_list`) y a la fecha de esta ronda (2026-10-03) da **33 PASS / 0 FAIL**, incluyendo `tests/sw070-dry-run.test.mjs`:
  ```sh
  skip_list="tests/rls-adversarial.test.mjs tests/operational-cycle.test.mjs tests/telemetry-persistence.test.mjs tests/telemetry-realtime-diagnosis.test.mjs tests/route-stops-persistence.test.mjs tests/route-paths-persistence.test.mjs tests/rls-coverage.test.mjs tests/gps-route-metrics.test.mjs"
  for f in tests/*.test.mjs; do
    case " $skip_list " in *" $f "*) continue;; esac
    node "$f"
  done
  # Resultado: 33 PASS / 0 FAIL
  ```
- Límites de la evidencia y pendientes: las **8 pruebas de integración local de Supabase** (los mismos 8 archivos del `skip_list`: `rls-adversarial`, `rls-coverage`, `operational-cycle`, `telemetry-persistence`, `gps-route-metrics`, `route-stops-persistence`, `route-paths-persistence` y el diagnóstico `telemetry-realtime-diagnosis`) quedan **PENDIENTES de validación en la CI de GitHub** (job `integration-tests`, que necesita Docker) antes del PR/merge; no se ejecutaron en esta sesión y **no se declaran completadas**. No se usó Supabase remoto, Vercel, credenciales ni identidades de un piloto; el despliegue y la ejecución real quedan para el operador autorizado.
- Información excluida por privacidad o seguridad: correos reales, URLs, claves, tokens, contraseñas, enlaces de invitación y datos municipales.
- Página de `MTIT-Blueprint` que debería actualizarse, o motivo por el que no hace falta: proponer el patrón reanudable y el runbook al cerrar el PR; no se declara publicado fuera de SmartWaste.
- Estado: propuesta.
- Commit o PR, si existe: pendiente de PR.
- Próximo paso: revisión y aprobación del PR; el operador ejecuta el runbook en staging.


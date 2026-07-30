# Revisión de límite con MTIT-OS

> Datos demo · no producción. Basado en inspección de solo lectura del repositorio SmartWaste (2026-07-29). No se inspeccionó ningún repositorio de MTIT-OS — está fuera del alcance de esta auditoría y de este repo.

## Estado actual del acoplamiento

No hay ningún acoplamiento de código entre SmartWaste y MTIT-OS hoy. La única referencia a integración externa en todo el repo es al futuro "Chatbot Municipal", y el propio repo deja constancia explícita de que esta línea de trabajo **no tocó ningún otro repositorio**:

> "This mission did not modify the ayuntamiento-Chatbot repository." — `docs/CHATBOT_MUNICIPAL_CONTRACT.md:3`

## Qué existe hoy, pensado para una integración futura

- `shared/channel-contracts.js` define intents independientes de canal (web, WhatsApp Business Platform, Chatbot Municipal, interno, y "futuros"), con casos de uso: horario de recolección, recolección perdida, reporte de vertido ilegal, estado de reporte, estado de retraso por sector. Es una capa de contrato, no una integración: no hay ningún cliente HTTP, webhook, ni SDK de un sistema externo importado en el repo.
- `frontend/app.js` incluye una nota de UI: "Futura relación... Preparado para Chatbot Municipal" — lenguaje de intención, no de implementación.
- **Corrección (revisión del PR #7):** `shared/citizen-portal.js` y `shared/channel-contracts.js` existen como **módulos independientes entre sí**, no conectados. `shared/citizen-portal.js` solo importa de `shared/demo-data.js` (`citizen-portal.js:1`) — no importa ni usa nada de `channel-contracts.js`. Verificado además que **el frontend no conecta las acciones del portal con ninguno de los dos módulos de la forma esperada**: `frontend/app.js` no importa `shared/citizen-portal.js` en absoluto (la generación de folio en la UI es un número aleatorio inline, `app.js:175`, y la búsqueda de sector/incidencia también es lógica inline, `app.js:167` — ninguna usa `createDemoFolio`/`findSectorService`/`findIncidentStatus`); lo único que `app.js` sí importa de `channel-contracts.js` es la función puntual `validateEvidenceFile` (`app.js:4`), no el sistema de intents. En resumen: la integración futura entre portal ciudadano, contratos de canal y Chatbot Municipal **sigue pendiente en los tres niveles** (UI↔citizen-portal.js, citizen-portal.js↔channel-contracts.js, y channel-contracts.js↔un sistema externo real). No existe todavía ninguna conexión real con MTIT-OS ni con el Chatbot Municipal.

## Qué falta para que la integración exista de verdad

- Ningún endpoint, webhook o mecanismo de autenticación entre SmartWaste y un sistema MTIT-OS/Chatbot está definido ni en `shared/`, ni en `backend/` (que no tiene código de servidor en absoluto).
- No hay documentación de qué datos cruzarían el límite, con qué formato, ni bajo qué controles de tenancy — algo especialmente relevante dado que SmartWaste es multi-institución y cualquier integración externa tendría que respetar el mismo aislamiento por `municipality_id` que hoy está solo parcialmente resuelto internamente (ver huecos de RLS en `docs/CURRENT_STATE_AUDIT.md`).
- No existe un acuerdo de contrato versionado (ni siquiera un borrador de esquema JSON/OpenAPI) para los intents de `channel-contracts.js` — son objetos JS internos, no un contrato publicado que otro sistema pueda consumir hoy.

## Recomendación de límite (boundary)

1. **No modificar ni depender de código de MTIT-OS desde este repo** — ya se cumple hoy y debe mantenerse como regla permanente (incorporada en `CLAUDE.md`).
2. Cuando se decida avanzar con la integración real del Chatbot Municipal, tratarla como un hito propio (no mezclado con trabajo de SmartWaste core), con: (a) definición explícita de qué expone SmartWaste hacia afuera vs qué consume, (b) autenticación/autorización específica para el canal externo (nunca reutilizar `service_role` de Supabase para esto — mismo principio que ya aplica `docs/TELEMETRY_SECURITY.md` a los trackers GPS), (c) revisión de tenancy antes de exponer cualquier dato cruzando el límite.
3. Hasta entonces, `shared/channel-contracts.js` puede seguir evolucionando como contrato interno, pero cualquier claim de "integración con MTIT-OS" debe seguir clasificado como `PLACEHOLDER` — no hay evidencia de ningún tipo de conexión real.

## Respuesta del Project Owner (2026-07-29)

"Sí, pero solo para definir límites y contratos, no para copiar arquitectura o código." Confirmado: existe documentación/referencia del lado de MTIT-OS/Chatbot Municipal, pero su uso está limitado estrictamente a definir el contrato de intercambio (qué datos cruzan el límite, en qué formato, bajo qué autenticación) — no a replicar patrones de arquitectura ni código de ese sistema dentro de SmartWaste. Esto refuerza la regla 4 de `CLAUDE.md` ("no modificar MTIT-OS"): la consulta de esa documentación es válida y esperada para diseñar el contrato del punto 2 de la recomendación de límite; copiar su código o arquitectura no lo es.

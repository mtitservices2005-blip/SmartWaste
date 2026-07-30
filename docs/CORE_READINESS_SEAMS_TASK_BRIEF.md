# Brief de cierre para Claude Code (LabPC) — rama docs/core-readiness-seams

> Preparado 2026-07-30. Complementa `docs/CORE_READINESS_REVIEW.md` y `docs/SW020_CLAUDE_CODE_TASK_BRIEF.md`. Este documento es autocontenido; no depende del historial de la conversación que lo generó.

## Contexto

Sobre `main` (ya con auditoría + SW-020 + Core-readiness review mergeados), se creó la rama `docs/core-readiness-seams` con cambios locales sin commitear:

- `shared/core-ports.js` (nuevo): `createIdentityProvider()` y `createMunicipalityScope()`, delegación pura sobre `shared/auth-context.js` — no reimplementa lógica, solo la envuelve.
- `tests/core-ports.test.mjs` (nuevo): valida la delegación con un cliente Supabase simulado (mock), no requiere Supabase real.
- Comentarios de referencia (sin cambiar lógica) agregados en `shared/operations-adapter.js` y `shared/auth-context.js` apuntando a `docs/CORE_READINESS_REVIEW.md`.

Estos cambios se probaron en un sandbox sin Docker: los 13 tests originales + `tests/core-ports.test.mjs` (14/14) pasan. **No se pudieron correr** `tests/rls-adversarial.test.mjs` ni `tests/operational-cycle.test.mjs` (requieren `npx supabase start`). El cambio es aditivo — no debería afectarlos — pero por la regla 6 de `CLAUDE.md` (no afirmar sin evidencia) no se puede dar por bueno sin correrlos de verdad.

## Alcance de este cierre

1. Verificar que la rama `docs/core-readiness-seams` existe en el checkout local de LabPC con los cambios descritos arriba. Si no están (por ejemplo si se trabaja desde un checkout distinto), aplicar los mismos 4 cambios de archivo antes de continuar — el contenido completo de `shared/core-ports.js` y `tests/core-ports.test.mjs` debe coincidir exactamente con lo que ya se probó (ver detalle abajo si hace falta recrearlos).
2. `npx supabase start` (si no está corriendo) y correr los 15 archivos de `tests/` como procesos `node` independientes, incluyendo los 2 que requieren Supabase real. Confirmar 15/15 (más `core-ports.test.mjs` = 16/16 si se cuenta aparte).
3. Si todo pasa: `git add shared/core-ports.js tests/core-ports.test.mjs shared/operations-adapter.js shared/auth-context.js docs/CORE_READINESS_SEAMS_TASK_BRIEF.md` (no agregar `.claude/` ni ruido de fin de línea de otros archivos) y commitear con un mensaje que describa el seam y cite el resultado real de los 2 tests de integración (comando + resultado, regla 6).
4. Si algo falla: no forzar el commit. Reportar el fallo tal cual (no es esperable dado que el cambio es aditivo, pero hay que confirmarlo, no asumirlo).
5. Detenerse antes de `git push` o crear PR sin autorización explícita del Project Owner (regla 10) — igual que en SW-020.

## Fuera de alcance

No tocar `channel-contracts.js`, no resolver la ambigüedad de "sectores" (ambas quedan para más adelante, ver `docs/CORE_READINESS_REVIEW.md`), no empezar CI/CD ni login de frontend todavía — son los próximos hitos, cada uno en su propia rama.

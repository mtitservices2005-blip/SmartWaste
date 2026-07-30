# Brief de cierre para Claude Code (LabPC) — fijar versión del CLI de Supabase en CI

> Preparado 2026-07-30. Autocontenido. Responde al hallazgo del bot de revisión (Codex) en PR #11: `npx supabase start`/`stop` sin versión fijada dependen de la última versión publicada del CLI en cada corrida — un release nuevo de Supabase podría romper un commit que hoy pasa, sin que nadie tocó el código.

## Contexto

Sobre `main` (ya con seams, CI/CD y login/gating mergeados), se creó la rama `chore/pin-supabase-cli` con estos cambios locales sin commitear:

- `package.json`: agrega `"supabase": "2.110.0"` (pin exacto, sin `^`) como devDependency — misma versión que se usó en toda la verificación real de este proyecto hasta ahora (SW-020, seams, login/gating).
- `.github/workflows/tests.yml`: el job `integration-tests` pasa de `npm install` a `npm ci` (reproducible desde `package-lock.json`) y agrega un comentario explicando por qué.

**Lo que falta y no se puede hacer en el sandbox que preparó esto (sin acceso al registro de npm):**

1. Correr `npm install` en el checkout local para que `package-lock.json` incluya la entrada de `supabase@2.110.0` (hoy el lockfile no la tiene todavía).
2. Confirmar que `npx supabase --version` después de ese `npm install` resuelve al binario local pineado (`2.110.0`) sin pegarle a la red — se puede verificar comparando el tiempo de respuesta/con `npm ls supabase` mostrando la versión exacta.
3. Correr `npm ci` (no `npm install`) una vez para confirmar que funciona igual que `npm install` con el lockfile ya actualizado — así se sabe que el workflow (que usa `npm ci`) va a funcionar en un runner limpio.
4. Re-correr la suite completa (17 archivos, cada uno como proceso `node` independiente, incluidos `tests/rls-adversarial.test.mjs` y `tests/operational-cycle.test.mjs` contra `npx supabase start`) para confirmar que fijar la versión no rompió nada.
5. Si todo pasa: `git add package.json package-lock.json .github/workflows/tests.yml docs/PIN_SUPABASE_CLI_TASK_BRIEF.md` y commitear citando el resultado real (regla 6 de `CLAUDE.md`).
6. Detenerse antes de `git push`/PR sin autorización explícita del Project Owner (regla 10) — igual que en los hitos anteriores.

## Fuera de alcance

No actualizar la versión del CLI a algo más nuevo que 2.110.0 en este hito (eso sería un cambio de comportamiento a verificar aparte, no solo pinning). No tocar el job `unit-tests` (no usa Supabase). No tocar ningún otro archivo.

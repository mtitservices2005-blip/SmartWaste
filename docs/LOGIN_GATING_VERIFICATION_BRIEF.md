# Brief de verificación interactiva — login + gating (frontend/auth-gate.js)

> Preparado 2026-07-30. Autocontenido, no depende del historial de la conversación que lo generó. Complementa `docs/FRONTEND_LOGIN_SETUP.md`.

## Por qué este brief existe

`frontend/auth-gate.js` (nuevo) conecta `resolveSupabaseAuthContext()`/`createIdentityProvider()` (ya `VERIFIED_REAL` desde SW-020 y Core-readiness seams) a un login real y gating de secciones en el frontend. `tests/auth-gate.test.mjs` solo prueba la lógica pura (qué rol ve qué sección, lectura de `window.SMARTWASTE_SUPABASE_CONFIG`) con Node — **no toca un navegador real ni un login real contra Supabase**. Por la regla 6 de `CLAUDE.md`, no se puede clasificar esto como `VERIFIED_REAL` sin ejecutarlo de verdad. Esta verificación necesita un navegador, así que no se pudo hacer en el entorno que escribió el código.

## Prerrequisito

`npx supabase start` corriendo (Docker), igual que en SW-020.

## Paso 1 — Confirmar que el comportamiento por defecto no cambió (regla 5)

1. Abrir `frontend/index.html` en un navegador **sin** modificar nada.
2. Confirmar que se ven las 5 secciones (mapa, municipal, ciudadanía, impacto, master admin) exactamente como antes, sin ningún formulario de login ni overlay.
3. Si aparece cualquier overlay o cambia el comportamiento sin haber configurado `window.SMARTWASTE_SUPABASE_CONFIG`, es un bug — reportarlo, no continuar con los pasos siguientes hasta corregirlo.

## Paso 2 — Sembrar usuarios de prueba para los 5 roles

`tests/integration/seed.mjs` (usado por SW-020) crea `municipal_admin`, `dispatcher` y `driver`, pero **no** crea `supervisor` ni `mt_superadmin` — hacen falta para probar el gating completo (`frontend/auth-gate.js`'s `SECTION_ROLES` cubre los 5 roles). Opciones:
- Extender `tests/integration/seed.mjs` de forma aditiva (agregar `supervisorA` y un usuario `mt_superadmin` sin `municipality_id`, análogo a `createUserWithProfile`) — recomendado, queda reutilizable para el futuro.
- O crear un script aparte de un solo uso para esta verificación, sin commitear cambios a `seed.mjs`.

Cualquiera de las dos es válida; si se opta por extender `seed.mjs`, correr de nuevo `tests/rls-adversarial.test.mjs` y `tests/operational-cycle.test.mjs` después para confirmar que no se rompió nada (usan `seedScenario`).

## Paso 3 — Configurar el frontend y probar cada rol

1. Agregar en `frontend/index.html` (antes del `<script type="module" src="./app.js">`), usando `API_URL`/`ANON_KEY` de `npx supabase status`:
   ```html
   <script>
     window.SMARTWASTE_SUPABASE_CONFIG = { url: 'http://127.0.0.1:54321', anonKey: '...' };
   </script>
   ```
2. Recargar la página. Debe aparecer el formulario de login (overlay) antes de ver cualquier sección.
3. Para cada rol sembrado, iniciar sesión con su email/password y confirmar que se ven exactamente las secciones que dice la tabla de `docs/FRONTEND_LOGIN_SETUP.md`:
   - `driver` → mapa, municipal, ciudadanía (no impacto, no master).
   - `dispatcher` → mapa, municipal, ciudadanía (no impacto, no master).
   - `supervisor` → mapa, municipal, impacto, ciudadanía (no master).
   - `municipal_admin` → mapa, municipal, impacto, ciudadanía (no master).
   - `mt_superadmin` → master, ciudadanía únicamente (no mapa, no municipal, no impacto).
4. Probar credenciales inválidas (contraseña incorrecta): debe mostrar "Credenciales inválidas." y no dejar pasar.
5. Probar el link "Ir al portal ciudadano sin iniciar sesión": debe cerrar el overlay y dejar visible solo `#ciudadania`.
6. Recargar la página estando logueado (sesión persistida por `supabase-js`): debe saltear el formulario y aplicar el gating directo, sin pedir login de nuevo.

## Qué hacer con el resultado

- Si todo funciona como se describe: actualizar `docs/CURRENT_STATE_AUDIT.md` (fila "Control de acceso por rol en UI") a `VERIFIED_REAL` citando esta verificación, y quitar la advertencia de "pendiente" en `docs/FRONTEND_LOGIN_SETUP.md`.
- Si algo falla: no reclasificar nada, reportar el fallo concreto (qué paso, qué se esperaba, qué pasó) para corregirlo antes de abrir PR.
- Esto no reemplaza la regla 10: no commitear/pushear/abrir PR sin autorización explícita del Project Owner.

## Fuera de alcance

No construir la vista supervisor ni la vista móvil de conductor (siguen pospuestas). No conectar esto a un Supabase remoto/de producción. No exponer nunca la `service_role key` en `frontend/`.

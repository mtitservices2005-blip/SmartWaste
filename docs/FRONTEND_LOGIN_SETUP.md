# Login y gating por rol en el frontend

> Datos demo · no producción. Introducido junto con `frontend/auth-gate.js` (primer consumidor real de `createIdentityProvider()`, ver `docs/CORE_READINESS_REVIEW.md`).

## Comportamiento por defecto: sin cambios

Si no se configura nada, `frontend/index.html` se comporta exactamente igual que antes de este cambio: todas las secciones (mapa, municipal, ciudadanía, impacto, master admin) se muestran a cualquier visitante, sin login. Esto es intencional (regla 5 de `CLAUDE.md`: no romper la demo aprobada) — el gate es enteramente opt-in.

## Cómo activarlo

Agregar, antes de `<script type="module" src="./app.js">` en `frontend/index.html`, algo como:

```html
<script>
  window.SMARTWASTE_SUPABASE_CONFIG = {
    url: 'http://127.0.0.1:54321',   // API_URL de `npx supabase status`
    anonKey: 'eyJ...'                 // ANON_KEY de `npx supabase status` — NUNCA la service_role key
  };
</script>
```

Con esto configurado, al cargar la página aparece un formulario de login antes de mostrar cualquier sección municipal. Un correo/contraseña válidos contra ese proyecto Supabase (ver `tests/integration/seed.mjs` para cómo se siembran usuarios de prueba localmente) resuelven el rol vía `resolveSupabaseAuthContext()` y solo se muestran las secciones permitidas.

## Qué sección ve cada rol

Definido en `frontend/auth-gate.js` (`SECTION_ROLES`), validado sin necesidad de navegador en `tests/auth-gate.test.mjs`:

| Rol | Secciones visibles |
|---|---|
| (sin sesión / ciudadano) | Portal ciudadano únicamente |
| `driver` | Mapa, vista de conductor (propia, ruta asignada + reporte de incidencias), portal ciudadano — no ve el panel municipal genérico |
| `dispatcher` | Mapa, panel municipal, portal ciudadano |
| `supervisor` | Mapa, panel de supervisor (propio, verificación de rutas + incidencias), impacto y ahorros, portal ciudadano — no ve el panel municipal genérico |
| `municipal_admin` | Mapa, panel municipal, impacto y ahorros, portal ciudadano |
| `mt_superadmin` | Master Admin, portal ciudadano |

El portal ciudadano (`#ciudadania`) es siempre público — coincide con la política `anon_insert_citizen_report` de `supabase/migrations/202607150006_sw020_rls_fixes.sql`, pensada para reportes anónimos.

## Seguridad

Solo se usa la `anon key` (pensada para ser pública; RLS es lo que protege los datos, no este archivo). Nunca poner la `service_role key` acá — regla 8 de `CLAUDE.md`.

## Verificación interactiva (2026-07-30)

Verificado en navegador real contra Supabase local (LabPC), ver `docs/LOGIN_GATING_VERIFICATION_BRIEF.md` y la fila "Control de acceso por rol en UI" de `docs/CURRENT_STATE_AUDIT.md` para el detalle y la evidencia completa:

- Sin `SMARTWASTE_SUPABASE_CONFIG`, `frontend/index.html` se ve y funciona exactamente igual que antes (regla 5) — confirmado.
- Con la config apuntando a Supabase local, el login real funciona para los 5 roles (`tests/integration/seed.mjs` ahora siembra los 5, incluidos `supervisor` y `mt_superadmin`) y el gating de secciones se aplica visualmente como en la tabla de arriba.
- Credenciales inválidas muestran el error y no dejan pasar; la sesión persiste entre recargas.

Clasificado `VERIFIED_REAL` en `docs/CURRENT_STATE_AUDIT.md` (regla 6).

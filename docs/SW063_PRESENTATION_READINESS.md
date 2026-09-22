# SW-063 — Entorno estable para presentación

Estado: implementación en rama apilada sobre SW-062; no certifica todavía un despliegue remoto.

## Objetivo

Publicar una versión candidata de SmartWaste en una URL HTTPS persistente, conectada a un proyecto Supabase exclusivo para la presentación. El entorno debe usar datos reales controlados, ocultar los datos demo y detectar una configuración incompleta antes de publicarse.

## Arquitectura acordada

- Rama de código: `feature/sw063-presentation-readiness`, dependiente de SW-062 mientras PR #81 siga abierta.
- Rama persistente de despliegue: se definirá al configurar Vercel; no es `main`.
- Backend: proyecto Supabase exclusivo para presentación, nunca Supabase local ni producción futura.
- URL: dominio HTTPS fijo de presentación.
- Datos: municipio y cuentas controladas; no se guardan secretos ni contraseñas en git.

## Variables del despliegue

| Variable | Valor esperado |
|---|---|
| `SMARTWASTE_REQUIRE_BACKEND` | `true` |
| `SUPABASE_URL` | URL HTTPS del Supabase de presentación |
| `SUPABASE_ANON_KEY` | clave pública `anon`; nunca `service_role` |
| `SUPABASE_MUNICIPALITY_ID` | UUID del municipio preparado |
| `SUPABASE_HIDE_DEMO` | `true` |

El comando de verificación recibe además `PRESENTATION_URL`, `PRESENTATION_EMAIL` y `PRESENTATION_PASSWORD` en la terminal. La cuenta debe ser un `municipal_admin`, `dispatcher` o `supervisor` activo del municipio. La contraseña nunca se guarda en archivos ni se pasa por chat.

Con `SMARTWASTE_REQUIRE_BACKEND=true`, el build falla si falta URL, clave pública o municipio. También rechaza una URL Supabase sin HTTPS. El comportamiento local/demo existente se mantiene cuando la variable no está activa.

## Verificación previa a cada ensayo

Configurar además `PRESENTATION_URL` en la terminal y ejecutar:

```bash
npm run verify:presentation
```

La verificación es de solo lectura y usa únicamente la clave pública. Comprueba:

1. salud de Supabase Auth;
2. presencia de las columnas de métricas GPS de SW-062;
3. relación de puntos GPS con `route_run_id`;
4. existencia de al menos un sector activo del municipio, visible para el portal ciudadano;
5. login y membresía operativa de la cuenta de ensayo;
6. presencia de al menos un vehículo, chofer y ruta;
7. disponibilidad de la URL pública;
8. que el build público apunte al Supabase esperado y tenga los datos demo ocultos.

Pasar este comando no prueba el flujo funcional ni certifica producción. El ensayo final requiere un teléfono real: login de chofer, permiso de ubicación, inicio, movimiento, finalización, recarga y confirmación de ruta y métricas persistidas.

## Aprovisionamiento controlado

`npm run provision:presentation` crea de forma idempotente un tenant claramente identificado como
presentación: municipio, administrador, chofer, vehículo, asignación, sector, ruta y tres paradas.
Las rutas, sectores y paradas incluyen “ensayo” en su nombre para no presentarlos como operación
municipal real. El script no elimina datos y no imprime contraseñas.

Debe ejecutarlo el propietario desde su propia terminal, con las variables sensibles cargadas en el
entorno. Además de URL, `service_role`, correos y contraseñas de las dos cuentas, exige:

- `SUPABASE_EXPECTED_PROJECT_REF`, que debe coincidir con el host de Supabase;
- `SMARTWASTE_PRESENTATION_CONFIRM=PROVISION_<project-ref>_LAGUNA_SALADA`;
- contraseñas distintas de al menos 12 caracteres;
- `PRESENTATION_ROTATE_PASSWORDS=true` solo cuando se desea rotar cuentas que ya existen.

Nunca se debe colocar `SUPABASE_SERVICE_ROLE_KEY` en Vercel, el frontend, un teléfono, git o un chat.
Al terminar, el comando imprime únicamente el UUID del municipio que debe copiarse directamente a
`SUPABASE_MUNICIPALITY_ID` en Vercel.

## Interfaz de login

La interfaz ya existe en `frontend/auth-gate.js` y se activa cuando el build contiene URL y clave
`anon` válidas. Usa email/contraseña de Supabase, resuelve membresía y rol, limita las secciones,
conserva sesión, permite cerrar sesión y obliga a sustituir credenciales marcadas como temporales.
El `service_role` no interviene nunca en el navegador. Las cuentas creadas por el aprovisionador son
exclusivas del entorno controlado y permiten probar por separado la vista administrativa y el flujo
GPS del chofer.

## Criterios de salida

- CI verde sobre SW-063 y su base SW-062.
- URL persistente accesible desde computadora y teléfono.
- Verificación técnica `READY` ejecutada contra el entorno remoto.
- Ensayo funcional GPS documentado con fecha, dispositivo y resultado.
- Dataset controlado y procedimiento de restauración probado.
- Versión candidata congelada y despliegue anterior disponible para rollback.

## Pendientes que requieren acceso del propietario

- Elegir o crear los proyectos Vercel y Supabase de presentación.
- Configurar las variables sin compartir secretos por chat.
- Aplicar migraciones y desplegar Edge Functions.
- Preparar el dataset controlado y definir su política de restablecimiento.
- Ejecutar el ensayo GPS en el dispositivo físico.

## Entrega Karpathy

- Fecha/hito: 2026-09-21, SW-063.
- Revisión base: SW-062 `8103c30`, basada en `main` `a2de661`.
- Contexto consultado: `docs/KARPATHY_CONTEXT.md`, revisión central registrada `0dc8d6e`.
- Decisión duradera: los builds de presentación deben fallar cerrados mediante `SMARTWASTE_REQUIRE_BACKEND=true`; los builds locales/demo conservan el fallback existente.
- Evidencia reproducible: `node tests/presentation-readiness.test.mjs` y, contra el entorno remoto, `npm run verify:presentation`.
- Límites: todavía no hay evidencia de despliegue remoto ni prueba física GPS dentro de SW-063.
- Información excluida: claves, contraseñas, tokens y datos municipales reales.
- Actualización sugerida en MTIT-Blueprint: registrar SW-063 como release candidate de presentación cuando exista evidencia remota.
- Estado de actualización central: propuesta.

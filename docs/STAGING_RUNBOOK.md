# Runbook de staging y provisión piloto — SW-070

Este procedimiento lo ejecuta Miguel o un operador autorizado desde una terminal protegida. No pegar claves, tokens, enlaces de invitación, contraseñas, valores de variables ni identidades reales en chats, tickets, capturas, logs o commits. Esta rama no despliega ni cambia Supabase/Vercel remotos.

## Variables por nombre

| Ámbito | Variables |
| --- | --- |
| Build de staging | `SUPABASE_URL`, `SUPABASE_ANON_KEY`; **obligatorio** `SUPABASE_BUILD_STRICT=true` |
| Configuración opcional del frontend | `SUPABASE_MUNICIPALITY_ID`, `SUPABASE_HIDE_DEMO` |
| Provisión desde terminal protegida | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

`SUPABASE_SERVICE_ROLE_KEY` solo existe en el proceso local del operador para ejecutar el CLI. Nunca se configura en Vercel ni llega al navegador.

## Despliegue de staging (operador)

1. Validar localmente los tests indicados al final y revisar que el diff no contiene secretos.
2. Vincular **solo** el proyecto de staging y revisar migraciones antes de escribir:

   ```sh
   npx supabase login
   npx supabase link --project-ref <STAGING_PROJECT_REF>
   npx supabase db push --dry-run
   npx supabase db push
   ```

   No usar `supabase db reset` contra staging. Detenerse si el plan no coincide con las migraciones versionadas.
3. En Vercel staging, configurar por interfaz o CLI `SUPABASE_URL` y `SUPABASE_ANON_KEY`; configurar las dos variables opcionales únicamente si el piloto lo necesita. **Paso obligatorio de Miguel:** en el Environment de **staging de Vercel** definir además `SUPABASE_BUILD_STRICT=true` (junto con `SUPABASE_URL` y `SUPABASE_ANON_KEY`). Sin `SUPABASE_BUILD_STRICT=true` un staging sin credenciales no fallaría: produciría silenciosamente un `dist/` en modo demo. Verificar el build con esas variables antes de desplegar.
4. Confirmar que el build es `node scripts/build-frontend-config.mjs`, que la salida es `dist`, y desplegar preview desde la rama aprobada:

   ```sh
   SUPABASE_BUILD_STRICT=true node scripts/build-frontend-config.mjs
   vercel deploy
   ```

   El build real de staging DEBE ejecutarse con `SUPABASE_BUILD_STRICT=true` (como arriba; en Vercel
   esto se garantiza definiendo la variable en el Environment de staging, además de las credenciales).
   En ese modo, si falta `SUPABASE_URL` o `SUPABASE_ANON_KEY` el comando falla con código de salida
   distinto de cero y un mensaje que nombra la variable faltante — así el deploy se detiene de forma
   visible en vez de producir silenciosamente un `dist/` en modo demo. El build estricto se activa
   cuando `SUPABASE_BUILD_STRICT=true` **o** cuando `VERCEL_ENV=production`: un deploy de
   **producción** en Vercel es estricto automáticamente, sin configurar nada extra. Los **previews**
   (`VERCEL_ENV=preview`) y las compilaciones locales se mantienen en modo demo (solo advierten, nunca
   fallan) salvo que se defina explícitamente `SUPABASE_BUILD_STRICT=true` (regla 5 de `CLAUDE.md`).

## Modelo de provisión SW-070

El CLI usa únicamente `auth.admin.inviteUserByEmail`: no crea contraseña inicial. Para cada alta:

1. busca/reutiliza el municipio por `slug`;
2. busca/reutiliza el usuario Auth por correo; si ya existe, **no** reenvía una invitación;
3. upserta `profiles` por `id` y `memberships` por `(municipality_id, profile_id)`;
4. **solo para el rol `driver`**, crea/reutiliza la fila correspondiente en la tabla `drivers`
   (`municipality_id`, `display_name`, `profile_id`, `status` por defecto) de forma análoga a la
   Edge Function `create-driver-account`: busca primero por la relación fuerte `profile_id` y, si
   no existe, por `municipality_id` + `display_name` (una fila creada por otra vía sin `profile_id`
   se vincula en lugar de duplicarse). Es idempotente: reintentar reutiliza la fila, nunca duplica.
   Para los demás roles no se crea ninguna fila en `drivers`;
5. si algo falla, imprime el estado de municipio/Auth/perfil/membresía (y `driver` cuando aplica)
   sin secretos ni tokens.

Repetir exactamente el mismo comando termina los pasos pendientes. No hay rollback intencional.

### Cambio de rol y reenvío de invitación (flags explícitos)

- Para reenviar una invitación de una cuenta Auth ya existente se requiere explícitamente
  `--resend-invite`; úselo solo tras validar el correo y la solicitud del usuario.
- Por defecto el CLI **no** cambia el rol de una membresía existente: si ya hay una membresía activa
  para `(municipality_id, profile_id)` con un rol distinto al solicitado, el comando falla con un
  mensaje que nombra el rol actual y pide `--change-role`. Esto evita que un reintento o un alta mal
  dirigida degrade silenciosamente a un supervisor a driver. Pase `--change-role` **solo** cuando el
  cambio de rol sea intencional y aprobado; con ese flag la membresía sí se actualiza.
- Si `--resend-invite` falla porque el usuario Auth ya completó su registro (ya estableció su
  contraseña), no hay invitación que reenviar: el paso se reporta como `auth=resend_failed` sin
  exponer ningún enlace ni token. En ese caso pida a la persona que use **"olvidé mi contraseña"**
  en el login; para un `driver` que ya tiene cuenta, use la Edge Function existente
  **`resend-driver-invite`**.

### Mecanismos existentes reutilizados

El frontend actual no ofrece una invitación genérica para supervisor, dispatcher y driver; por eso el camino operativo es este CLI. La ruta UI existente de `Flota y personal` → `Crear cuenta de acceso` aplica solo a `driver` y llama a la Edge Function histórica `create-driver-account`, que entrega una contraseña temporal; no es la invitación sin contraseña aprobada para SW-070 y no se amplió la UI en este hito.

Para reenviar acceso a un `driver` que **ya** fue provisionado por la UI histórica de `Flota y personal` existe la Edge Function `resend-driver-invite`: restablece la contraseña del usuario Auth del driver (que ya tiene cuenta, es decir `drivers.profile_id` seteado) usando `auth.admin.updateUserById` con una contraseña temporal. **Nunca genera, imprime ni devuelve un enlace de invitación** — por los problemas de confiabilidad de `auth.admin.generateLink` documentados en esa función. Requiere que quien la invoca sea `municipal_admin`/`dispatcher` con membresía activa en el municipio del driver.

### Convención segura para altas masivas

Guardar temporalmente los archivos locales fuera de Git bajo `.pipeline/provisioning-users.csv` o `.pipeline/provisioning-users.json`; `.pipeline/` está ignorado. No incluir muestras con identidades, correos, claves o secretos de producción.

CSV permitido (encabezado literal; los campos no contienen comas):

```text
email,role,name
```

JSON permitido:

```json
{
  "users": [
    { "email": "user@example.invalid", "role": "supervisor", "name": "Nombre de ejemplo" }
  ]
}
```

Los roles se validan contra `docs/ROLE_PERMISSION_MATRIX.md`: `municipal_admin`, `supervisor`, `dispatcher` y `driver`. `mt_superadmin` no es provisionable: es la cuenta existente de Miguel, documentada en `docs/SUPERADMIN_BOOTSTRAP.md`.

## Dry run ejecutable — cinco cuentas piloto

Los correos de abajo son marcadores no entregables; reemplazarlos solo dentro de la terminal protegida. `--dry-run` no lee las variables de provisión, no crea un cliente y no escribe en Supabase.

```sh
# 1. mt_superadmin: cuenta existente de Miguel; NO ejecutar ningún script para crearla.
# Verificar acceso existente con Miguel por el canal aprobado.

# 2. municipal_admin: crea/reanuda el municipio y la invitación inicial.
node scripts/seed-empty-municipality-remote.mjs municipality \
  --municipality-slug piloto-ejemplo \
  --municipality-name "Municipio Piloto Ejemplo" \
  --email admin@example.invalid \
  --name "Administración Piloto" \
  --dry-run

# 3. supervisor: alta sobre el municipio existente.
node scripts/seed-empty-municipality-remote.mjs add-user \
  --municipality-slug piloto-ejemplo \
  --email supervisor@example.invalid \
  --role supervisor \
  --name "Supervisión Piloto" \
  --dry-run

# 4. dispatcher: alta sobre el municipio existente.
node scripts/seed-empty-municipality-remote.mjs add-user \
  --municipality-slug piloto-ejemplo \
  --email dispatcher@example.invalid \
  --role dispatcher \
  --name "Despacho Piloto" \
  --dry-run

# 5. driver: alta sobre el municipio existente.
node scripts/seed-empty-municipality-remote.mjs add-user \
  --municipality-slug piloto-ejemplo \
  --email driver@example.invalid \
  --role driver \
  --name "Conducción Piloto" \
  --dry-run

# Alternativa masiva, después de crear .pipeline/provisioning-users.csv o .json localmente.
node scripts/seed-empty-municipality-remote.mjs add-user \
  --municipality-slug piloto-ejemplo \
  --from-file .pipeline/provisioning-users.csv \
  --dry-run
```

Tras revisar cada simulación, ejecutar el mismo comando **sin** `--dry-run` desde la terminal protegida. Para un reenvío solicitado explícitamente, agregar `--resend-invite`; no agregarlo a altas o reintentos normales.

## Verificación posterior

1. Confirmar que la aplicación staging carga sin errores de módulos.
2. Cada persona acepta la invitación de Supabase por correo y establece su contraseña fuera de banda.
3. Verificar la membresía activa y el `municipality_id` correcto de las cuatro cuentas municipales.
4. Probar los permisos de cada rol según `docs/ROLE_PERMISSION_MATRIX.md` y aislamiento entre municipios con RLS.
5. Registrar comandos y resultados sin secretos. La validación automatizada local no certifica producción.

## QA local antes de aprobar

```sh
node tests/sw070-resumable-provisioning.test.mjs
node tests/sw070-dry-run.test.mjs
node tests/build-frontend-config.test.mjs
set -e
skip_list="tests/rls-adversarial.test.mjs tests/operational-cycle.test.mjs tests/telemetry-persistence.test.mjs tests/telemetry-realtime-diagnosis.test.mjs tests/route-stops-persistence.test.mjs tests/route-paths-persistence.test.mjs tests/rls-coverage.test.mjs tests/gps-route-metrics.test.mjs"
for f in tests/*.test.mjs; do
  skip=false
  for s in $skip_list; do [ "$f" = "$s" ] && skip=true; done
  [ "$skip" = true ] || node "$f"
done
npm ci
npx supabase start
node tests/rls-adversarial.test.mjs
node tests/rls-coverage.test.mjs
node tests/operational-cycle.test.mjs
node tests/telemetry-persistence.test.mjs
node tests/gps-route-metrics.test.mjs
node tests/route-stops-persistence.test.mjs
node tests/route-paths-persistence.test.mjs
node tests/telemetry-realtime-diagnosis.test.mjs
npx supabase stop
```

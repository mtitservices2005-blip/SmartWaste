# Bootstrap manual del primer `mt_superadmin`

Este procedimiento crea la primera cuenta real de propietario en producción. Es manual a propósito:
no se incluye como script desplegable, migración ni función pública, porque usa privilegios de
`service_role` y solo debe ejecutarse una vez por el dueño del proyecto.

> **SECRETO CRÍTICO:** nunca compartas la clave `service_role` con nadie, incluido un asistente de
> IA. No la pegues en chats, tickets, capturas, commits, logs ni comandos que queden en el historial.
> Quien obtiene esa clave puede eludir RLS y administrar todos los datos y usuarios del proyecto.

## Antes de ejecutar

1. Entra personalmente al proyecto Supabase de producción y confirma que es el proyecto correcto.
2. Obtén `Project URL` y la clave `service_role` desde la configuración de API. No uses la clave
   `anon`; no copies `service_role` al frontend.
3. Elige un correo real controlado por el dueño. No uses dominios de pruebas como `@sw020.test`.
4. Genera una contraseña inicial única con un gestor de contraseñas. No uses la contraseña
   compartida de `tests/integration/seed.mjs` ni reutilices una contraseña existente.
5. Trabaja desde una copia limpia y confiable del repositorio, con Node y sus dependencias ya
   instaladas. Cierra grabadores de terminal o herramientas que capturen variables de entorno.

## Ejecución única

Crea fuera del repositorio un archivo temporal llamado `bootstrap-superadmin.mjs`. Adapta el patrón
de `tests/integration/seed.mjs` con este contenido; los valores reales se reciben por variables de
entorno y nunca se escriben en el archivo:

```js
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Falta ${name}`);
}
if (/@(sw020|sw037)\.test$/i.test(process.env.SUPERADMIN_EMAIL)) {
  throw new Error('Usa un correo real, no una identidad de pruebas');
}

const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const suffix = crypto.randomUUID().slice(0, 8);
const completed = [];

try {
  const municipality = await service.from('municipalities').insert({
    slug: `mtit-platform-${suffix}`,
    name: 'MT IT Services Platform',
    status: 'active'
  }).select('*').single();
  if (municipality.error) throw municipality.error;
  completed.push(() => service.from('municipalities').delete().eq('id', municipality.data.id));

  const created = await service.auth.admin.createUser({
    email: process.env.SUPERADMIN_EMAIL.trim().toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: 'SmartWaste Owner' }
  });
  if (created.error) throw created.error;
  const userId = created.data.user.id;
  completed.push(() => service.auth.admin.deleteUser(userId));

  const profile = await service.from('profiles').insert({
    id: userId,
    display_name: 'SmartWaste Owner',
    email: process.env.SUPERADMIN_EMAIL.trim().toLowerCase()
  }).select('*').single();
  if (profile.error) throw profile.error;
  completed.push(() => service.from('profiles').delete().eq('id', userId));

  // El esquema actual exige municipality_id incluso para mt_superadmin. Esta fila plataforma es
  // solo el ancla requerida; has_platform_role() autoriza por el rol activo, no por ese municipio.
  const membership = await service.from('memberships').insert({
    municipality_id: municipality.data.id,
    profile_id: userId,
    role: 'mt_superadmin',
    status: 'active'
  }).select('*').single();
  if (membership.error) throw membership.error;

  console.log('Bootstrap completado. Usuario:', userId, 'Ancla:', municipality.data.id);
} catch (error) {
  for (const undo of completed.reverse()) {
    try { await undo(); } catch { /* rollback best-effort; revisar manualmente */ }
  }
  throw error;
}
```

Carga los cuatro valores en el entorno mediante un mecanismo local que no persista secretos (por
ejemplo, el almacén seguro de secretos de tu terminal) y ejecuta el archivo una sola vez:

```text
node bootstrap-superadmin.mjs
```

No pegues aquí valores reales y no pidas a un asistente de IA que ejecute el comando por ti. Al
terminar, borra de forma segura el archivo temporal y limpia las cuatro variables de esa sesión.

## Verificación y cierre

1. Inicia sesión en el frontend de producción con el correo real y la contraseña elegida.
2. Confirma que la sesión resuelve el rol `mt_superadmin` y solo habilita la consola Master Admin.
3. Invoca `create-municipality-account` desde esa sesión para el primer municipio cliente. Entrega
   la contraseña temporal al primer `municipal_admin` por un canal seguro; al entrar, el frontend le
   exigirá establecer una contraseña propia.
4. En Supabase verifica exactamente una fila activa `mt_superadmin`, su `profile` y la membresía
   anclada a `MT IT Services Platform`. Si hubo un error y el rollback avisó de limpieza incompleta,
   revisa y elimina manualmente solo los registros identificados antes de reintentar.
5. Rota inmediatamente la clave `service_role` si existe cualquier sospecha de exposición.


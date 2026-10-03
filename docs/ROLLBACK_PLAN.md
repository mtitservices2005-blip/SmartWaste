# Plan de rollback pre-lanzamiento — SW-072

> Plan de lanzamiento · Días 6-7. Este documento **describe** cómo volver atrás; **no ejecuta**
> ninguna acción. El rollback y cualquier decisión sobre datos los decide **Miguel** (Project
> Owner). Esta rama no despliega ni cambia Vercel/Supabase remotos.
>
> Este documento no contiene URLs, claves, tokens ni identidades. Los valores de entorno se citan
> **por nombre**, nunca por valor (ver `docs/STAGING_RUNBOOK.md`).

## Punto de retorno: tag local `pre-cutover-sw063`

El último commit de `main` antes del merge del cutover SW-063 (PR #89) quedó marcado con un tag
**local**. El tag **no se sube**: existe solo en el clon local del operador.

- Nombre del tag: `pre-cutover-sw063`
- Commit marcado: `0c17f98` (hash completo `0c17f98f4a45ca7a9ed9cba9990a16979bfda8ae`)
- Relación verificada: el merge de SW-063 (`4ea60c2`, "SW-063: cortar dual-write — la base real
  manda en producción" — PR #89) tiene como primer padre exactamente `0c17f98`.

### Cómo verificar (solo lectura, no muta tags)

```sh
# 1. El tag existe localmente
git tag -l pre-cutover-sw063

# 2. El tag apunta exactamente al commit esperado (debe imprimir el hash completo)
git rev-list -n1 pre-cutover-sw063

# 3. El commit esperado es el primer padre del merge de SW-063
git log -1 --format='%P' 4ea60c2
```

Criterio de aceptación: el paso 2 imprime `0c17f98f4a45ca7a9ed9cba9990a16979bfda8ae` y ese hash
coincide con el primer padre que imprime el paso 3. **No se crean, mueven ni borran tags** desde
este plan; si el tag faltara, se escala a Miguel en lugar de recrearlo.

## Rollback de Vercel (sin ejecutar)

Si un despliegue de producción sale mal, la vuelta atrás en Vercel la decide y la ejecuta **Miguel**
o el operador autorizado, por la interfaz de Vercel o el CLI, desde una terminal protegida. Este
plan no contiene comandos que muten Vercel.

Pasos (decisión humana, no automatizada):

1. **Confirmar el fallo** con evidencia (smoke test fallando, error visible) y detener cualquier
   despliegue en curso.
2. **Localizar el problema**: decidir si es de aplicación (frontend) o de datos/esquema (Supabase).
   Ver la sección "Rollback de datos en Supabase".
3. Si es de aplicación: **localizar el deployment anterior saludable**. La fuente preferida es el
   commit/tag `pre-cutover-sw063`; alternativamente, un deployment previo cuyo estado se conozca
   como bueno.
4. **Promover o redeployar** según la interfaz de Vercel: promover el deployment anterior saludable
   a producción (rollback instantáneo), o redeployar desde la fuente/tag elegido si hace falta un
   build nuevo.
5. **Verificar con smoke test** después del rollback: la aplicación carga sin errores de módulos, el
   login funciona y el flujo mínimo opera contra datos reales. Registrar el resultado sin secretos.

Límites: el rollback de Vercel revierte **el frontend/build**, no la base de datos. Un despliegue
anterior puede no ser compatible con un esquema ya migrado hacia adelante; por eso el paso 2 es
obligatorio antes de decidir.

## Rollback de datos en Supabase

**No existe rollback automático de datos, y NO se usa `supabase db reset` contra staging ni
producción.** `db reset` borra y recrea la base local; contra un entorno remoto destruiría datos
reales. No se da ningún comando que mute Supabase.

Ante un problema en Supabase:

1. **Detener escrituras y despliegues**: pausar el despliegue en curso y las escrituras de la
   aplicación (por ejemplo, volviendo al frontend anterior) para no seguir corrompiendo estado.
2. **Preservar evidencia**: capturas, mensajes de error, marcas de tiempo y el estado observado,
   **sin** claves, tokens, URLs con credenciales ni identidades.
3. **Decidir con Miguel** el origen del problema:
   - Si es de **aplicación** (frontend/adaptador), revertir el frontend al deployment saludable
     anterior es la primera línea.
   - Si es de **esquema o datos**, evaluar el impacto antes de tocar nada.
4. Cualquier **migración correctiva o reversión** de esquema se **planifica y revisa** primero
   (dry-run cuando aplique) y **no se ejecuta sin la aprobación explícita de Miguel**. Las
   migraciones versionadas se aplican de forma incremental; la recuperación habitual ante una
   aplicación interrumpida es **retomar aplicando lo pendiente**, no revertir
   (ver `supabase/README.md`).
5. Registrar la decisión y el resultado sin valores sensibles.

## Límites

- Este plan **no ejecuta** nada: ni en Vercel, ni en Supabase, ni push de tags.
- No sustituye la decisión de Miguel; solo prepara el camino y las verificaciones de lectura.
- El tag `pre-cutover-sw063` es **local**: no está disponible para un redeploy hecho desde un
  entorno que no sea este clon.

## Plan de comunicación

- **Canal:** el canal aprobado con Miguel (Project Owner). No pegar claves, tokens, URLs con
  credenciales, enlaces de invitación ni identidades.
- **Al iniciar un rollback:** avisar a Miguel con el síntoma observado, la evidencia y el
  deployment/commit candidato, sin valores sensibles.
- **Al cerrar:** reportar la acción tomada (promover/redeploy/revertir frontend), el resultado del
  smoke test y cualquier decisión pendiente sobre datos.
- **Quién decide:** el rollback de Vercel y cualquier acción sobre Supabase los decide Miguel. El
  pipeline no ejecuta rollback por su cuenta.

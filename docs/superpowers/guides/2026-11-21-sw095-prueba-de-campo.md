# SW-095 — Prueba de campo del modo sin internet (conductor)

Qué se prueba: que el conductor pueda **abrir la app, iniciar, recorrer y terminar una ruta (con galones) sin internet**, y que todo llegue a Supabase con las **horas reales** al volver la señal.

## Antes de salir
1. Instala la APK nueva (ejecuta el workflow **Android release APK (signed)** desde `main` después de aprobar el PR; el `version_code` sube solo).
2. Con internet, entra con la cuenta del conductor y abre la pantalla **Hoy** al menos una vez (así la app guarda la copia de las rutas del día).
3. Confirma que la ruta de prueba **no** esté marcada como prueba (las corridas de prueba no salen en el mapa público).

## En la calle
1. Con la app abierta en **Hoy**, activa el **modo avión** y vuelve a prender solo la **ubicación (GPS)**. **No cierres la app**: hoy, si se cierra y se abre sin internet, el login bloquea el acceso (límite conocido, ver abajo).
2. Debe aparecer la franja **"Sin conexión · datos de las …"** (al tocar "Reintentar" o al volver a Hoy sigue mostrando tus rutas).
3. Pulsa **Iniciar ruta**. Debe pasar a **En ruta** y aparecer **"1 pendiente de enviar"**. (El mapa de fondo no dibuja sin internet; el punto sí se guarda.)
4. Recorre unos minutos. Anota la hora de inicio y la de fin.
5. Pulsa **Terminar ruta**, anota unos galones (por ejemplo 5,5) y **Guardar y terminar**. Debe volver a Hoy con **"3 pendientes de enviar"**.
6. Quita el modo avión. En menos de un minuto el contador debe llegar a cero.

## Qué verificar en la web
- **Métricas › Corridas:** la corrida aparece terminada con **la hora de inicio y fin reales** (las que anotaste, no la hora de la reconexión), los **km medidos** y el **combustible**.
- **Mapa en vivo:** durante el corte el camión se queda en su última posición y pasa a "sin señal" (90 s); al reconectar se actualiza.
- El combustible aparece **una sola vez** aunque cortes la señal justo al enviar.

## Si algo sale mal
- **"No se pudo enviar …"** con **Reintentar / Descartar**: el servidor rechazó esa acción (por ejemplo, permiso). Pulsa Reintentar; si vuelve a fallar, avisa a Miguel con la captura. **Descartar** borra la acción y la corrida vuelve a su estado en el servidor.
- No desinstales la app con pendientes: se pierde la cola local.
- Si la hora del teléfono está mal (adelantada o de otro año), la app usa la hora del servidor.

## Límites conocidos
- **Abrir la app desde cero sin internet:** el acceso (login) todavía exige red, así que el modo sin internet cubre perder la señal con la app ya abierta. Restaurar la sesión sin red queda para otro hito (toca seguridad).
- Sin internet no hay mapa de fondo ni se sabe si el municipio exige el chequeo del camión: **no se bloquea la salida** por el chequeo.
- Rutas nuevas asignadas mientras no hay señal aparecen al reconectar.
- Pendiente de CI: las pruebas que usan Supabase local.

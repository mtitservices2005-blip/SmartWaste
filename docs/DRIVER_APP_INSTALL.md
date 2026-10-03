# Instalación y prueba de campo — SmartWaste Conductor para Android

> APK de prueba · staging · no producción. Esta guía no corresponde a una publicación en Google Play Store.

Esta guía permite a Miguel instalar el APK de prueba, preparar un teléfono Android y ejecutar una prueba de campo de 20–30 minutos. La prueba debe hacerse con una cuenta de conductor de staging que tenga un vehículo y una ruta activa asignados.

## 1. Antes de instalar

El operador debe entregar a Miguel el archivo `app-debug.apk` generado para la revisión exacta que se va a probar. Si se obtiene desde GitHub Actions, se descarga el artefacto de esa ejecución, se descomprime y se usa el APK que contiene; no se instala el archivo `.zip`. Una compilación local deja el mismo archivo en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Antes de continuar, registrar sin incluir secretos:

- fecha y hora de la prueba;
- revisión o ejecución de CI de la que salió el APK;
- marca, modelo y versión de Android del teléfono;
- identificador operativo del vehículo de prueba, sin matrícula ni datos personales.

No usar un APK recibido desde un enlace o remitente no aprobado. Este APK usa configuración y firma de prueba: no certifica producción ni disponibilidad en Play Store.

## 2. Instalar el APK de prueba

1. Descarga `app-debug.apk` en el teléfono desde el canal privado acordado.
2. Abre el archivo desde **Archivos**, **Mis archivos** o la notificación de descarga.
3. Si Android bloquea la instalación, pulsa **Configuración** en el aviso y activa **Permitir desde esta fuente** únicamente para la aplicación que abrió el APK (por ejemplo, Archivos o el navegador). Regresa y pulsa **Instalar**.
4. Al terminar, desactiva de nuevo **Permitir desde esta fuente**. La ruta habitual es **Ajustes → Apps → Acceso especial → Instalar apps desconocidas**, aunque el nombre puede variar.
5. Pulsa **Abrir** y comprueba que aparece **SmartWaste Conductor**.

Si ya hay una compilación de prueba instalada y Android rechaza la actualización por una firma distinta, detente y consulta al operador. Desinstalar borra la cola local pendiente; no lo hagas hasta confirmar que no hay posiciones por enviar.

## 3. Conceder los permisos Android

Haz esta preparación con el vehículo estacionado y conexión disponible.

### Ubicación: “Permitir todo el tiempo”

1. Activa la ubicación general del teléfono.
2. Abre **Ajustes → Apps → SmartWaste Conductor → Permisos → Ubicación**.
3. Selecciona **Permitir todo el tiempo**.
4. Activa **Usar ubicación precisa** si aparece.

En algunas versiones Android primero hay que aceptar **Mientras se usa la aplicación** dentro de la app y luego volver a Ajustes para seleccionar **Permitir todo el tiempo**. Si esa opción no aparece, no inicies la prueba: registra el modelo y la versión de Android y avisa al operador.

### Notificaciones

1. Abre **Ajustes → Apps → SmartWaste Conductor → Notificaciones**.
2. Activa **Permitir notificaciones** y no silencies la categoría asociada al seguimiento.
3. En Android 13 o posterior, acepta también el diálogo de notificaciones que muestre la app.

Mientras el GPS de fondo esté activo debe permanecer visible una notificación con el texto **“SmartWaste está registrando tu recorrido”**. No ocultes ni bloquees esa notificación durante la prueba.

## 4. Excluir la app de la optimización de batería

Los nombres cambian ligeramente según la versión del fabricante. Busca siempre **SmartWaste Conductor** y elige la opción que permita actividad en segundo plano sin restricciones.

### Samsung

1. **Ajustes → Aplicaciones → SmartWaste Conductor → Batería → Sin restricciones**.
2. **Ajustes → Cuidado del dispositivo y batería → Batería → Límites de uso en segundo plano → Aplicaciones nunca inactivas**.
3. Añade **SmartWaste Conductor** a la lista.

### Xiaomi, Redmi o POCO

1. **Ajustes → Aplicaciones → Administrar aplicaciones → SmartWaste Conductor → Ahorro de batería**.
2. Selecciona **Sin restricciones**.
3. En **Permisos** u **Otros permisos**, permite el inicio en segundo plano si aparece.
4. En **Seguridad → Permisos → Inicio automático**, activa **SmartWaste Conductor** si el modelo ofrece esa opción.

### Motorola

1. **Ajustes → Apps → SmartWaste Conductor → Batería**.
2. Selecciona **Sin restricciones** y permite la actividad en segundo plano.
3. Si existe **Ajustes → Batería → Batería adaptable**, confirma que SmartWaste Conductor no esté restringida.

### Huawei

1. **Ajustes → Batería → Inicio de aplicaciones** (también puede aparecer como **Inicio de apps**).
2. Busca **SmartWaste Conductor** y desactiva **Gestionar automáticamente**.
3. Activa **Inicio automático**, **Inicio secundario** y **Ejecutar en segundo plano**.
4. En **Ajustes → Apps → SmartWaste Conductor → Batería**, activa **Permitir actividad en segundo plano** si aparece.

## 5. Iniciar y detener un recorrido

Nunca manipules el teléfono mientras el vehículo esté en movimiento. El conductor debe dejarlo fijo en un soporte; un acompañante u operador observa el mapa desde otro dispositivo.

Para iniciar:

1. Abre SmartWaste Conductor e inicia sesión con la cuenta de conductor de staging.
2. Confirma que se muestra el vehículo y la ruta asignados. Si aparece **“No tienes un vehículo asignado en una ruta activa”**, no continúes: solicita que se corrija la asignación.
3. Con el vehículo detenido, pulsa **Iniciar recorrido** una sola vez.
4. Acepta los permisos que aún solicite Android.
5. Confirma que aparece y permanece la notificación **“SmartWaste está registrando tu recorrido”**.
6. Bloquea la pantalla y deja el teléfono sin manipular durante el trayecto.

Para detener:

1. Estaciona en un lugar seguro y desbloquea el teléfono.
2. Abre SmartWaste Conductor y pulsa **Finalizar recorrido**. Si el control disponible dice **Detener GPS**, úsalo para una parada manual del seguimiento.
3. Confirma que la app deja de indicar seguimiento activo y que la notificación desaparece. Espera hasta 30 segundos antes de marcar el paso como fallido.

Forzar el cierre de la app, quitarle permisos o reiniciar el teléfono no sustituye el botón de parada y no demuestra un cierre correcto.

## 6. Checklist de campo de 20–30 minutos — evidencia pendiente de Miguel

Esta verificación requiere un teléfono Android físico, desplazamiento real y acceso de observación al mapa de Operaciones. **No está completada por las pruebas automatizadas ni por la existencia del APK.** Miguel debe marcar cada casilla y conservar la evidencia en el canal privado del piloto, sin secretos ni datos personales.

### Preparación (minutos 0–5, vehículo detenido)

- [ ] Registrar fecha/hora, revisión del APK, teléfono y versión Android.
- [ ] Confirmar ubicación **Permitir todo el tiempo**, ubicación precisa, notificaciones y batería **Sin restricciones**.
- [ ] Confirmar sesión de staging, vehículo correcto y ruta activa asignada.
- [ ] Pulsar **Iniciar recorrido** y tomar una captura recortada de la notificación fija.
- [ ] En otro dispositivo, abrir **Operaciones → Mapa** y confirmar el vehículo correcto con la insignia de GPS real **●**.

### GPS en segundo plano (minutos 5–15)

- [ ] Bloquear la pantalla durante al menos 5 minutos mientras el vehículo se desplaza.
- [ ] Sin desbloquear el teléfono, comprobar desde Operaciones que el marcador avanza y que la insignia **●** se mantiene durante el tramo.
- [ ] Registrar dos horas de observación separadas por al menos 5 minutos y tomar capturas recortadas del mapa. La separación entre posiciones recibidas debe ser de **15 segundos o menos** durante un tramo con señal estable; el operador debe verificarlo en los registros o datos de staging, no estimarlo solo por el movimiento visual.
- [ ] Desbloquear el teléfono estando ya detenido y comprobar que el seguimiento sigue activo y la notificación continúa visible.

### Cola sin conexión (minutos 15–25)

- [ ] Con el vehículo detenido, anotar la hora y desactivar temporalmente wifi y datos móviles, manteniendo la ubicación activada. No usar modo avión si este desactiva la ubicación del modelo.
- [ ] Reanudar el trayecto durante 3–5 minutos con la pantalla bloqueada. Confirmar desde Operaciones que no llegan posiciones nuevas durante el corte.
- [ ] Detenerse, anotar la hora y reactivar los datos móviles.
- [ ] Esperar la sincronización y comprobar en staging que aparecen todas las posiciones capturadas durante el corte, ordenadas por su `captured_at` original y sin duplicados. Guardar una captura o exportación recortada que muestre horas y orden, sin coordenadas completas ni datos personales.
- [ ] Confirmar que el marcador y la insignia **●** vuelven a actualizarse después de recuperar la conexión.

### Parada (minutos 25–30, vehículo detenido)

- [ ] Pulsar **Finalizar recorrido** o **Detener GPS**, según el control mostrado.
- [ ] Confirmar que la notificación desaparece en un máximo de 30 segundos y tomar una captura de la bandeja de notificaciones sin el aviso de SmartWaste.
- [ ] Esperar al menos 30 segundos y confirmar en Operaciones que no se reciben posiciones nuevas del teléfono.
- [ ] Registrar el resultado global como **APROBADO** solo si todos los pasos anteriores tienen evidencia; en otro caso registrar **NO APROBADO** y el paso exacto que falló.

## 7. Qué está automatizado y qué sigue pendiente

### Verificación automatizada disponible

Las pruebas del repositorio cubren la lógica sin sustituir la prueba física:

- selección de una muestra cada 10 segundos o 25 metros;
- persistencia de la cola local entre reinicios de la lógica;
- reenvío en orden de `captured_at`, sin duplicados y conservando el momento original;
- bloqueo claro del envío y de la cola cuando el conductor no tiene asignación activa;
- uso del contrato de ingesta de telemetría de la app.

La referencia principal es `tests/driver-app-telemetry.test.mjs`. Que esas pruebas pasen demuestra la lógica simulada, no el comportamiento del sistema operativo, del fabricante, de la antena GPS ni de la red móvil.

### Evidencia de campo pendiente de Miguel

Hasta que Miguel complete y adjunte el checklist anterior, siguen pendientes:

- GPS continuo con pantalla bloqueada y app en segundo plano;
- intervalo real de posiciones de 15 segundos o menos con señal estable;
- permanencia de la notificación durante todo el seguimiento;
- recuperación real de la cola después de perder y recuperar internet;
- desaparición de la notificación y cese de nuevas posiciones al detener el recorrido.

## 8. Reportar un fallo

Registrar: paso, hora, resultado esperado, resultado observado, modelo/Android, estado de señal y texto exacto del error. Adjuntar solo capturas recortadas. No incluir nombres, correos, matrículas, coordenadas completas, URL de backend, tokens, contraseñas ni claves.

No desinstalar ni borrar los datos de la app antes de que el operador revise una posible cola pendiente. Este procedimiento valida exclusivamente un APK de prueba en staging; no autoriza un despliegue de producción ni una publicación en Play Store.

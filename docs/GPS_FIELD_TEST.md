# Guía de prueba de GPS en campo — insignia de "GPS real" (●)

Esta guía es para la prueba **física** que hace Miguel o una persona del equipo piloto conduciendo un vehículo con la aplicación abierta en el teléfono. Sirve para confirmar que la aplicación muestra la **insignia de GPS real (●)** sobre el vehículo correcto en el mapa de Operaciones.

- **Audiencia:** cualquier persona del equipo piloto. No requiere conocimientos de programación.
- **Duración estimada:** 20–30 minutos (con al menos un tramo corto de conducción real).
- **Qué confirma:** que la posición real del teléfono llega al sistema y que el mapa la distingue de la posición simulada con la insignia ●.

> Esta guía **describe cómo ejecutar la prueba**. No afirma que la prueba ya se haya ejecutado. El resultado debe registrarse aparte (ver la última sección).

---

## 1. Antes de salir: preparación del teléfono

Haz todo esto **con el vehículo detenido y en un lugar seguro**, nunca en movimiento.

1. **Carga el teléfono.** Sal con la batería al 100 % o conectado a la corriente del vehículo. Compartir la ubicación consume batería.
2. **Abre la aplicación de staging** en el navegador del teléfono, usando el enlace que te entregue el operador (no lo pegues en capturas ni chats públicos).
3. **Inicia tu sesión** con la cuenta de **conductor (driver) real** que te asignaron. No uses datos de demostración ni una cuenta de supervisor.
4. **Confirma que tienes un vehículo asignado.** En la pantalla de conductor debe aparecer tu vehículo. Si no aparece ninguno, detente aquí y avisa al operador: sin vehículo asignado la prueba no puede completarse.
5. **Activa el brillo de la pantalla** a un nivel que se vea a plena luz del día (la revisarás de forma intermitente, sin manipularla en movimiento).
6. **Deja el teléfono montado y fijo** en un soporte, con la pantalla visible sin que tengas que sostenerlo. No lo lleves en la mano.
7. **Verifica la conexión de datos** (wifi o red móvil). Sin conexión, la posición no se enviará y la insignia no aparecerá.

---

## 2. Seguridad durante la conducción (regla obligatoria)

- **Nunca manipules el teléfono mientras el vehículo está en movimiento.** Ni para leer, ni para tocar la pantalla, ni para tomar capturas.
- Si vas **solo**: inicia el compartir ubicación **antes de arrancar** y no toques el teléfono hasta detenerte en un lugar seguro. Toda revisión o captura se hace **ya detenido**.
- Si llevas **acompañante**: el acompañante puede observar la pantalla y tomar las capturas, leyéndole en voz alta lo que ve. Conductor solo conduce.
- **Detente siempre** en un lugar seguro (no en un arcén de tránsito) para: revisar el mapa, tomar capturas o leer un mensaje de estado.
- Respeta todas las normas de tránsito. Esta prueba **no** exige distracciones: en ningún momento vale la pena manipular el teléfono en movimiento.

---

## 3. Permisos de ubicación

La aplicación usa el servicio de ubicación del teléfono. La primera vez, el navegador pedirá permiso.

1. Cuando aparezca el aviso **"¿Permitir que este sitio acceda a tu ubicación?"**, elige **Permitir** (o "Permitir mientras se usa la aplicación").
2. Si lo rechazaste por error, el compartir ubicación **no funcionará**. Para corregirlo:
   - En el **navegador**, abre la configuración del sitio (icono de candado o de ajustes junto a la dirección) y cambia el permiso de ubicación a **Permitir**.
   - En los **ajustes del teléfono**, revisa que la ubicación general esté **activada** y que el navegador tenga permiso de ubicación.
3. Asegúrate de que la ubicación del teléfono esté **encendida** (GPS del sistema activo).
4. Un permiso correcto se nota porque, al iniciar el compartir, el estado en pantalla indica que se envió una posición y con la hora de la última actualización.

---

## 4. Iniciar "Compartir mi ubicación real"

Con el vehículo **detenido** (o en el momento previo a arrancar):

1. Entra a la **vista móvil del conductor**.
2. Localiza el botón **"Compartir mi ubicación real"**.
   - Este botón solo aparece cuando la aplicación está conectada al backend real de staging (no en modo demostración). Si no lo ves, avisa al operador: la sesión o el entorno no están en modo real.
3. Púlsalo **una vez**. El botón debe cambiar a **"Detener GPS real"** y, debajo, aparecer un mensaje de estado.
4. Espera a que el mensaje indique que se **envió la última posición real** (mostrará la hora). A partir de ese momento, la aplicación empieza a compartir ubicaciones periódicamente mientras esté abierta.
5. **Deja la aplicación abierta y en primer plano** durante el recorrido. Si el navegador va a segundo plano o la pantalla se apaga, el envío de posiciones puede detenerse.
6. **No pulses "Detener GPS real"** hasta terminar la prueba.

Si en lugar del mensaje de éxito ves un aviso de error (permisos, sin vehículo asignado, sin sesión conectada o sin acceso a la ubicación), anótalo tal cual y revísalo con el operador (ver sección 8).

---

## 5. Qué observar en Mapa / Operaciones

La observación se hace desde **otro dispositivo** (por ejemplo la computadora de Miguel o de un supervisor) en la sección **Operaciones → Mapa**, o pídele a un acompañante que mire el mapa si lo abres en otro dispositivo. No lo mires conduciendo.

1. En **Operaciones → Mapa**, ubica el vehículo que estás conduciendo (el mismo que la sesión de conductor tiene asignado).
2. Durante la conducción, el marcador del vehículo debe **moverse** siguiendo la posición real del teléfono, no una ruta simulada predefinida.
3. Junto al marcador del vehículo debe aparecer la **insignia ●** (un punto/insignia de "Posición GPS real").

> **Importante sobre la actualización:** el mapa consulta la posición real cada pocos segundos y solo mantiene la insignia si la última posición recibida es **reciente**. Si dejas de compartir o el teléfono pierde señal, el mapa vuelve a la posición simulada y la insignia ● desaparece. Vuelve a aparecer al recibir una posición real nueva.

---

## 6. Cómo confirmar la insignia ● (qué significa cada estado)

Al revisar el marcador del vehículo correcto en el mapa de Operaciones, interpreta así:

| Lo que ves | Qué significa |
| --- | --- |
| Marcador que se mueve por donde vas + **insignia ●** visible | **Correcto.** La posición real reciente llegó y el sistema la distingue de la simulada. Prueba superada. |
| Marcador que se mueve pero **sin insignia ●** | El marcador puede estar usando la posición **simulada**. Revisa que el compartir ubicación siga activo y que el teléfono tenga señal; espera unos segundos y vuelve a mirar. |
| Marcador **detenido** o en una ruta fija + **sin insignia ●** | No están llegando posiciones reales recientes. Revisa permisos, conexión y que el botón "Detener GPS real" no se haya activado. |
| Marcador del **vehículo equivocado** | Revisa que el vehículo asignado a la sesión de conductor sea el que estás conduciendo. |

La insignia ● es la señal de que la aplicación está mostrando **posición GPS real**; su ausencia es la señal de que está mostrando la **posición simulada/demo**.

---

## 7. Evidencia: qué capturas tomar (sin datos personales)

Toma las capturas **con el vehículo detenido o por el acompañante**. Captura:

1. El **botón en estado "Detener GPS real"** con el mensaje de "última posición enviada" y la hora, en la vista de conductor.
2. El **mapa de Operaciones** con el **marcador del vehículo y la insignia ● visible**. Si puedes, una segunda captura unos segundos después para mostrar movimiento.
3. La **hora y la zona** aproximadas de la prueba (por ejemplo "martes, ~10:30").

**No incluyas en las capturas ni en los reportes:**
- El **nombre completo ni el correo** de la persona conductora.
- **Números de teléfono**, direcciones de casa, o cualquier dato que identifique a una persona.
- **Contraseñas, tokens, enlaces de invitación**, direcciones de backend, claves, ni la barra de dirección completa si contiene parámetros sensibles.
- **Matrículas, rostros, documentos** ni datos de terceros que aparezcan en el fondo.

Recorta (o difumina) cualquier elemento así antes de compartir la captura.

---

## 8. Cómo registrar y reportar un fallo

Si algo no funciona, regístralo de inmediato (estando **detenido**) con estos datos:

1. **Qué hiciste:** el paso exacto en el que ocurrió (por ejemplo, "pulsé Compartir mi ubicación real").
2. **Qué esperabas:** por ejemplo, "que apareciera la insignia ● en el marcador de mi vehículo".
3. **Qué ocurrió:** el texto exacto del mensaje de estado o una descripción de la pantalla (con captura recortada).
4. **Cuándo:** fecha y hora aproximada.
5. **Condiciones:** tipo de teléfono y navegador, si había señal de datos, si el vehículo estaba en movimiento o detenido, y si habías concedido el permiso de ubicación.
6. **Qué intentaste después:** por ejemplo, "recargué la página", "revisé el permiso de ubicación".

Cada fallo se registra como incidencia en el canal de seguimiento del piloto acordado con el Project Owner (el mismo canal que se use para el resto de la prueba), adjuntando la captura recortada y sin datos personales.

---

## 9. Cómo se decide la insignia ● (referencia para quien da soporte técnico)

Esta sección es de referencia. **La persona que hace la prueba no necesita leerla ni entender código**; se incluye para que quien dé soporte sepa de dónde sale la insignia y dónde mirar si falta.

- **Archivo:** `frontend/app.js`.
- **Función que decide mostrar la insignia:** `drawMapLayers()`. Para cada vehículo, toma su posición real guardada (si el vehículo tiene un identificador real asociado) y calcula un valor `isFreshReal`: es verdadero **solo si existe una posición real y su antigüedad es menor que la ventana de frescura** `REAL_GPS_FRESHNESS_MS` (30 000 ms, es decir 30 segundos).
- Ese valor (`isFreshReal`) se pasa a la función `truckIcon(truck, isFreshReal)`. Cuando es verdadero, `truckIcon()` agrega al marcador el elemento `<i class="gps-real-badge">●</i>`; cuando es falso, no lo agrega y el vehículo se muestra como simulado.
- Las posiciones reales se cargan por consulta periódica (`fetchRealPositions()`), que alimenta la colección usada por `drawMapLayers()`.
- **Función que envía la ubicación desde el teléfono:** `startDriverGps()` (en el mismo `frontend/app.js`). Usa `navigator.geolocation.watchPosition` para leer la ubicación del dispositivo y **persiste esa ubicación real** asociada a la sesión y a la configuración reales (vehículo y municipio de la sesión de conductor). Es la función que se activa al pulsar **"Compartir mi ubicación real"**.

En resumen: el teléfono envía posiciones reales → el sistema guarda la última por vehículo → el mapa de Operaciones pinta la insignia ● mientras esa última posición tenga menos de 30 segundos.

---

## 10. Cierre de la prueba

1. Detén el vehículo en un lugar seguro y pulsa **"Detener GPS real"** en la vista de conductor.
2. Confirma con quien observó el mapa si la insignia ● apareció durante el tramo real.
3. Reúne las capturas recortadas (sección 7) y registra el resultado o el fallo (sección 8).

> Recordatorio: los datos mostrados durante el piloto deben conservar la etiqueta de datos demo/no producción que corresponda. Esta guía no debe incluir secretos, credenciales ni datos personales.

# Play Console · Seguridad de los datos (Data safety)

Respuestas propuestas para el formulario. Revísalas contra lo que realmente hace la app antes de enviarlas: Google compara el formulario con el comportamiento observado, y una respuesta inexacta puede bloquear la publicación.

URL de la política de privacidad: `https://<tu-dominio-de-produccion>/privacidad`

## Preguntas generales

| Pregunta | Respuesta |
|---|---|
| ¿La app recopila o comparte datos de usuario requeridos? | Sí |
| ¿Todos los datos se cifran en tránsito? | Sí (HTTPS) |
| ¿Ofreces una forma de solicitar la eliminación de datos? | Sí: por correo a mtitservices2005@gmail.com (indicado en la política) |
| ¿Sigue el programa "Familias"? | No (la app es para personal municipal adulto) |

## Tipos de datos

| Categoría de Play | Dato | Recopilado | Compartido | Obligatorio | Finalidad |
|---|---|---|---|---|---|
| Ubicación | Ubicación precisa | Sí | No¹ | Sí | Funcionalidad de la app; Análisis (kilómetros y avance de ruta) |
| Ubicación | Ubicación aproximada | Sí | No¹ | Sí | Funcionalidad de la app |
| Información personal | Dirección de correo electrónico | Sí | No¹ | Sí | Funcionalidad de la app; Administración de la cuenta |
| Información personal | Nombre | Sí (si la cuenta lo trae) | No¹ | Sí | Administración de la cuenta |
| Identificadores | ID de dispositivo u otros ID | Sí (ID generado por la app) | No¹ | Sí | Funcionalidad de la app; Prevención de fraude y seguridad |
| Información y rendimiento de la app | Otros datos de rendimiento (nivel de batería) | Sí | No¹ | Sí | Funcionalidad de la app |
| Actividad en la app | Otra actividad (inicio y fin de ruta, litros de combustible) | Sí | No¹ | Sí | Funcionalidad de la app; Análisis |

¹ Supabase (base de datos y autenticación) y Vercel (web) tratan los datos solo por nuestra cuenta como proveedores de servicio; Google Play no los considera "compartir". Si en el futuro se agregan analíticas de terceros o publicidad, esta tabla cambia.

No recopila: contactos, fotos o video, audio, mensajes, calendario, historial web, datos financieros, de salud ni de condición física.

## Para confirmar antes de enviar
- **Retención:** la política dice "mientras el servicio esté activo". Si el ayuntamiento exige un plazo concreto (por ejemplo, borrar posiciones tras 12 meses), cámbialo en la política y aquí.
- **Inicio de sesión con Google:** si el conductor entra con Google, Google recibe el aviso de inicio de sesión. Es un servicio que el usuario elige; no se declara como compartir.

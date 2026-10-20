# Play Console · Declaración de ubicación en segundo plano

La app pide `ACCESS_BACKGROUND_LOCATION`. Play exige un formulario y un video por ese permiso. Es la causa de rechazo más común, así que conviene que el texto y el video sean claros y breves.

## Texto de la declaración (pegar en el formulario)

**¿Qué función necesita ubicación en segundo plano?**
> Seguimiento del recorrido de un camión recolector. El conductor inicia una ruta en la app y guarda el teléfono en el bolsillo o en el soporte del camión con la pantalla apagada. La app sigue enviando la ubicación para que el ayuntamiento vea el camión en su mapa, mida los kilómetros recorridos y verifique el avance de la ruta. Sin ubicación en segundo plano, el seguimiento se corta cada vez que se apaga la pantalla o se abre otra app (navegación, teléfono).

**¿Por qué no basta la ubicación en primer plano?**
> El conductor no puede mantener la app abierta y la pantalla encendida durante turnos de varias horas manejando un camión. Android detiene la ubicación en primer plano cuando la app deja de estar visible.

**¿Cómo se informa al usuario?**
> La app solo registra durante una ruta iniciada por el conductor. Mientras registra, Android muestra una notificación permanente: "SmartWaste está registrando tu recorrido". Al terminar la ruta, el registro se detiene. Antes del diálogo de Android, la app muestra una pantalla que explica para qué se usa la ubicación en segundo plano y pide aceptación expresa (divulgación destacada).

## Guion del video (30 a 60 segundos, grabación de pantalla del teléfono)

1. Abrir la app e iniciar sesión con la cuenta de revisión (ver `04-cuenta-de-revision.md`).
2. Mostrar la pantalla de divulgación (SW-107), aceptarla y conceder **Permitir todo el tiempo** en el diálogo de Android.
3. Pulsar **Iniciar ruta**. Mostrar la notificación "SmartWaste está registrando tu recorrido".
4. Apagar la pantalla o abrir otra app unos segundos y volver.
5. Mostrar que la ubicación sigue actualizándose (el punto del mapa se mueve) y, si se puede, el mapa del ayuntamiento en otra pantalla.
6. Pulsar **Terminar ruta** y mostrar que la notificación desaparece.

Subir el video a YouTube como "no listado" y pegar el enlace en el formulario.

## Antes de enviar
- **Divulgación destacada (SW-107, hecha):** antes de la primera ruta la app muestra la pantalla "Ubicación en segundo plano" con los botones "Entiendo y continuar" y "Ahora no", y solo después se abre el diálogo de Android. Grábala completa en el video.
- **Enlace a la política:** la pantalla muestra el enlace solo si la app conoce la URL pública de la política (`window.SMARTWASTE_PRIVACY_URL`); si no, indica que está en la ficha de Google Play. Conviene definirla antes de grabar el video.
- El texto de la política de privacidad debe decir lo mismo que esta declaración. Ya lo dice la sección 3.

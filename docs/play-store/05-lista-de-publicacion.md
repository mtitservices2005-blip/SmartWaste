# Lista de publicación en Google Play (cuenta personal)

Orden sugerido. Las casillas con **(M)** las haces tú, Miguel; **(C)** son de Claude.

## Fase A · Preparar el binario
- [x] (C) SW-107: pantalla de divulgación destacada antes de pedir la ubicación en segundo plano.
- [ ] (M) Mergear SW-104, SW-105 y SW-106 (CI en verde).
- [ ] (M) Ejecutar "Android release APK (signed)" en `main`; descargar `.apk` y `.aab`.
- [ ] (M) Prueba de campo en teléfono real con API 35/36: corrida de 10 a 15 min con pantalla apagada; confirmar que los puntos llegan.
- [ ] (M) Guardar la clave de firma (keystore) en dos sitios seguros. Con Play App Signing, Google guarda la clave final y tú conservas la clave de subida; si la pierdes se puede restablecer, pero es un trámite.

## Fase B · Cuenta y ficha
- [ ] (M) Crear la cuenta de desarrollador (pago único de $25; verificación de identidad).
- [ ] (M) Crear la app en Play Console: "SmartWaste Conductor", gratuita, español.
- [ ] (M) Publicar la política en `https://mtitservices.net/soluciones/smartwaste/privacidad` (copiar `frontend/privacidad.html` al sitio) y pegar esa URL en Play Console.
- [ ] (M) Completar Seguridad de los datos con `01-seguridad-de-los-datos.md`.
- [ ] (M) Declaración de ubicación en segundo plano con `02-ubicacion-en-segundo-plano.md` (+ video).
- [ ] (M) Ficha con `03-ficha-de-la-tienda.md`; ícono, imagen destacada y capturas.
- [ ] (M) Acceso a la app con `04-cuenta-de-revision.md`.
- [ ] (M) Clasificación de contenido, público objetivo, declaración de anuncios.

## Fase C · Prueba cerrada (obligatoria en cuenta personal nueva)
- [ ] (M) Subir el `.aab` a una prueba cerrada y crear la lista de testers.
- [ ] (M) Reunir 12 testers o más (apunta a 14 o 16) con cuenta de Google; deben aceptar la invitación, instalar desde Play y usar la app.
- [ ] (M) Mantener la prueba abierta 14 días seguidos. No pausarla: se reinicia el conteo.
- [ ] (M) Pedir acceso a producción (formulario de ~10 preguntas); respuesta en unos 2 días.
- [ ] (M) Enviar a producción; revisión de hasta 7 días.

## Riesgos conocidos
- Si el GPS en segundo plano falla en API 36, hay que resolverlo antes de la fase C.
- La declaración de ubicación puede rechazarse la primera vez; se corrige y se reenvía.
- Si vas a vender a varios ayuntamientos, considera luego una cuenta de organización para que figure "MT IT Services" como desarrollador.

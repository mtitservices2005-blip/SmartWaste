# SW-097 · Guía de prueba de campo del mapa en vivo

No requiere APK nuevo: la app del conductor no cambió.

## 1. Aplicar la migración
En el SQL Editor de Supabase ejecuta `supabase/migrations/202610170001_sw097_public_live_fleet.sql`.
Comprueba (SQL Editor): `select public_live_fleet('<slug-del-municipio>');` debe devolver `municipality`, `server_time` y `vehicles`.

## 2. Abrir la página pública
En otro dispositivo (o ventana privada) abre `https://<tu-dominio>/en-vivo?m=<slug>`.
Sin `?m=` la página pide indicar el municipio. Con un slug desconocido tampoco muestra camiones.
El enlace aún no aparece en Mando: el slug no está disponible en la sesión real; se comparte a mano.

## 3. Probar con una corrida real
1. En el teléfono inicia una corrida **real** (no marcada como prueba; las de prueba nunca se muestran).
2. En `/en-vivo` el mapa se centra en el camión (zoom 16) y se actualiza cada 15 s.
3. Camina o circula: el punto se mueve. La ruta aparece como línea punteada si existe, pero el mapa no se encuadra sobre ella.
4. Detente más de un minuto: la tarjeta pasa a "Detenido hace N min".
5. Apaga datos o el GPS unos 3 min: pasa a "Sin señal desde las HH:MM".
6. Cambia el ícono (punto, compactador, volquete, camioneta): se recuerda en ese navegador.

## 4. Sin corrida activa
La página muestra "Hoy aún no hay camiones en ruta".

## 5. Si falla la red
Se conserva la última posición y aparece "No pudimos actualizar. Reintentando…"; reintenta a 30 s y 60 s y vuelve a 15 s al recuperarse.

## Privacidad
La RPC solo devuelve código del camión, nombre de ruta, posición, rumbo, estado y horas. No expone placa, batería, conductor, velocidad ni litros.

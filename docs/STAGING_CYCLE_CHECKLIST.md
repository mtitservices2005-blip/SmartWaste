# Checklist del ciclo operativo en staging — SW-071

> Plan de lanzamiento · Días 5-6 · Ejecuta: Miguel o el operador autorizado del piloto
> Esta guía NO se ejecutó al escribirla: son los pasos que el equipo debe recorrer en **staging con datos reales**.

Esta lista sirve para recorrer, de principio a fin, el ciclo operativo completo de SmartWaste en el
entorno de **staging** — es decir, contra la base de datos real del municipio piloto, no contra la
demo. No hace falta terminal, SQL ni conocimientos de programación: todo se hace desde la aplicación
en el navegador.

## Antes de empezar (requisitos)

- Corre en el **despliegue de staging**, con cuentas reales provisionadas para el municipio piloto
  (ver `docs/STAGING_RUNBOOK.md`). Ten a mano un usuario de cada rol que necesites:
  `municipal_admin`, `dispatcher`, `supervisor` y `driver`.
- Ten al menos: 1 vehículo real, 1 chofer real y 1 sector real del municipio piloto.
- **Confirma que estás en staging real, no en la demo.** Si algún panel muestra la etiqueta
  **"Datos demo · no producción"**, o ves rutas/camiones de ejemplo mezclados con los reales, detente
  y repórtalo: el despliegue de staging debe mostrar solo datos reales (flag `SUPABASE_HIDE_DEMO=true`
  documentado en `docs/STAGING_RUNBOOK.md`). No sigas recorriendo el ciclo sobre datos demo.
- Navegación de referencia: la barra superior tiene **Resumen, Operaciones, Supervisor, Conductor,
  Ciudadanía, Impacto y Ahorros, Configuración, Master Admin**. Dentro de **Operaciones** hay
  pestañas: **Mapa, Rutas, Flotilla, Incidencias, Estadísticas**.
- Cómo registrar evidencia: captura de pantalla con fecha/hora visible, **sin** correos, contraseñas,
  enlaces de invitación ni datos personales de nadie. Anota el nombre del municipio piloto por su
  etiqueta, nunca URLs ni claves.

---

## [ ] Paso 1 — Crear una ruta

- **Acción:** entra en **Operaciones → Rutas**, abre el bloque colapsable **"+ Nueva ruta"**. Escribe
  un nombre para la ruta, elige (opcional) un vehículo disponible en la lista, y **haz clic sobre el
  mapa** para ir agregando los puntos del trazo en orden. Cuando termines, pulsa **"Finalizar y
  guardar"**. (Si te equivocas, usa **"Deshacer último punto"**.)
- **Resultado esperado:** la ruta aparece en **"Rutas del día"** con estado **planeada/planificada**
  (`planned`) y el número de paradas que trazaste. Su detalle muestra las paradas (completadas y
  pendientes) y el recorrido dibujado.
- **Si falla:** si el botón no responde o la ruta no aparece en la lista, recarga la página y vuelve a
  Operaciones → Rutas. Si persiste, captura la pantalla y el mensaje de error que aparezca y repórtalo.
  No intentes corregirlo por terminal ni por SQL.

## [ ] Paso 2 — Asignar vehículo y conductor

- **Acción:**
  1. Abre el detalle de la ruta (Haz clic en su fila en **Operaciones → Rutas** o en su trazo del
     mapa). Si la ruta no tiene vehículo, verás un selector y el botón **"Asignar vehículo"**:
     elige el vehículo real y pulsa el botón.
  2. Para el conductor: en el mismo detalle de ruta (o en el detalle del camión dentro de
     **Operaciones → Flotilla**) aparece un selector de chofer y el botón **"Asignar chofer"**
     (o **"Reasignar chofer"** si ya había uno). Elige el chofer real y confírmalo.
     - Alternativa guiada: en **Configuración**, activa la casilla **"Activar flujo guiado 'Poner en
       marcha'"**; entonces el detalle de ruta muestra un solo formulario con **"Poner en marcha"**
       que asigna vehículo, chofer e inicia en un solo paso.
- **Resultado esperado:** el detalle de ruta muestra en **"Unidad asignada"** el vehículo real y en
  **"Conductor"** el nombre del chofer real (ya no dice "Sin asignar"). El estado de la ruta pasa a
  **asignada** (`assigned`).
- **Si falla:** si la interfaz de tu versión no ofrece el selector de chofer, o el chofer correcto no
  aparece en la lista, **no manipules la base de datos ni uses SQL**. Pide al **operador autorizado**
  (`municipal_admin`/despachador) que **confirme que la asignación de ese chofer ya existe en staging**
  para esa ruta/vehículo, y vuelve a comprobar el detalle. Si la interfaz sí ofrece el control y aun
  así falla, captura la pantalla con el error visible y repórtalo.

## [ ] Paso 3 — Iniciar recorrido

- **Acción:** entra en la vista **Conductor** (barra superior) y elige en el selector el vehículo de
  la ruta que acabas de asignar. Pulsa **"Iniciar recorrido"**. (El operador/admin también puede
  iniciarla con **"Iniciar ruta"** desde el detalle de la ruta, como respaldo.)
- **Resultado esperado:** el estado de la ruta cambia a **iniciada / en progreso** (`started`,
  `in_progress`) y la vista Conductor muestra el avance. En el **mapa de Operaciones** el vehículo
  debe empezar a verse con su recorrido; si se usa GPS real, la insignia **●** de "GPS real" aparece
  junto al vehículo (el detalle fino de la insignia se cubre en `docs/GPS_FIELD_TEST.md`).
- **Si falla:** si el botón "Iniciar recorrido" no aparece, comprueba que la ruta figura como
  **asignada** (Paso 2) — no se puede iniciar sin vehículo asignado. Si tras iniciar el vehículo no se
  mueve en el mapa, espera unos segundos y refresca; si sigue igual, captura pantalla y repórtalo.

## [ ] Paso 4 — Completar recorrido

- **Acción:** en la vista **Conductor**, pulsa **"Finalizar recorrido"** (apaga la captura de GPS si
  estaba activa). El operador/admin también puede usar **"Marcar como completada"** en el detalle de
  la ruta, como respaldo.
- **Resultado esperado:** el estado de la ruta cambia a **completada** (`completed`) y la ruta aparece
  en **Supervisor → "Rutas pendientes de verificación"**. En el detalle de ruta, **Duración** y
  **Distancia** deben aparecer marcadas como **"medido"** (valor real medido) en vez de "estimado"
  cuando la corrida tuvo datos; y **"Evidencia GPS"** puede mostrar el número de puntos reales
  guardados.
- **Si falla:** si el botón no responde, refresca y reintenta; si ya no hay botón pero la ruta sigue
  "en progreso", reporta el estado exacto que muestra el detalle. Si la ruta se completó pero sigue
  mostrando "Duración estimado" en vez de "medido", anótalo como observación (puede ser señal de que
  faltó GPS) y repórtalo.

## [ ] Paso 5 — Verificar recorrido

- **Acción:** entra con un usuario **supervisor**, abre **Supervisor → "Panel de supervisor"** y en
  **"Rutas pendientes de verificación"** pulsa **"Verificar"** en la ruta completada.
- **Resultado esperado:** la ruta desaparece de "pendientes de verificación" y su estado pasa a
  **verificada** (`verified`). La verificación queda escrita contra la base real (no es solo visual).
- **Si falla:** si el botón "Verificar" no aparece, revisa que el usuario tenga rol **supervisor** y
  membresía activa en el municipio (ver `docs/ROLE_PERMISSION_MATRIX.md`). Si al pulsar aparece un
  error, captúralo y repórtalo; no verifiques por SQL.

## [ ] Paso 6 — Portal ciudadano

- **Acción:** abre **Ciudadanía** (el portal ciudadano es público, no requiere sesión). Pruébalo así:
  1. En **"Consulta de recogida"**, elige un sector real y consulta el día/estado del servicio.
  2. Revisa **"Avisos municipales"** (si hay avisos configurados para el sector).
  3. En **"Reportar incidencia"**, envía un reporte (p. ej. basura no recogida) y anota el **folio**
     que se genera. Luego consúltalo con el buscador de folio ("Consultar estado").
- **Resultado esperado:** la consulta por sector responde; el reporte se envía y muestra un
  **folio**; al consultar ese folio, el sistema devuelve el tipo y estado del reporte. El reporte
  real debería quedar visible para el supervisor en **"Reportes ciudadanos reales"** (barra de la
  vista Supervisor, dentro del panel de supervisor).
- **Si falla:** si el reporte no genera folio, o el folio no se encuentra al consultarlo, captura la
  pantalla con el mensaje mostrado y repórtalo. Si el portal responde con datos demo en vez de reales,
  detente y reporta (ver "Antes de empezar").

## [ ] Paso 7 — Métricas (evidencia del ciclo)

- **Acción:** revisa las métricas en su lugar:
  1. **Operaciones → Estadísticas**: mira **"Por ruta"** y **"Por chofer"**; debe aparecer la corrida
     que completaste en los Pasos 3–4, con número de corridas y duración promedio/última.
  2. **Impacto y Ahorros**: abre el **Centro de Impacto Operacional** y sus pestañas (p. ej.
     **Municipal 360°, Uso, Economía**) y revisa rutas, distancia y cumplimiento.
  3. Detalle de la ruta completada: confirma **Duración/Distancia "medido"** y **"Evidencia GPS"**.
- **Resultado esperado:** la ola completa del ciclo se refleja en las métricas — la corrida aparece en
  Estadísticas (por ruta y por chofer) y los indicadores de Impacto y Ahorros toman en cuenta la
  operación real. Todo lo que se calcula sobre corridas medidas se apoya en datos reales; lo que no
  tenga medición debe mostrarse como **"estimado"**, nunca como si fuera medido.
- **Cómo registrar la evidencia:** por cada métrica, crea una captura de pantalla que muestre el
  nombre del municipio y la fecha/hora, y anota junto a ella una nota corta (pestaña, qué indicador,
  valor observado). Guarda esa evidencia por el canal del proyecto acordado, **sin secretos, URLs ni
  identidades reales**. No inventes valores: si una métrica aparece vacía o "Cargando…", repórtalo tal
  cual, con su captura.
- **Si falla:** si Estadísticas muestra "Requiere un backend real conectado" o la lista queda vacía
  pese a haber completado la corrida, captura la pantalla y repórtalo como hallazgo (no lo rellenes a
  mano). Si Impacto y Ahorros no refleja la operación, registra el indicador exacto que no cuadra.

---

## Cierre

- Marca cada casilla solo cuando su **Resultado esperado** se haya confirmado en pantalla.
- Al terminar, guarda todas las capturas con su nota y entrégalas por el canal del proyecto.
- Si algún paso no se pudo completar, deja la casilla sin marcar y describe el bloqueo con su captura.
  Un paso fallido reportado honestamente vale más que un ciclo "completo" sin evidencia.

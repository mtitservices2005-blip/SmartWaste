# Checklist de go/no-go para producción — SW-072

> Plan de lanzamiento · Días 6-7. Esta lista es para **Miguel** (Project Owner). El **deploy a
> producción y la decisión final go/no-go los toma Miguel, no el pipeline**. Marcar cada casilla
> solo con evidencia reproducible y sin valores sensibles.
>
> No pegar claves, tokens, URLs con credenciales, enlaces de invitación ni identidades en esta
> lista ni en el PR. Los valores de entorno se citan **por nombre**.

## Estado global

- [ ] **Decisión go/no-go:** registrar explícitamente **GO** o **NO-GO** con fecha y responsable.
- [ ] Todas las casillas obligatorias de abajo están marcadas.
- [ ] Ninguna casilla quedó "pendiente de verificar" al momento de decidir.

---

## 1. CI verde

- [ ] El job **`unit-tests`** pasó en la CI de GitHub para esta rama/PR.
- [ ] El job **`integration-tests`** (Supabase local vía Docker) pasó en la CI de GitHub — incluye
      las **8 pruebas de integración local de Supabase**: `rls-adversarial`, `rls-coverage`,
      `operational-cycle`, `telemetry-persistence`, `gps-route-metrics`, `route-stops-persistence`,
      `route-paths-persistence` y el diagnóstico `telemetry-realtime-diagnosis`.
  > Nota: las 8 pruebas de integración local de Supabase quedan **pendientes de CI** (necesitan
  > Docker). No se declaran ejecutadas hasta que el job `integration-tests` de la CI las corra.
- [ ] La prueba anti `service-role` (control local, sección 4) corrió en la **matriz SW-072**.

## 2. Staging verificado

- [ ] El entorno de **staging** está desplegado con credenciales reales y
      `SUPABASE_BUILD_STRICT=true` configurado (por nombre de variable;
      ver `docs/STAGING_RUNBOOK.md`).
- [ ] El **checklist del ciclo operativo en staging (SW-071)** se recorrió de principio a fin y sus
      pasos están marcados (`docs/STAGING_CYCLE_CHECKLIST.md`).
- [ ] Staging muestra **solo datos reales** (sin etiqueta "Datos demo · no producción" ni rutas
      demo mezcladas), según lo exige el checklist SW-071.

## 3. Prueba GPS física

- [ ] La **prueba GPS física** (`docs/GPS_FIELD_TEST.md`) se ejecutó conduciendo un vehículo real.
- [ ] La insignia de **GPS real (●)** apareció sobre el vehículo correcto.
- [ ] El resultado de la prueba quedó **aprobado** y registrado aparte, sin datos personales.

## 4. Seguridad / escaneo

- [ ] El **escaneo de secretos** (`docs/SECURITY_PRELAUNCH.md`) reportó
      **sin secreto real** (`SCAN_STATUS=NO_HIGH_CONFIDENCE_SECRET_DETECTED`,
      worktree `0` / historial `0`).
- [ ] La **prueba anti `service-role`** está **verde** en la matriz SW-072 (falla si aparece
      `service_role` o una clave con forma de JWT de servicio en `frontend/` o `dist/`, y pasa con
      el código actual).
- [ ] Confirmado que la `service_role` **no** está configurada en Vercel ni llega al navegador.

## 5. Tag / rollback verificados

- [ ] El tag local **`pre-cutover-sw063`** existe y apunta exactamente a
      `0c17f98f4a45ca7a9ed9cba9990a16979bfda8ae` (ver `docs/ROLLBACK_PLAN.md`).
- [ ] Confirmado que el tag **NO se sube** (permanece local).
- [ ] `docs/ROLLBACK_PLAN.md` fue revisado: camino de rollback de Vercel y política de datos en
      Supabase claros, sin comandos que muten Vercel/Supabase.

## 6. Variables de entorno

- [ ] Variables de **staging** revisadas **por nombre**, sin incluir valores:
      `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BUILD_STRICT=true` (obligatorio en staging),
      opcionales `SUPABASE_MUNICIPALITY_ID` y `SUPABASE_HIDE_DEMO` si el piloto los necesita.
- [ ] Variables de **producción** revisadas **por nombre**, sin incluir valores; el build de
      producción es estricto automáticamente (`VERCEL_ENV=production`).
- [ ] Confirmado que `SUPABASE_SERVICE_ROLE_KEY` **no** está en Vercel ni en el build.

## 7. Decisión y comunicación

- [ ] **Decisión explícita GO / NO-GO** registrada por Miguel (no por el pipeline).
- [ ] Si es **GO**: autorizado el deploy a producción por Miguel.
- [ ] **Plan de monitoreo** definido: qué se observa tras el cutover, durante cuánto tiempo y con
      qué señales de alarma (login, escrituras reales, GPS real, errores de módulos).
- [ ] **Plan de comunicación** acordado por el canal aprobado, sin valores sensibles.
- [ ] Responsable del rollback y ventana de observación definidos.

---

> Recordatorio: ninguna casilla de CI, staging ni GPS se marca por el solo hecho de existir el
> documento o el script correspondiente. Cada casilla requiere evidencia real de ejecución. El
> pipeline prepara la evidencia; **Miguel decide el go/no-go y el deploy a producción**.

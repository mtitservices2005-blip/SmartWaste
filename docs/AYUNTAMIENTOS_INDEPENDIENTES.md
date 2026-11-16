# Cada ayuntamiento, independiente (SW-132)

Una sola plataforma con los datos aislados por ayuntamiento.

- **Una cuenta, un ayuntamiento.** Una persona no puede tener dos membresías activas (índice único en la base de datos). Para pasar a otro ayuntamiento, se desactiva la membresía anterior y se da de alta la nueva con otro correo.
- **El ayuntamiento lo manda la sesión.** Al iniciar sesión, la web usa el ayuntamiento de la cuenta para todo: ajustes, Ciudadanía, formulario de incidencias y sectores. El ayuntamiento configurado en el despliegue (`SUPABASE_MUNICIPALITY_ID`) solo se usa para quien no ha iniciado sesión.
- **Dirección pública propia.** El mapa en vivo de cada ayuntamiento es `https://<sitio>/en-vivo/<slug>`. Los enlaces anteriores `?m=<slug>` siguen funcionando. El administrador ve y copia su dirección en Configuración → Ayuntamiento.
- **El slug es único** (índice único en `municipalities.slug`) y se define al dar de alta el ayuntamiento. Cambiarlo rompe los enlaces ya compartidos.

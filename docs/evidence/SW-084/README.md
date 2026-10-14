# SW-084: evidencia visual

Capturas del centro de control y de las pantallas antiguas con los temas Mando, tomadas con Chromium sobre la build local (demo, mapa de OpenStreetMap real). Cumplen CA11 de `specs/SW-084.md`.

| Archivo | Qué muestra |
| --- | --- |
| centro-oscuro-escritorio.png, centro-claro-escritorio.png | Centro de control, 1280×844, tema oscuro y claro |
| centro-oscuro-telefono.png, centro-claro-telefono.png | Centro de control, 390×844: hoja inferior de flota y barra inferior |
| seleccion-oscuro-escritorio.png | Camión elegido: el detalle se abre dentro del panel de flota |
| mas-oscuro-escritorio.png | Menú "Más" con las demás secciones |
| rutas-claro-escritorio.png, flota-oscuro-escritorio.png | Pantallas aún no rediseñadas, adaptadas a los temas |

## Diferencias respecto al lienzo aprobado
- El mapa es OpenStreetMap real (en oscuro se oscurece con un filtro); el lienzo usaba un mapa dibujado.
- La tarjeta superior izquierda conserva los avisos de datos demo (regla permanente 7); en el lienzo era más corta.
- "Combustible" muestra "—" y "sin registros": hoy la plataforma no tiene un total de combustible del día; se mostrará cuando exista el dato.
- "Distancia de rutas" suma la distancia planificada de las rutas, no la recorrida; por eso lleva ese nombre.
- Los controles de simulación están en un menú "Simulación" que solo existe en modo demo.

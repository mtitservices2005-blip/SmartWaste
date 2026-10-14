# Guía de textos de la interfaz (SW-082)

Para quién escribimos: personal municipal y choferes en Laguna Salada, muchas veces con el teléfono en la mano y poco tiempo. Cada texto debe poder leerse y entenderse en una sola pasada.

## Reglas

1. **Español claro y directo.** Frases cortas, verbos de acción ("Iniciar recorrido", "Guardar camión"). Nada de jerga técnica (no "payload", "RLS", "sync", "token").
2. **Cada botón dice lo que hace.** "Guardar" solo si el contexto es obvio; mejor "Guardar camión". Nunca "Aceptar" o "OK" sueltos.
3. **Los errores dicen qué pasó y qué hacer.** Ejemplo: "No se pudo guardar. Revisa tu conexión y vuelve a intentar." No culpar a la persona ni mostrar códigos.
4. **Los estados vacíos orientan.** Título corto + una frase + (si aplica) el botón para empezar. Ejemplo: "Todavía no hay camiones" / "Agrega el primer camión para empezar." / [Agregar camión].
5. **Estado = color + icono + texto.** Nunca solo color (las personas con daltonismo y el sol directo lo pierden). Usar `badge()`.
6. **Todo campo tiene etiqueta visible o, como mínimo, nombre accesible (`aria-label`).** El placeholder es un ejemplo, no la etiqueta. Usar `field()` en pantallas nuevas.
7. **Textos de demostración solo en modo demo.** "Datos demo", "Simulación demo" se ocultan cuando el despliegue usa `hideDemo` (ver `frontend/ui-mode.js`).
8. **Números y unidades legibles.** "4 de 5 camiones", "hace 12 s", "12,4 km". Fechas en formato local.
9. **Objetivos táctiles de 48 px** en la vista del chofer y en móvil; contraste mínimo 4,5:1 (7:1 en modo de alto contraste).

## Vocabulario de estados de flotilla

| Estado | Texto | Cuándo |
|---|---|---|
| en-ruta | En ruta | Se mueve con señal reciente |
| detenido | Detenido | Menos de 1 m/s por más de 5 minutos |
| sin-senal | Sin señal | Sin posición hace más de 90 s |
| disponible | Disponible | Sin recorrido activo |
| fuera-servicio | Fuera de servicio | Marcado por el municipio |

## Componentes

`frontend/components/`: `button`, `badge`, `field`, `toast`, `emptyState`, `statusCard`, `dataTable`, `skeleton`. Colores y tamaños salen de `frontend/styles/tokens.css`; `scripts/check-contrast.mjs` verifica los pares de contraste.

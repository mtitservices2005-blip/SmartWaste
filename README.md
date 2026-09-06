# SmartWaste Alpha

> Este proyecto participa en la [Infraestructura Karpathy de MT IT Services](https://github.com/mtitservices2005-blip/MTIT-Blueprint). Agentes y desarrolladores deben empezar por [`AGENTS.md`](AGENTS.md), respetar las reglas permanentes de [`CLAUDE.md`](CLAUDE.md) y usar el [contexto local sincronizado](docs/KARPATHY_CONTEXT.md) cuando el repositorio central no esté accesible.

SmartWaste es una demo Alpha visual para ayuntamientos que necesitan monitorear rutas de recolección de residuos, camiones, sectores, incidencias y cumplimiento operativo.

> Datos demo · no producción

## Demos

**Importante:** `frontend/app.js` usa módulos ES con imports relativos. Abrir `frontend/index.html` con doble clic (protocolo `file://`) hace que Chrome/Edge bloqueen esos imports por CORS y la página quede en blanco, sin ningún error visible. Hay que servirlo por `http://localhost`:

- Windows: doble clic en `iniciar-demo.bat` (en la raíz del repo) — levanta el servidor y abre el navegador solo.
- Cualquier sistema: `node scripts/serve-demo.mjs` desde la raíz del repo, y abrir `http://localhost:8080/` (requiere Node, sin dependencias extra).

Con eso:
- Demo principal: `http://localhost:8080/frontend/index.html` (la raíz `/` sirve lo mismo).
- Demo end-to-end: `http://localhost:8080/frontend/e2e-demo/index.html`.

## Alcance Alpha

- SaaS multiinstitución con Ayuntamiento y Master Admin de MT IT Services.
- Mapa operativo local sin APIs externas.
- Panel municipal, portal ciudadano, vista supervisor, vista móvil conductor y consola Master Admin.
- Datos estáticos para demostración, sin secretos ni servicios con costo.

## Estructura

- `frontend/`: demos visuales estáticas.
- `backend/`: contratos y módulos placeholder para API futura.
- `shared/`: modelos de dominio demo compartidos.
- `docs/`: arquitectura, roadmap, datos, piloto y readiness.
- `tests/`: validaciones ligeras de Alpha.
- `supabase/`: preparación futura de esquema y políticas.

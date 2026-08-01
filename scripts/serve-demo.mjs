// Servidor estático sin dependencias para la demo de SmartWaste.
//
// Por qué existe: frontend/app.js usa imports de módulos ES (`type="module"`) con rutas relativas
// a `shared/`. Los navegadores (Chrome, Edge) bloquean esos imports por política CORS cuando el
// archivo se abre con doble clic (protocolo `file://`), dejando la página en blanco sin ningún
// error visible. Este script sirve el repo por `http://localhost`, donde los módulos sí cargan.
//
// Uso: `node scripts/serve-demo.mjs` desde la raíz del repo, o doble clic en `iniciar-demo.bat`
// (Windows), que además abre el navegador automáticamente.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // Real redirect, not an internal rewrite: if we just served frontend/index.html's bytes under
    // the URL "/", the browser's base URL for resolving index.html's relative <link>/<script> paths
    // (./styles.css, ./app.js) would stay "/" — producing 404s for /styles.css and /app.js instead
    // of the real /frontend/styles.css and /frontend/app.js. A 302 makes the browser's address bar
    // (and therefore its relative-URL base) actually become /frontend/index.html.
    if (urlPath === '/') {
      res.writeHead(302, { Location: '/frontend/index.html' });
      res.end();
      return;
    }
    const filePath = normalize(join(ROOT, urlPath));
    // Guard against path traversal outside the repo root.
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    // No-cache: sin esto, el navegador puede quedarse con una versión vieja de app.js/auth-gate.js
    // cacheada aunque el archivo en disco haya cambiado — confuso justo en una demo en vivo.
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`SmartWaste demo corriendo en http://localhost:${PORT}/`);
  console.log('Dejá esta ventana abierta mientras dure la demo. Ctrl+C para detener.');
});

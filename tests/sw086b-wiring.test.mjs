// SW-086b: comprobaciones estáticas del cableado de "Editar ruta" (sin navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../shared/operations-adapter.js', import.meta.url), 'utf8');

test('el botón Editar abre el modo edición y no el panel de detalle', () => {
  assert.match(app, /data-route-edit="\$\{escapeHtmlText\(route\.id\)\}">Editar</);
  assert.match(app, /closest\('\[data-route-edit\]'\)/);
  assert.match(app, /function openEditRoute/);
});
test('guardar en modo edición usa la función atómica y los validadores puros', () => {
  assert.match(app, /if \(editingRouteId\) return finishEditRoute\(\)/);
  assert.match(app, /realAdapter\.replaceRouteGeometry\(/);
  assert.match(app, /validateEdit\(/);
  assert.match(adapter, /client\.rpc\('replace_route_geometry'/);
});
test('con la ruta en marcha el trazo queda bloqueado', () => {
  assert.match(app, /createRouteLocked = !geo\.ok/);
  assert.match(app, /if \(createRouteLocked\) return;/);
});
test('el cliente no usa service_role', () => {
  assert.doesNotMatch((app + adapter).replace(/^\s*\/\/.*$/gm, ''), /service_role\s*[:=]|SERVICE_ROLE_KEY/);
});

// Guardia de despliegue: scripts/build-frontend-config.mjs copia frontend/ a dist/ y solo reescribe '../shared/'
// en los .js de primer nivel. Un componente en frontend/components/ que importe de shared/ se rompe en Vercel y
// en el APK (la ruta '../../shared/' queda fuera de dist/). Los componentes solo importan de otros componentes.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../frontend/components/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(new URL(file, dir), 'utf8');
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    assert.ok(m[1].startsWith('./'), `${file} importa "${m[1]}": los componentes solo pueden importar de ./ (pasa los datos desde app.js)`);
  }
}
console.log('components-imports ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenario = readFileSync(new URL('../frontend/e2e-demo/scenario.js', import.meta.url), 'utf8');
for (const phrase of ['Ayuntamiento configura ruta', 'Mapa muestra avance', 'Dashboard actualiza cumplimiento']) {
  assert.ok(scenario.includes(phrase));
}
console.log('e2e-demo ok');

// SCOPE: static text check on a demo-scenario script — does NOT open a browser and does NOT
// exercise the actual frontend. It only guards against the scenario copy losing these phrases.
// There is no real (browser-driven) E2E coverage of the frontend yet; see
// docs/TECHNICAL_DEBT_REGISTER.md item #5 and shared/integration/status.json (sw017.e2eReal).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenario = readFileSync(new URL('../frontend/e2e-demo/scenario.js', import.meta.url), 'utf8');
for (const phrase of ['Ayuntamiento configura ruta', 'Mapa muestra avance', 'Dashboard actualiza cumplimiento']) {
  assert.ok(scenario.includes(phrase));
}
console.log('e2e-demo ok');

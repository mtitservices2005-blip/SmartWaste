// SCOPE (docs/TECHNICAL_DEBT_REGISTER.md #5): this checks that specific phrases exist in the
// scenario.js source text — it never opens a browser or exercises frontend/e2e-demo/index.html.
// "e2e" here names the demo scenario the frontend script narrates, not an executed end-to-end test.
// shared/integration/status.json tracks the real frontend/browser E2E as REAL_NOT_RUN.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenario = readFileSync(new URL('../frontend/e2e-demo/scenario.js', import.meta.url), 'utf8');
for (const phrase of ['Ayuntamiento configura ruta', 'Mapa muestra avance', 'Dashboard actualiza cumplimiento']) {
  assert.ok(scenario.includes(phrase));
}
console.log('e2e-demo ok');

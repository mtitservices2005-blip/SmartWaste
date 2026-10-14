// SW-082 (CA-082-1): los textos "demo / simulación" solo aparecen cuando la interfaz está en modo demo.
// En un despliegue real (hideDemo) la persona usuaria no ve avisos técnicos ni jerga de demostración.
import assert from 'node:assert/strict';
import { isDemoUi, demoOnly, demoLine } from '../frontend/ui-mode.js';

assert.equal(isDemoUi(undefined), true, 'sin configuración = demo (no romper la demo aprobada)');
assert.equal(isDemoUi({ url: 'u', anonKey: 'k' }), true, 'backend sin hideDemo sigue mostrando demo');
assert.equal(isDemoUi({ hideDemo: true }), false);

assert.equal(demoOnly('Datos demo · no producción', { hideDemo: true }), '');
assert.equal(demoOnly('Datos demo · no producción', undefined), 'Datos demo · no producción');

assert.equal(demoLine('Datos demo', { hideDemo: true }), '', 'sin demo no queda un <p> vacío');
assert.equal(demoLine('Datos demo <b>', undefined), '<p class="demo">Datos demo &lt;b&gt;</p>');
assert.equal(demoLine('Datos demo', undefined, 'extra'), '<p class="demo extra">Datos demo</p>');
console.log('ui-mode ok');

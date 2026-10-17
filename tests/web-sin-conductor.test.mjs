// SW-094: la web ya no tiene la sección "Conductor" (los choferes usan la app del celular).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MORE_ITEMS } from '../frontend/components/rail.js';
import { SECTION_ROLES } from '../frontend/auth-gate.js';
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.ok(!MORE_ITEMS.some((i) => i.href === '#conductor'), 'el menú no debe tener Conductor');
assert.ok(!('conductor' in SECTION_ROLES), 'no debe haber permisos para una sección conductor');
assert.ok(!/\$\{renderDriverSection\(\)\}/.test(app), 'el layout no debe pintar la sección conductor');
assert.ok(app.includes("$('#driverVehicleSelect')?.addEventListener"), 'el selector del conductor debe ser opcional');
assert.ok(app.includes("if (!document.getElementById('driverMap')) return;"), 'initDriverMap debe salir si no hay mapa del conductor');
console.log('web-sin-conductor: ok');

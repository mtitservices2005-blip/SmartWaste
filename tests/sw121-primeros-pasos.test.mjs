// SW-121: lista de primeros pasos del ayuntamiento nuevo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChecklist } from '../shared/onboarding-checklist.js';
import { renderChecklist } from '../frontend/components/onboarding-checklist-screen.js';

const truck = (eff) => ({ id: 't', fuel_efficiency_km_per_l: eff });

// ayuntamiento recién creado: nada hecho, el primer paso es "datos"
const fresh = buildChecklist({});
assert.equal(fresh.doneCount, 0); assert.equal(fresh.total, 5); assert.equal(fresh.complete, false);
assert.equal(fresh.nextId, 'datos'); assert.equal(fresh.percent, 0);
assert.deepEqual(fresh.items.map((i) => i.id), ['datos', 'costos', 'camiones', 'choferes', 'ruta']);
assert.equal(buildChecklist().doneCount, 0, 'sin argumentos tampoco rompe');

// se marca solo
assert.equal(buildChecklist({ profileConfigured: true }).items[0].done, true);
assert.equal(buildChecklist({ profileConfigured: true }).nextId, 'costos');
assert.equal(buildChecklist({ costConfigured: true }).items[1].done, true);
assert.equal(buildChecklist({ drivers: [{}] }).items[3].done, true);
assert.equal(buildChecklist({ routes: [{}] }).items[4].done, true);

// camiones: hacen falta camiones Y su rendimiento
const none = buildChecklist({ trucks: [] }).items[2];
assert.equal(none.done, false); assert.match(none.hint, /Registra tus camiones/); assert.equal(none.action, 'Registrar camiones');
const partial = buildChecklist({ trucks: [truck(5), truck(null), truck(0)] }).items[2];
assert.equal(partial.done, false); assert.match(partial.hint, /Faltan 2 camiones/); assert.equal(partial.action, 'Completar rendimiento');
assert.match(buildChecklist({ trucks: [truck(null)] }).items[2].hint, /Falta|Faltan 1 camión sin/);
assert.equal(buildChecklist({ trucks: [truck(5), truck('4.2')] }).items[2].done, true);
assert.equal(buildChecklist({ trucks: [truck(-1)] }).items[2].done, false, 'un rendimiento negativo no cuenta');

// completo: la tarjeta desaparece
const all = buildChecklist({ profileConfigured: true, costConfigured: true, trucks: [truck(5)], drivers: [{}], routes: [{}] });
assert.equal(all.complete, true); assert.equal(all.percent, 100); assert.equal(all.nextId, null);
assert.equal(renderChecklist(all), '');
assert.equal(renderChecklist(null), '');

// pantalla
const html = renderChecklist(buildChecklist({ profileConfigured: true, trucks: [truck(5)] }));
for (const w of ['Primeros pasos', '2 de 5', 'role="progressbar"', 'aria-valuenow="2"', 'width:40%', 'Datos del ayuntamiento', ' · Listo', 'href="#configuracion"', 'href="#operaciones/rutas"', 'is-next']) assert.ok(html.includes(w), w);
assert.equal((html.match(/is-done/g) || []).length, 2, 'dos pasos hechos');
assert.equal((html.match(/btn-primary/g) || []).length, 1, 'un solo botón destacado: el siguiente paso');
assert.ok(!html.includes('Nombre oficial, logo'), 'un paso hecho no repite su explicación');

// cableado
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
for (const w of ['renderOnboardingSteps()', 'refreshOnboardingSteps()', 'buildChecklist({ profileConfigured']) assert.ok(app.includes(w), w);
assert.ok(/HIDE_DEMO \? `<div id="onboardingSteps">/.test(app), 'solo en producción, nunca en la demo');
assert.ok(!/HIDE_DEMO \? `\$\{pilotMunicipality\.name\}/.test(app), 'el título del Resumen ya no usa el nombre del piloto escrito a mano');
console.log('sw121-primeros-pasos ok');

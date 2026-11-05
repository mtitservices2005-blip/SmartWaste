// SW-112: en un despliegue real (hideDemo) no se muestran datos ni textos de demostración.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderRail } from '../frontend/components/rail.js';

const src = readFileSync('frontend/app.js', 'utf8');
const fn = (name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i > -1, `existe ${name}`); const rest = src.slice(i); const end = rest.indexOf('\n}\n'); return rest.slice(0, end > -1 ? end + 3 : 3500); };

// Los arreglos de demostración se vacían con hideDemo (incluidos sectores, avisos y municipios).
assert.match(src, /if \(readSupabaseConfig\(\)\?\.hideDemo\) \{[^}]*sectors\.length = 0; notifications\.length = 0; municipalities\.length = 0;/);
assert.match(src, /const HIDE_DEMO = Boolean\(readSupabaseConfig\(\)\?\.hideDemo\);/);

// Ciudadanía: sin "Consulta de recogida" ni "Avisos municipales" de la demo; los oyentes toleran que no existan.
const citizen = fn('renderCitizen');
assert.match(citizen, /HIDE_DEMO \? ''/);
assert.match(src, /\$\('#citizenSector'\)\?\.addEventListener/);
assert.match(src, /\$\('#citizenSector'\)\?\.dispatchEvent/);

// Master Admin: solo municipios reales, sin tarjetas demo ni "arquitectura futura".
const master = fn('renderMaster');
assert.match(master, /if \(HIDE_DEMO\) return[^;]*renderMasterCostParametersSection\(\)/);
assert.ok(!/if \(HIDE_DEMO\) return[^;]*(data-onboarding|integrationsReady)/.test(master));

// Impacto y Ahorros: sin cifras de demostración.
assert.match(fn('renderImpactCenter'), /if \(HIDE_DEMO\) return '<section id="impacto"/);

// Detalle del camión: solo campos reales.
const grid = fn('realTruckGrid');
for (const word of ['speedKmh', 'loadLevel', 'nextStop', 'demo']) assert.ok(!grid.includes(word), `el detalle real no usa ${word}`);
assert.match(src, /HIDE_DEMO \? realTruckGrid\(truck\)/);

// Rótulos de demo fuera: eyebrow, municipio piloto, historial demo, folio de ejemplo.
assert.match(src, /HIDE_DEMO \? 'SmartWaste' : pilotMunicipality\.branding\.label/);
assert.match(src, /HIDE_DEMO \? '' : `<button data-history/);
assert.match(src, /value="\$\{HIDE_DEMO \? '' : 'SW-FOLIO-1001'\}"/);

// Barra lateral: con hideDemo no hay enlace a Impacto; sin hideDemo sigue igual.
assert.ok(!renderRail({ hash: '', hideDemo: true }).includes('href="#impacto"'));
assert.ok(renderRail({ hash: '', hideDemo: false }).includes('href="#impacto"'));
assert.ok(!renderRail({ hash: '', hideDemo: true }).includes('DEMO'));
console.log('sw112-sin-demo ok');

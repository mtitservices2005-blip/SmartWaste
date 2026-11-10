// SW-116: los parámetros de costo los administra cada ayuntamiento (Configuración); Master Admin ve municipios, suscripción y consumo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('frontend/app.js', 'utf8');
const fn = (name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i > -1, `existe ${name}`); const rest = src.slice(i); const end = rest.indexOf('\n}\n'); return rest.slice(0, end > -1 ? end + 3 : 4000); };

// Configuración: formulario del ayuntamiento con precio, días operativos y costo por hora (en producción)
assert.match(src, /const MUNICIPAL_COST_KEYS = \['fuelPrice', 'operatingDays', 'hourlyCost'\];/);
assert.match(fn('renderConfiguracion'), /Parámetros de costo del ayuntamiento/);
assert.match(fn('renderConfiguracion'), /data-cost-parameters-form="municipal"/);
assert.match(fn('renderConfigCostParameters'), /data-save-cost-parameters="municipal"/);
assert.match(fn('renderConfigCostParameters'), /HIDE_DEMO \? MUNICIPAL_COST_KEYS : null/);
// Al guardar solo algunos campos, los demás conservan su valor
assert.match(src, /\{ \.\.\.\(municipalityToken === 'municipal' \? impactCostParameters : \{\}\)/);
assert.match(fn('hydrateCostParameters'), /refreshConfigCostParameters\(\)/);

// Master Admin: sin parámetros de costo; con municipios reales, suscripción y consumo
const master = fn('renderMaster') + fn('renderMasterMunicipalities');
assert.ok(!/cost-parameters|Parámetros de costo por municipio/.test(master), 'Master Admin no edita parámetros de los ayuntamientos');
assert.match(fn('renderMasterMunicipalities'), /renderMasterLicense\(buildMasterLicenseView/); // SW-117: la suscripción vive en el bloque de licencia
assert.match(fn('renderMasterMunicipalities'), /Corridas completadas \(30 días\)/);
assert.ok(!src.includes('loadMasterCostParameters(municipalityId)'), 'se quitó la carga de parámetros por municipio en Master');
assert.ok(!src.includes('data-cost-parameters-toggle'));
assert.match(src, /select\('id, name, status'\)/);
console.log('sw116-config-municipal ok');

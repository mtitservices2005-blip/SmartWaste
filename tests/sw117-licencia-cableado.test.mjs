// SW-117: la licencia está conectada a la app (Configuración, Master Admin, aviso superior y errores legibles).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('frontend/app.js', 'utf8');
const fn = (name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i > -1, `existe ${name}`); const rest = src.slice(i); const end = rest.indexOf('\n}\n'); return rest.slice(0, end > -1 ? end + 3 : 4000); };

assert.match(src, /from '\.\.\/shared\/license-data\.js'/); assert.match(src, /from '\.\/components\/license-screens\.js'/);
// Configuración: bloque oculto hasta que exista licencia; solo en producción
assert.match(fn('renderConfiguracion'), /id="configLicenseWrap" hidden/); assert.match(fn('renderConfiguracion'), /Tu suscripción/);
assert.match(fn('refreshLicenseUi'), /wrap\.hidden = !licenseState\.license/);
assert.match(fn('refreshLicenseUi'), /banner\.tone !== 'info'/, 'el aviso de prueba no ocupa la parte superior');
assert.match(src, /app\.innerHTML = `<div id="licenseBanner"><\/div>\$\{renderSummary\(\)\}/);
// Arranque
assert.match(src, /hydrateCostParameters\(\); hydrateLicense\(\); hydrateMasterRealMunicipalities\(\);/);
assert.match(fn('hydrateLicense'), /if \(!client \|\| !HIDE_DEMO\) return;/);
assert.match(fn('hydrateLicense'), /fetchLicense\(client, municipalityId\)/); assert.match(fn('hydrateLicense'), /countVehicles\(client, municipalityId\)/);
// Master Admin: carga todas las licencias y las pinta por ayuntamiento
assert.match(fn('hydrateMasterRealMunicipalities'), /fetchAllLicenses\(client\)/);
assert.match(fn('renderMasterMunicipalities'), /masterLicenses\[m\.id\]/);
assert.ok(!src.includes('sin plan asignado todavía'));
// Botones y acciones
const handler = fn('handleLicenseClick');
for (const call of ['addTrucks(client', 'createLicense(client', 'saveLicenseTerms(client', 'registerPayment(client', 'setSuspended(client', 'markEventBilled(client']) assert.ok(handler.includes(call), `maneja ${call}`);
assert.match(handler, /validateTruckRequest\(licenseState\.panel\.trucks\)/);
assert.match(src, /\[data-license-open\], \[data-license-cancel\], \[data-license-confirm\], \[data-license-create\], \[data-license-save\], \[data-license-pay\], \[data-license-suspend\], \[data-license-reactivate\], \[data-license-billed\]/);
assert.match(src, /matches\?\.\('\[data-license-trucks\]'\)/);
// Errores de licencia legibles al crear camiones, rutas y conductores
assert.match(fn('requireRealAdapter'), /licenseErrorMessage\(raw\) \?\? failureMessage\(raw\)/);
assert.match(fn('requireRealAdapter'), /licenseErrorMessage\(error\.message\) \?\? failureMessage\(error\.message\)/);
// La app del chofer no consulta licencias
const driverPart = src.slice(src.indexOf('async function startDriverExperience'), src.indexOf('async function bootstrapRealBackend'));
assert.ok(!/license/i.test(driverPart), 'el chofer nunca depende de la licencia');
console.log('sw117-licencia-cableado ok');

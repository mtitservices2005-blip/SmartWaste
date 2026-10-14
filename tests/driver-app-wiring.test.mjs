// SW-083: frontend/app.js conecta la sesión nativa del chofer con lotes (ingest_positions) y latido,
// y los detiene al terminar. Prueba estática: app.js no se puede cargar sin navegador.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('frontend/app.js', 'utf8');
const start = app.indexOf('async function startDriverGps()');
const stop = app.indexOf('async function stopDriverGps(');
assert.ok(start > -1 && stop > start, 'no se encontraron startDriverGps/stopDriverGps');
const startBody = app.slice(start, stop);
const stopBody = app.slice(stop, stop + 1500);
assert.match(startBody, /batchAdapter:\s*realAdapter/, 'la sesión nativa debe enviar por lotes con realAdapter.ingestPositions');
assert.match(startBody, /session\.startHeartbeat\(\)/, 'debe iniciar el latido');
assert.match(stopBody, /driverTelemetrySession\?\.stop\(\)/, 'debe detener latido y reintentos al terminar');
// el latido se detiene antes de soltar la sesión
assert.ok(stopBody.indexOf('driverTelemetrySession?.stop()') < stopBody.indexOf('driverTelemetrySession = null'), 'stop() antes de soltar la sesión');

// Combustible al finalizar (CA-083-4): campo con etiqueta visible, validación antes de apagar el GPS y
// registro con el camión y la corrida de la asignación.
const lifecycle = app.slice(app.indexOf('function driverRouteLifecycleControl('), app.indexOf('function renderDriverMobile('));
assert.match(lifecycle, /<label[^>]*for="driverFuelLiters"[^>]*>[^<]*combustible/i, 'etiqueta visible del campo de litros');
assert.match(lifecycle, /id="driverFuelLiters"/);
assert.match(lifecycle, /inputmode="decimal"/);
const completeBody = app.slice(app.indexOf('async function driverCompleteRoute('), app.indexOf('async function completeRouteManually('));
assert.match(completeBody, /parseFuelLiters\(/);
assert.match(completeBody, /buildFuelEntry\(/);
assert.match(completeBody, /logFuel\(/);
assert.ok(completeBody.indexOf('parseFuelLiters(') < completeBody.indexOf('stopDriverGps('), 'valida los litros antes de apagar el GPS');
assert.ok(completeBody.indexOf('logFuel(') < completeBody.indexOf('completeRouteManually('), 'registra el combustible mientras la asignación sigue vigente');
console.log('driver-app-wiring ok');

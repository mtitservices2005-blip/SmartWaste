// SW-095: prueba estática del cableado del modo sin internet (app.js y driver-app.js no cargan sin navegador).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('frontend/app.js', 'utf8');
const drv = readFileSync('frontend/driver-app.js', 'utf8');

// app.js: el GPS arranca sin red con la asignación guardada de la corrida abierta
const gpsStart = app.indexOf('async function startDriverGps()');
const gpsBody = app.slice(gpsStart, app.indexOf('async function stopDriverGps(', gpsStart));
assert.match(gpsBody, /createOfflineAssignmentAdapter\(realAdapter/, 'asignación en caché para el GPS');
assert.match(gpsBody, /batchAdapter:\s*realAdapter/, 'el envío por lotes sigue con realAdapter');
const exp = app.slice(app.indexOf('async function startDriverExperience('), app.indexOf('async function bootstrapRealBackend('));
assert.match(exp, /storage:\s*localStorage/, 'copia y cola en localStorage');
assert.match(exp, /gpsFlush:/, 'vaciar el GPS pendiente antes de terminar');
assert.match(exp, /driverOfflineAssignment/, 'guarda la asignación que manda el controlador');

// driver-app.js: crea copia y cola, sincroniza en los momentos clave y delega Reintentar/Descartar
assert.match(drv, /createDriverActionQueue\(/);
assert.match(drv, /createDriverCache\(/);
assert.match(drv, /addEventListener\?\.\('online'[\s\S]{0,200}syncQueue\(\)/, 'al volver la señal');
assert.match(drv, /visibilitychange[\s\S]{0,300}syncQueue\(\)/, 'al volver a la app');
assert.match(drv, /setInterval\?\.\(\(\) => controller\.syncQueue\(\)/, 'cada minuto');
assert.match(drv, /data-driver-retry-action/); assert.match(drv, /data-driver-discard-action/);
assert.match(drv, /retry-action/); assert.match(drv, /discard-action/);
assert.match(drv, /cache\?\.clear\(\)/, 'cerrar sesión borra la copia, no la cola');
console.log('driver-offline-wiring: ok');

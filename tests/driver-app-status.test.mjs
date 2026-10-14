// SW-083: estado de conexión visible para el chofer, en español claro (icono + texto, nunca solo color).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectionStatusText } from '../shared/driver-app-status.js';

assert.equal(connectionStatusText({ online: true, pending: 0 }), 'Conectado · todo enviado');
assert.equal(connectionStatusText({ online: true, pending: 1 }), 'Conectado · enviando 1 posición…');
assert.equal(connectionStatusText({ online: true, pending: 12 }), 'Conectado · enviando 12 posiciones…');
assert.equal(connectionStatusText({ online: false, pending: 0 }), 'Sin conexión · se guardará todo y se enviará al reconectar');
assert.equal(connectionStatusText({ online: false, pending: 1 }), 'Sin conexión · 1 posición guardada, se enviará al reconectar');
assert.equal(connectionStatusText({ online: false, pending: 30 }), 'Sin conexión · 30 posiciones guardadas, se enviarán al reconectar');
assert.equal(connectionStatusText({ online: true, pending: -4 }), 'Conectado · todo enviado', 'valores raros no rompen');

const app = readFileSync('frontend/app.js', 'utf8');
const mobile = app.slice(app.indexOf('function renderDriverMobile('), app.indexOf('function renderDriverMobile(') + 2500);
assert.match(mobile, /id="driverConnectionStatus"[^>]*role="status"/, 'estado de conexión visible y anunciable');
assert.match(app, /addEventListener\('offline'/, 'reacciona al corte de conexión');
assert.match(app, /connectionStatusText\(/);
console.log('driver-app-status ok');

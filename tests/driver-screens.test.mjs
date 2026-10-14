// SW-085 (CA1, CA3, CA4, CA5): las cuatro pantallas de la app del conductor. HTML puro, texto escapado,
// sin dato → "—" o mensaje claro, y acciones con data-attributes que app.js ya sabe delegar.
import assert from 'node:assert/strict';
import { renderDriverToday, renderDriverRun, renderDriverFinish, renderDriverAccess } from '../frontend/components/driver-screens.js';

const route = (id, o = {}) => ({ id, routeName: `Ruta ${id}`, stopsCount: 12, distanceText: '6,4 km', estimatedMinutes: 42, slot: 'proxima', startLabel: null, ...o });

// ---- Hoy
const today = renderDriverToday({
  name: 'Carlos', dateText: 'Miércoles 14 de octubre', unit: 'C-01', gpsActive: true,
  routes: [route('Centro', { slot: 'siguiente', startLabel: '8:00 a. m.' }), route('Mercado', { stopsCount: 9, distanceText: '4,2 km', startLabel: '11:00 a. m.' }), route('Playa', { stopsCount: 8, distanceText: '3,9 km', startLabel: '2:00 p. m.' })]
});
assert.ok(today.includes('Hola, Carlos'));
assert.ok(today.includes('Miércoles 14 de octubre · Camión C-01'));
assert.ok(today.includes('GPS activo'));
assert.ok(today.includes('Rutas de hoy · 3'));
assert.equal((today.match(/data-driver-start-route=/g) ?? []).length, 1, 'solo la siguiente tiene Iniciar');
assert.match(today, /data-driver-start-route="Centro"[^>]*>Iniciar ruta</);
assert.ok(today.includes('12 paradas · 6,4 km · tiempo estimado 42 min'));
assert.ok(today.includes('8:00 a. m.'));
assert.ok(today.includes('Disponible a las 11:00 a. m.') && today.includes('Disponible a las 2:00 p. m.'));
assert.ok(today.includes('Al iniciar, tu ubicación se comparte con la central en tiempo real.'));

const todayNoGps = renderDriverToday({ name: 'Ana', dateText: 'x', unit: 'C-02', gpsActive: false, routes: [] });
assert.ok(!todayNoGps.includes('GPS activo'), 'sin GPS no dice que está activo');
assert.ok(todayNoGps.includes('GPS inactivo'));
assert.ok(todayNoGps.includes('No tienes rutas asignadas para hoy'), 'sin rutas: mensaje claro');
assert.ok(!todayNoGps.includes('data-driver-start-route'));

const todayNoTime = renderDriverToday({ name: 'Ana', dateText: 'x', unit: null, gpsActive: false, routes: [route('R', { slot: 'proxima' })] });
assert.ok(!todayNoTime.includes('Disponible a las'), 'sin hora no inventa una');
assert.ok(todayNoTime.includes('Camión —') || !todayNoTime.includes('Camión undefined'));

const todayActive = renderDriverToday({ name: 'Luis', dateText: 'x', unit: 'C-03', gpsActive: true, routes: [route('A', { slot: 'en-curso' }), route('B')] });
assert.match(todayActive, /data-driver-open-run="A"[^>]*>Continuar ruta</);
assert.ok(!todayActive.includes('data-driver-start-route'));
const todayDone = renderDriverToday({ name: 'Luis', dateText: 'x', unit: 'C-03', gpsActive: true, routes: [route('H', { slot: 'completada' })] });
assert.ok(todayDone.includes('Completada'));

const evil = renderDriverToday({ name: '<img src=x onerror=1>', dateText: 'x', unit: '<b>', gpsActive: true, routes: [route('<script>', { slot: 'siguiente' })] });
assert.ok(!evil.includes('<img') && !evil.includes('<script>') && !evil.includes('<b>'), 'todo texto se escapa');

// ---- En ruta
const run = renderDriverRun({ unit: 'C-01', connected: true, routeName: 'Ruta Centro', progressText: '7 de 12 paradas', nextStopLabel: 'Calle Duarte 24', nextStopDistance: '350 m', timeText: '00:42', distanceText: '6,4 km', pendingText: '5' });
assert.ok(run.includes('id="driverRunMap"'), 'contenedor del mapa');
assert.ok(run.includes('Camión C-01') && run.includes('Conectado'));
assert.ok(run.includes('Ruta Centro') && run.includes('7 de 12 paradas'));
assert.ok(run.includes('Siguiente parada') && run.includes('Calle Duarte 24') && run.includes('350 m'));
assert.ok(run.includes('Tiempo') && run.includes('00:42') && run.includes('Distancia') && run.includes('6,4 km') && run.includes('Pendientes'));
assert.match(run, /data-driver-finish-open[^>]*>Terminar ruta</, 'Terminar abre la pantalla de cierre, no termina directo');
assert.ok(!run.includes('data-driver-complete-route'), 'no hay terminar directo');
const runOff = renderDriverRun({ unit: 'C-01', connected: false, routeName: 'R', progressText: '—', nextStopLabel: null, nextStopDistance: '—', timeText: '—', distanceText: '—', pendingText: '—' });
assert.ok(runOff.includes('Sin conexión') && !runOff.includes('>Conectado<'), 'sin conexión se dice con texto');
assert.ok(runOff.includes('Sin paradas pendientes') || runOff.includes('—'));

// ---- Terminar
const fin = renderDriverFinish({ routeName: 'Ruta Centro', timeText: '00:58', distanceText: '6,4 km', stopsText: '12/12' });
assert.ok(fin.includes('Terminar Ruta Centro'));
assert.ok(fin.includes('Revisa el resumen y anota el combustible.'));
assert.ok(fin.includes('00:58') && fin.includes('6,4 km') && fin.includes('12/12'));
assert.ok(fin.includes('Combustible usado (litros)'));
assert.match(fin, /<input[^>]*id="driverFuelLiters"/, 'mismo id que usa la lógica actual de combustible');
assert.match(fin, /inputmode="decimal"/);
assert.match(fin, /data-driver-finish-save[^>]*>Guardar y terminar</);
assert.match(fin, /data-driver-finish-back[^>]*>Volver a la ruta</);
const finErr = renderDriverFinish({ routeName: 'R', timeText: '—', distanceText: '—', stopsText: '—', errorMessage: 'Escribe solo números' });
assert.match(finErr, /role="alert"[^>]*>Escribe solo números</);

// ---- Acceso
const acc = renderDriverAccess({});
assert.ok(acc.includes('Hola, conductor') && acc.includes('Entra para ver tus rutas de hoy.'));
assert.match(acc, /data-driver-google[^>]*>[\s\S]*Continuar con Google/);
assert.ok(acc.includes('o con tu correo'));
assert.match(acc, /<input[^>]*type="email"[^>]*name="email"|<input[^>]*name="email"[^>]*type="email"/);
assert.match(acc, /<input[^>]*type="password"[^>]*name="password"|<input[^>]*name="password"[^>]*type="password"/);
assert.ok(acc.includes('¿Olvidaste tu contraseña?'));
assert.match(acc, /<button[^>]*type="submit"[^>]*>Entrar</);
assert.ok(acc.includes('¿No tienes acceso? Pídele a la central que registre tu correo.'));
assert.ok(!/crear cuenta|registrarte|regístrate/i.test(acc), 'el conductor no crea su cuenta');
assert.ok(!/<div[^>]*role="alert"[^>]*>\s*[^<\s]/.test(acc), 'sin error no hay mensaje');
const accErr = renderDriverAccess({ errorMessage: 'Tu correo no está registrado. Pídele a la central que lo registre.' });
assert.match(accErr, /role="alert"[^>]*>Tu correo no está registrado/);
assert.match(acc, /aria-label|<label/, 'campos con etiqueta');
console.log('driver-screens ok');

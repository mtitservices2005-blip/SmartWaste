// SW-085 (CA1, CA3, CA4, CA11): el controlador de la app del conductor con todo falso (sin DOM, red ni GPS real).
// Verifica el flujo Hoy → Iniciar → En ruta → Terminar → Hoy y que los errores no dejan al chofer sin salida.
import assert from 'node:assert/strict';
import { createDriverController } from '../frontend/driver-app.js';

const NOW = new Date('2026-10-14T12:20:00Z'); // 8:20 a. m. en Santo Domingo
const stops = [
  { sequence: 1, label: 'Calle Duarte 10', latitude: 19.0, longitude: -71.0 },
  { sequence: 2, label: 'Calle Duarte 24', latitude: 19.0035, longitude: -71.0 }
];
const baseRuns = () => ([
  { id: 'run1', routeId: 'r1', vehicleId: 'v1', status: 'assigned', createdAt: '2026-10-13T10:00:00Z', scheduledStartAt: '2026-10-14T12:00:00Z', startedAt: null, routeName: 'Ruta Centro', stopsCount: 2, stops, distanceText: '389 m', estimatedMinutes: null },
  { id: 'run2', routeId: 'r2', vehicleId: 'v1', status: 'assigned', createdAt: '2026-10-13T11:00:00Z', scheduledStartAt: '2026-10-14T15:00:00Z', startedAt: null, routeName: 'Ruta Mercado', stopsCount: 0, stops: [], distanceText: '—', estimatedMinutes: null }
]);

function setup({ runs = baseRuns(), startOk = true, completeOk = true, fuelOk = true, loadOk = true } = {}) {
  const log = [];
  const draws = [];
  let current = runs;
  const adapter = {
    startRoute: async (id) => { log.push(['startRoute', id]); return startOk ? { ok: true, data: { started_at: '2026-10-14T12:21:00Z' } } : { ok: false, error: { message: 'sin permiso' } }; },
    completeRoute: async (id) => { log.push(['completeRoute', id]); return completeOk ? { ok: true, data: { completed_at: '2026-10-14T13:00:00Z' } } : { ok: false, error: { message: 'sin red' } }; },
    findOwnVehicleAssignment: async () => ({ ok: true, data: { vehicle_id: 'v1', route_run_id: 'run1', route_id: 'r1' } }),
    logFuel: async (entry) => { log.push(['logFuel', entry]); return fuelOk ? { ok: true } : { ok: false, error: { message: 'falló' } }; }
  };
  const gps = { active: false, start: async () => { log.push(['gps.start']); gps.active = true; }, stop: async (o) => { log.push(['gps.stop', o]); gps.active = false; }, isActive: () => gps.active };
  const toasts = [];
  const c = createDriverController({
    load: async () => (loadOk ? { ok: true, driver: { id: 'd1', display_name: 'Carlos Peña' }, unit: 'C-01', runs: current } : { ok: false, message: 'sin red' }),
    adapter, gps, municipalityId: 'm1', userId: 'u1',
    toast: (m, o) => toasts.push([m, o?.type ?? 'info']),
    draw: (screen, html) => draws.push({ screen, html }),
    now: () => NOW, logout: async () => log.push(['logout'])
  });
  return { c, log, draws, toasts, adapter, gps, setRuns: (r) => { current = r; } };
}
const last = (s) => s.draws[s.draws.length - 1];

// Hoy: saludo con el primer nombre, camión, hora y solo UN Iniciar.
let s = setup();
await s.c.refresh();
assert.equal(last(s).screen, 'today');
assert.ok(last(s).html.includes('Hola, Carlos') && last(s).html.includes('Miércoles 14 de octubre · Camión C-01'));
assert.ok(last(s).html.includes('8:00 a. m.') && last(s).html.includes('Disponible a las 11:00 a. m.'));
assert.equal((last(s).html.match(/data-driver-start-route=/g) ?? []).length, 1);

// Error de lectura: se dice, con salida (reintentar), nunca pantalla vacía.
s = setup({ loadOk: false });
await s.c.refresh();
assert.ok(last(s).html.includes('No se pudieron cargar tus rutas') && last(s).html.includes('sin red'));
assert.ok(last(s).html.includes('data-driver-retry'));

// Iniciar: arranca en la base con el id de la RUTA, luego el GPS, y pasa a En ruta.
s = setup();
await s.c.refresh();
await s.c.action('start', 'run1');
assert.deepEqual(s.log.slice(0, 2), [['startRoute', 'r1'], ['gps.start']], 'primero la base, después el GPS');
assert.equal(last(s).screen, 'run');
assert.ok(last(s).html.includes('Ruta Centro') && last(s).html.includes('Calle Duarte 10') && last(s).html.includes('0 de 2 paradas'));
assert.ok(last(s).html.includes('data-driver-finish-open'));

// Iniciar falla: no enciende el GPS y se queda en Hoy con aviso.
s = setup({ startOk: false });
await s.c.refresh();
await s.c.action('start', 'run1');
assert.ok(!s.log.some((l) => l[0] === 'gps.start'), 'sin ruta iniciada no se comparte ubicación');
assert.equal(last(s).screen, 'today');
assert.ok(s.toasts.some(([m, t]) => /No se pudo iniciar/.test(m) && t === 'error'));

// Una ruta ya en curso al abrir la app: va directo a En ruta y reanuda el GPS.
s = setup({ runs: baseRuns().map((r, i) => (i === 0 ? { ...r, status: 'in_progress', startedAt: '2026-10-14T12:05:00Z' } : r)) });
await s.c.refresh();
assert.equal(last(s).screen, 'run');
assert.ok(last(s).html.includes('00:15'), 'tiempo real desde started_at');
assert.deepEqual(s.log, [['gps.start']]);

// Posición: avanza paradas y distancia (sin redibujar la pantalla).
const upd = [];
s.c.onField = (f, v) => upd.push([f, v]);
s.c.setPosition({ latitude: 19.0, longitude: -71.0 });
assert.ok(upd.some(([f, v]) => f === 'progress' && v === '1 de 2 paradas'));
assert.ok(upd.some(([f, v]) => f === 'next-label' && v === 'Calle Duarte 24'));
assert.ok(upd.some(([f, v]) => f === 'next-distance' && /^\d+ m$/.test(v)));

// Terminar: primero la pantalla de resumen; "Volver" regresa sin tocar nada.
const before = s.log.length;
await s.c.action('finish-open');
assert.equal(last(s).screen, 'finish');
assert.ok(last(s).html.includes('Terminar Ruta Centro') && last(s).html.includes('1/2'));
await s.c.action('finish-back');
assert.equal(last(s).screen, 'run');
assert.equal(s.log.length, before, 'volver no llama a nada');

// Litros inválidos: mensaje, no se apaga el GPS ni se cierra la ruta.
await s.c.action('finish-open');
await s.c.action('finish-save', 'abc');
assert.ok(last(s).html.includes('Escribe solo números'));
assert.ok(!s.log.some((l) => l[0] === 'completeRoute' || l[0] === 'gps.stop'));

// Litros válidos: guarda combustible → apaga GPS (con flush) → completa en la base → vuelve a Hoy.
s.setRuns(baseRuns().map((r, i) => (i === 0 ? { ...r, status: 'completed' } : r)));
await s.c.action('finish-save', '18,5');
const names = s.log.map((l) => l[0]);
assert.deepEqual(names.slice(-3), ['logFuel', 'gps.stop', 'completeRoute']);
assert.deepEqual(s.log.find((l) => l[0] === 'logFuel')[1], { vehicle_id: 'v1', route_run_id: 'run1', liters: 18.5, municipality_id: 'm1' });
assert.deepEqual(s.log.find((l) => l[0] === 'gps.stop')[1], { flush: true });
assert.equal(last(s).screen, 'today');
assert.ok(last(s).html.includes('Completada'));

// Sin litros (opcional): no registra combustible pero sí termina.
s = setup();
await s.c.refresh(); await s.c.action('start', 'run1'); await s.c.action('finish-open');
await s.c.action('finish-save', '');
assert.ok(!s.log.some((l) => l[0] === 'logFuel'));
assert.ok(s.log.some((l) => l[0] === 'completeRoute'));

// Si completar falla tras guardar el combustible, reintentar NO duplica el combustible.
s = setup({ completeOk: false });
await s.c.refresh(); await s.c.action('start', 'run1'); await s.c.action('finish-open');
await s.c.action('finish-save', '10');
assert.ok(last(s).html.includes('No se pudo terminar la ruta') && last(s).screen === 'finish');
await s.c.action('finish-save', '10');
assert.equal(s.log.filter((l) => l[0] === 'logFuel').length, 1, 'combustible guardado una sola vez');

// Cerrar sesión apaga el GPS si estaba activo y llama a logout.
s = setup();
await s.c.refresh(); await s.c.action('start', 'run1');
await s.c.action('logout');
assert.ok(s.log.some((l) => l[0] === 'logout'));
console.log('driver-app ok');

// Rutas nuevas aparecen sin cerrar la app: refreshIfIdle recarga en Hoy, pero no en En ruta.
s = setup();
await s.c.refresh();
const drawsBefore = s.draws.length;
await s.c.refreshIfIdle();
assert.ok(s.draws.length > drawsBefore, 'recarga en Hoy');
await s.c.action('open-run', 'run1');
const drawsMid = s.draws.length;
await s.c.refreshIfIdle();
assert.equal(s.draws.length, drawsMid, 'no recarga mientras estás en ruta');
console.log('driver-app refreshIfIdle ok');

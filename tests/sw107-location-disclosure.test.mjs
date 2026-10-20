// SW-107: Google Play exige una "divulgación destacada" ANTES de pedir la ubicación en segundo plano.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDriverController } from '../frontend/driver-app.js';
import { renderDriverDisclosure } from '../frontend/components/driver-screens.js';
import { DRIVER_TRACKING_NOTIFICATION } from '../shared/driver-app-background.js';

const NOW = new Date('2026-10-14T12:20:00Z');
const stops = [{ sequence: 1, label: 'Calle Duarte 10', latitude: 19.0, longitude: -71.0 }];
const run = (over = {}) => ({ id: 'run1', routeId: 'r1', vehicleId: 'v1', status: 'assigned', createdAt: '2026-10-13T10:00:00Z', scheduledStartAt: '2026-10-14T12:00:00Z', startedAt: null, routeName: 'Ruta Centro', stopsCount: 1, stops, distanceText: '389 m', estimatedMinutes: null, ...over });

function setup({ accepted = false, runs = [run()] } = {}) {
  const log = []; const draws = [];
  let ok = accepted;
  const disclosure = { isAccepted: () => ok, accept: () => { ok = true; log.push(['accept']); } };
  const adapter = {
    startRoute: async (id) => { log.push(['startRoute', id]); return { ok: true, data: { started_at: '2026-10-14T12:21:00Z' } }; },
    completeRoute: async () => ({ ok: true }), findOwnVehicleAssignment: async () => ({ ok: true, data: null }), logFuel: async () => ({ ok: true })
  };
  const gps = { active: false, start: async () => { log.push(['gps.start']); gps.active = true; }, stop: async () => { gps.active = false; }, isActive: () => gps.active };
  const c = createDriverController({
    load: async () => ({ ok: true, driver: { id: 'd1', display_name: 'Carlos Peña' }, unit: 'C-01', runs }),
    adapter, gps, disclosure, municipalityId: 'm1', userId: 'u1', draw: (screen, html) => draws.push({ screen, html }), now: () => NOW
  });
  return { c, log, draws };
}
const last = (s) => s.draws[s.draws.length - 1];
const names = (s) => s.log.map((l) => l[0]);

// 1) Sin aceptación previa: Iniciar ruta muestra la divulgación y NO inicia nada.
let s = setup();
await s.c.refresh();
await s.c.action('start', 'run1');
assert.equal(last(s).screen, 'disclosure');
assert.deepEqual(names(s), [], 'ni startRoute ni GPS antes de aceptar');
assert.ok(last(s).html.includes('data-driver-disclosure-accept') && last(s).html.includes('data-driver-disclosure-decline'));

// 2) Aceptar: guarda la aceptación, inicia la ruta y el GPS, y pasa a En ruta.
await s.c.action('disclosure-accept');
assert.deepEqual(names(s), ['accept', 'startRoute', 'gps.start']);
assert.equal(s.c.state.screen, 'run');

// 3) Rechazar: vuelve a Hoy y no inicia nada.
s = setup();
await s.c.refresh();
await s.c.action('start', 'run1');
await s.c.action('disclosure-decline');
assert.equal(last(s).screen, 'today');
assert.deepEqual(names(s), []);

// 4) Ruta ya en curso al abrir la app y sin aceptación: se pide antes de arrancar el GPS.
s = setup({ runs: [run({ status: 'in_progress', startedAt: '2026-10-14T12:05:00Z' })] });
await s.c.refresh();
assert.equal(last(s).screen, 'disclosure');
assert.ok(!names(s).includes('gps.start'));
await s.c.action('disclosure-accept');
assert.deepEqual(names(s), ['accept', 'gps.start']);
assert.equal(last(s).screen, 'run');

// 5) Ya aceptada antes: no vuelve a preguntar.
s = setup({ accepted: true });
await s.c.refresh();
await s.c.action('start', 'run1');
assert.ok(!s.draws.some((d) => d.screen === 'disclosure'));
assert.deepEqual(names(s), ['startRoute', 'gps.start']);

// 6) Contenido de la pantalla: qué dato, para qué, con la app cerrada, notificación, sin casilla premarcada.
const html = renderDriverDisclosure();
for (const t of [/ubicaci[oó]n/i, /segundo plano/i, /app (est[eé] )?cerrada|pantalla apagada/i, /solo durante una ruta/i, DRIVER_TRACKING_NOTIFICATION, /Pol[ií]tica de privacidad/i]) {
  assert.match(html, t instanceof RegExp ? t : new RegExp(t));
}
assert.doesNotMatch(html, /checked/);

// 7) Cableado real: app.js entrega una divulgación persistente (localStorage) al montar la app del conductor.
const app = readFileSync('frontend/app.js', 'utf8').replace(/\r\n/g, '\n');
assert.match(app, /smartwaste\.driver-location-disclosure\.v1/);
assert.match(app, /disclosure:/);
assert.match(readFileSync('frontend/driver-app.js', 'utf8'), /data-driver-disclosure-accept/);
console.log('sw107-location-disclosure OK');

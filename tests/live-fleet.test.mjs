// SW-097: normalización de la respuesta pública y textos de estado del camión.
import assert from 'node:assert/strict';
import { normalizeLiveFleet, describeVehicleStatus, STALE_AFTER_SECONDS } from '../shared/live-fleet.js';

const SERVER = '2026-10-18T14:00:00Z';
const raw = (o = {}) => ({ code: 'SW-LS-01', route_name: 'Ruta Centro', status: 'en_ruta', lat: 19.6, lng: -71.0, heading: 90, captured_at: '2026-10-18T13:59:50Z', stopped_since: null, run_started_at: '2026-10-18T13:00:00Z', path: [[19.6, -71.0], [19.61, -71.01]], ...o });
const payload = (vehicles) => ({ municipality: { name: 'Laguna Salada', slug: 'laguna-salada-rd' }, server_time: SERVER, vehicles });

// forma válida
{
  const f = normalizeLiveFleet(payload([raw()]));
  assert.equal(f.municipality.name, 'Laguna Salada');
  assert.equal(f.serverTimeMs, Date.parse(SERVER));
  const v = f.vehicles[0];
  assert.deepEqual([v.code, v.routeName, v.status, v.lat, v.lng, v.heading], ['SW-LS-01', 'Ruta Centro', 'en_ruta', 19.6, -71.0, 90]);
  assert.equal(v.ageSeconds, 10);
  assert.equal(v.capturedAtMs, Date.parse('2026-10-18T13:59:50Z'));
  assert.equal(v.runStartedAtMs, Date.parse('2026-10-18T13:00:00Z'));
  assert.deepEqual(v.path, [[19.6, -71.0], [19.61, -71.01]]);
}
// payload vacío o roto no lanza
for (const bad of [null, undefined, {}, { vehicles: 'x' }, { municipality: null, vehicles: [] }]) {
  const f = normalizeLiveFleet(bad);
  assert.deepEqual(f.vehicles, []);
}
assert.equal(normalizeLiveFleet({ municipality: null, vehicles: [] }).municipality, null);
// descarta coordenadas inválidas y conserva el resto
{
  const f = normalizeLiveFleet(payload([raw({ code: 'A', lat: null }), raw({ code: 'B', lat: NaN }), raw({ code: 'C', lng: 181 }), raw({ code: 'D', lat: 91 }), raw({ code: 'E' }), raw({ code: undefined })]));
  assert.deepEqual(f.vehicles.map((v) => v.code), ['E']);
}
// antigüedad con la hora del servidor, no la local
{
  const f = normalizeLiveFleet(payload([raw()]), Date.parse('2030-01-01T00:00:00Z'));
  assert.equal(f.vehicles[0].ageSeconds, 10);
  const noServer = normalizeLiveFleet({ vehicles: [raw()] }, Date.parse('2026-10-18T14:00:00Z'));
  assert.equal(noServer.vehicles[0].ageSeconds, 10, 'sin server_time usa nowMs');
}
// sin señal por antigüedad
{
  assert.equal(STALE_AFTER_SECONDS, 180);
  const old = normalizeLiveFleet(payload([raw({ captured_at: '2026-10-18T13:56:00Z' })])).vehicles[0];
  assert.equal(old.status, 'sin_senal');
  const fresh = normalizeLiveFleet(payload([raw({ captured_at: '2026-10-18T13:57:30Z' })])).vehicles[0];
  assert.equal(fresh.status, 'en_ruta');
}
// path inválido
{
  const v = normalizeLiveFleet(payload([raw({ path: 'x' }), raw({ code: 'P', path: [[1, 2], [null, 3], 'z', [200, 3]] })])).vehicles;
  assert.deepEqual(v[0].path, []);
  assert.deepEqual(v[1].path, [[1, 2]]);
}
// textos
{
  const base = { status: 'en_ruta', stoppedSinceMs: null, capturedAtMs: Date.parse('2026-10-18T13:59:50Z'), ageSeconds: 10 };
  assert.equal(describeVehicleStatus(base), 'En ruta');
  assert.equal(describeVehicleStatus({ ...base, status: 'detenido', stoppedSinceMs: Date.parse(SERVER) - 4 * 60000, ageSeconds: 10 }, Date.parse(SERVER)), 'Detenido hace 4 min');
  const hhmm = new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(base.capturedAtMs));
  assert.equal(describeVehicleStatus({ ...base, status: 'sin_senal' }), `Sin señal desde las ${hhmm}`);
}
console.log('live-fleet ok');

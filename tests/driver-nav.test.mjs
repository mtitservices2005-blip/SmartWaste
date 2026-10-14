// SW-085 (CA3): distancia a la siguiente parada y formato. Sin posición o sin coordenadas devuelve "—",
// nunca un número inventado.
import assert from 'node:assert/strict';
import { haversineMeters, formatDistance, nextStopInfo } from '../shared/driver-nav.js';

// 0,001° de latitud ≈ 111 m.
const d = haversineMeters({ latitude: 19.0, longitude: -71.0 }, { latitude: 19.001, longitude: -71.0 });
assert.ok(d > 110 && d < 112, `≈111 m, dio ${d}`);
assert.equal(haversineMeters({ latitude: 19, longitude: -71 }, { latitude: 19, longitude: -71 }), 0);
assert.equal(haversineMeters(null, { latitude: 1, longitude: 1 }), null);
assert.equal(haversineMeters({ latitude: 'x', longitude: 1 }, { latitude: 1, longitude: 1 }), null);
assert.equal(haversineMeters({ latitude: null, longitude: null }, { latitude: 1, longitude: 1 }), null);

assert.equal(formatDistance(350), '350 m');
assert.equal(formatDistance(349.6), '350 m');
assert.equal(formatDistance(999), '999 m');
assert.equal(formatDistance(1000), '1,0 km');
assert.equal(formatDistance(1234), '1,2 km');
assert.equal(formatDistance(12500), '12,5 km');
assert.equal(formatDistance(0), '0 m');
assert.equal(formatDistance(null), '—');
assert.equal(formatDistance(undefined), '—');
assert.equal(formatDistance(Number.NaN), '—');
assert.equal(formatDistance(-5), '—');

const stops = [
  { sequence: 1, label: 'Calle Duarte 10', latitude: 19.0, longitude: -71.0, status: 'completed' },
  { sequence: 2, label: 'Calle Duarte 24', latitude: 19.0035, longitude: -71.0, status: 'pending' },
  { sequence: 3, label: 'Mercado', latitude: 19.01, longitude: -71.0, status: 'pending' }
];
const pos = { latitude: 19.0, longitude: -71.0 };
const info = nextStopInfo({ stops, position: pos });
assert.equal(info.label, 'Calle Duarte 24');
assert.equal(info.distanceText, '389 m');
assert.equal(info.pending, 2);
assert.equal(info.done, 1);
assert.equal(info.total, 3);
assert.equal(info.progressText, '1 de 3 paradas');

// Sin posición: se muestra la parada pero la distancia es "—".
const noPos = nextStopInfo({ stops, position: null });
assert.equal(noPos.label, 'Calle Duarte 24');
assert.equal(noPos.distanceText, '—');
// Parada sin coordenadas.
const noCoord = nextStopInfo({ stops: [{ sequence: 1, label: 'Sin mapa', status: 'pending' }], position: pos });
assert.equal(noCoord.label, 'Sin mapa');
assert.equal(noCoord.distanceText, '—');
// Todas completadas / sin paradas.
const finished = nextStopInfo({ stops: stops.map((s) => ({ ...s, status: 'completed' })), position: pos });
assert.equal(finished.label, null);
assert.equal(finished.pending, 0);
assert.equal(finished.progressText, '3 de 3 paradas');
const none = nextStopInfo({ stops: [], position: pos });
assert.equal(none.total, 0);
assert.equal(none.progressText, '—');
assert.equal(nextStopInfo({}).total, 0);
console.log('driver-nav ok');

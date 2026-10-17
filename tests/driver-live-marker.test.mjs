// SW-098: el punto del conductor en el mapa "En ruta": visible (relleno con color), con círculo de precisión,
// el mapa lo sigue y, si el conductor mueve el mapa, deja de seguirlo hasta pulsar "Centrar en mí".
import assert from 'node:assert/strict';
import { createLiveMarker } from '../shared/driver-live-marker.js';

function fakeL() {
  const made = [];
  const layer = (kind, latlng, opts) => ({ kind, latlng, opts, added: false, addTo(m) { this.added = true; this.map = m; return this; }, setLatLng(p) { this.latlng = p; return this; }, setRadius(r) { this.opts = { ...this.opts, radius: r }; return this; }, setStyle(s) { this.opts = { ...this.opts, ...s }; return this; } });
  return { made, circleMarker: (p, o) => { const l = layer('dot', p, o); made.push(l); return l; }, circle: (p, o) => { const l = layer('ring', p, o); made.push(l); return l; } };
}
function fakeMap(zoom = 14) {
  const handlers = {}; const calls = [];
  return { calls, handlers, getZoom: () => zoom, panTo(p) { calls.push(['panTo', p]); }, setView(p, z) { calls.push(['setView', p, z]); zoom = z; }, on(ev, fn) { handlers[ev] = fn; } };
}

// 1) El punto se crea con relleno de color y borde blanco, y con círculo de precisión.
{
  const L = fakeL(); const map = fakeMap();
  const m = createLiveMarker({ L, map, color: '#3d7a00' });
  assert.equal(m.update({ latitude: 19.1, longitude: -71.1, accuracy: 12 }), true);
  const dot = L.made.find((l) => l.kind === 'dot'); const ring = L.made.find((l) => l.kind === 'ring');
  assert.ok(dot.added && ring.added);
  assert.equal(dot.opts.fillColor, '#3d7a00', 'el relleno lleva el color (antes quedaba blanco)');
  assert.equal(dot.opts.color, '#fff');
  assert.equal(dot.opts.fillOpacity, 1);
  assert.ok(dot.opts.radius >= 8);
  assert.equal(ring.opts.radius, 12);
  assert.deepEqual(dot.latlng, [19.1, -71.1]);
}

// 2) La segunda posición mueve el mismo punto (no crea otro) y el mapa lo sigue.
{
  const L = fakeL(); const map = fakeMap(17);
  const m = createLiveMarker({ L, map });
  m.update({ latitude: 19.1, longitude: -71.1, accuracy: 10 });
  const n = L.made.length;
  m.update({ latitude: 19.2, longitude: -71.2, accuracy: 10 });
  assert.equal(L.made.length, n, 'no crea marcadores nuevos');
  assert.deepEqual(L.made.find((l) => l.kind === 'dot').latlng, [19.2, -71.2]);
  assert.deepEqual(map.calls.at(-1), ['panTo', [19.2, -71.2]]);
}

// 3) Con zoom lejano, la primera posición acerca el mapa a 17.
{
  const L = fakeL(); const map = fakeMap(12);
  createLiveMarker({ L, map }).update({ latitude: 19.1, longitude: -71.1, accuracy: 10 });
  assert.deepEqual(map.calls.at(-1), ['setView', [19.1, -71.1], 17]);
}

// 4) Si el conductor arrastra el mapa, deja de seguir; "Centrar en mí" vuelve a seguir.
{
  const L = fakeL(); const map = fakeMap(17); const changes = [];
  const m = createLiveMarker({ L, map, onFollowChange: (f) => changes.push(f) });
  m.update({ latitude: 19.1, longitude: -71.1, accuracy: 10 });
  map.handlers.dragstart();
  assert.equal(m.isFollowing(), false);
  map.calls.length = 0;
  m.update({ latitude: 19.3, longitude: -71.3, accuracy: 10 });
  assert.equal(map.calls.length, 0, 'sin seguir, el mapa no se mueve');
  assert.deepEqual(L.made.find((l) => l.kind === 'dot').latlng, [19.3, -71.3], 'el punto sí se mueve');
  m.recenter();
  assert.equal(m.isFollowing(), true);
  assert.deepEqual(map.calls.at(-1), ['panTo', [19.3, -71.3]]);
  assert.deepEqual(changes, [false, true]);
}

// 5) Posiciones inválidas o con precisión peor que 100 m no mueven el punto (evita saltos de 400 m).
{
  const L = fakeL(); const map = fakeMap(17);
  const m = createLiveMarker({ L, map });
  assert.equal(m.update(null), false);
  assert.equal(m.update({ latitude: NaN, longitude: -71, accuracy: 5 }), false);
  assert.equal(m.update({ latitude: 19, longitude: -71, accuracy: 404.9 }), false);
  assert.equal(L.made.length, 0);
  assert.equal(m.update({ latitude: 19, longitude: -71 }), true, 'sin precisión informada igual se muestra');
}
console.log('driver-live-marker ok');

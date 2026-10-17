// SW-096: puntos GPS de mala precisión o con saltos imposibles no cuentan para la distancia ni el trazo.
import assert from 'node:assert/strict';
import { MAX_ACCURACY_METERS, MAX_SPEED_KMH, isAccuracyUsable, cleanTrack, trackStats } from '../shared/gps-quality.js';

assert.equal(MAX_ACCURACY_METERS, 50);
assert.equal(MAX_SPEED_KMH, 120);

// Precisión: 50 m justos sirve, 50,1 no; desconocida (null/undefined) sirve; basura no.
assert.equal(isAccuracyUsable(2.1), true);
assert.equal(isAccuracyUsable(50), true);
assert.equal(isAccuracyUsable(50.1), false);
assert.equal(isAccuracyUsable(404.9), false);
assert.equal(isAccuracyUsable(null), true);
assert.equal(isAccuracyUsable(undefined), true);
assert.equal(isAccuracyUsable('abc'), false);

// ~11,1 m por cada 0,0001° de latitud.
const T0 = Date.parse('2026-10-17T13:50:00Z');
const pt = (sec, dLat, accuracy = 2.1) => ({ latitude: 19.6 + dLat, longitude: -71.0, captured_at: new Date(T0 + sec * 1000).toISOString(), accuracy });
const walk = [pt(0, 0), pt(10, 0.0001), pt(20, 0.0002), pt(30, 0.0003)]; // ~33 m caminando

// Sin puntos malos, nada cambia.
assert.equal(cleanTrack(walk).length, 4);
const base = trackStats(walk);
assert.ok(base.distanceMeters > 32 && base.distanceMeters < 35, `distancia ${base.distanceMeters}`);
assert.equal(base.usedCount, 4);
assert.equal(base.rawCount, 4);

// El caso real: un punto de 404,9 m de precisión, también lejos (~400 m): no suma ida y vuelta.
const withOutlier = [walk[0], walk[1], pt(15, 0.0040, 404.9), walk[2], walk[3]];
const dirty = trackStats(withOutlier);
assert.equal(dirty.distanceMeters, base.distanceMeters, 'el punto de mala precisión no debe sumar distancia');
assert.equal(dirty.usedCount, 4);
assert.equal(dirty.rawCount, 5);
assert.equal(cleanTrack(withOutlier).some((p) => p.accuracy === 404.9), false);

// Salto imposible aunque diga buena precisión: ~1,1 km en 10 s = 400 km/h → se descarta; el siguiente punto sano se conserva.
const jump = [walk[0], walk[1], pt(20, 0.0100), pt(30, 0.0003)];
assert.equal(cleanTrack(jump).length, 3);
assert.ok(trackStats(jump).distanceMeters < 40);

// Un punto malo al principio no sirve de ancla: la caminata sana posterior se mide completa.
const badFirst = [pt(0, 0.0200, 300), ...walk.map((p) => ({ ...p, captured_at: new Date(Date.parse(p.captured_at) + 10_000).toISOString() }))];
assert.equal(trackStats(badFirst).distanceMeters, base.distanceMeters);

// Desordenados: se ordenan por captured_at; menos de 2 puntos buenos = 0 m (nunca NaN) y sin fechas.
assert.equal(trackStats([walk[3], walk[0], walk[2], walk[1]]).distanceMeters, base.distanceMeters);
assert.deepEqual(trackStats([]), { distanceMeters: 0, usedCount: 0, rawCount: 0, startedAt: null, endedAt: null });
assert.equal(trackStats([walk[0]]).distanceMeters, 0);
assert.equal(trackStats([pt(0, 0, 400), pt(5, 0.0001, 400)]).usedCount, 0);

// Inicio/fin salen de los puntos buenos, no de los malos.
assert.equal(base.startedAt, walk[0].captured_at);
assert.equal(base.endedAt, walk[3].captured_at);
const edgeBad = trackStats([pt(-5, 0, 500), ...walk, pt(60, 0.0003, 500)]);
assert.equal(edgeBad.startedAt, walk[0].captured_at);
assert.equal(edgeBad.endedAt, walk[3].captured_at);

// Mismo instante repetido (duración 0) lejos: no cuenta; cerca: sí se conserva sin romper nada.
const sameTime = [walk[0], { ...walk[0], latitude: walk[0].latitude + 0.01 }, walk[1]];
assert.equal(cleanTrack(sameTime).length, 2);

console.log('gps-quality: ok');

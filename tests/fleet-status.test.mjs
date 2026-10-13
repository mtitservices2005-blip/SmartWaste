// SW-081 (Task 3): estados derivados de un camión. Debe dar los mismos resultados que la función SQL
// derive_vehicle_status (la tabla de casos de tests/fleet-ingest.test.mjs es idéntica a propósito).
import assert from 'node:assert/strict';
import { deriveVehicleStatus, FLEET_THRESHOLDS } from '../shared/fleet-status.js';

assert.equal(FLEET_THRESHOLDS.noSignalSeconds, 90);
assert.equal(FLEET_THRESHOLDS.stoppedSpeedMps, 1);
assert.equal(FLEET_THRESHOLDS.stoppedMinutes, 5);

const now = Date.parse('2026-10-13T12:00:00Z');
const ago = (seconds) => new Date(now - seconds * 1000).toISOString();
const status = (input) => deriveVehicleStatus({ now, ...input });

assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(89), lastSpeed: 5 }), 'en_ruta');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(90), lastSpeed: 5 }), 'en_ruta', 'exactamente 90 s todavía no es "más de 90 s"');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(91), lastSpeed: 5 }), 'sin_senal');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: null }), 'sin_senal', 'corrida activa sin ninguna posición');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(10), lastSpeed: 0.5, stoppedSince: ago(360) }), 'detenido');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(10), lastSpeed: 0.5, stoppedSince: ago(300) }), 'en_ruta', 'exactamente 5 min todavía no es "más de 5 min"');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(10), lastSpeed: 0.5, stoppedSince: ago(240) }), 'en_ruta');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(10), lastSpeed: 3, stoppedSince: ago(900) }), 'en_ruta', 'si ya se mueve no está detenido');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(100), lastSpeed: 0.5, stoppedSince: ago(900) }), 'sin_senal', 'sin señal gana sobre detenido');
assert.equal(status({ hasActiveRun: false, lastCapturedAt: ago(5), lastSpeed: 9 }), 'disponible', 'Review Focus 4: se mueve sin corrida activa');
assert.equal(status({ hasActiveRun: false, lastCapturedAt: null }), 'disponible');
assert.equal(status({ hasActiveRun: false, lastCapturedAt: ago(5000), lastSpeed: 0 }), 'disponible', 'sin corrida nunca es sin señal');

// Acepta fechas como Date, ISO o milisegundos, y tolera relojes con micro-desfase hacia el futuro.
assert.equal(deriveVehicleStatus({ hasActiveRun: true, lastCapturedAt: new Date(now - 10_000), lastSpeed: 4, now: new Date(now) }), 'en_ruta');
assert.equal(deriveVehicleStatus({ hasActiveRun: true, lastCapturedAt: now - 10_000, lastSpeed: 4, now }), 'en_ruta');
assert.equal(status({ hasActiveRun: true, lastCapturedAt: ago(-3), lastSpeed: 4 }), 'en_ruta');
assert.throws(() => status({ hasActiveRun: true, lastCapturedAt: 'no-es-fecha', lastSpeed: 4 }), /fecha/i);

console.log('fleet-status ok');

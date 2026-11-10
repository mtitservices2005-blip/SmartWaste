// SW-117: estado de licencia por camión, cargo proporcional, bloqueos y avisos (módulo puro).
import assert from 'node:assert/strict';
import { daysUntil, licenseStatus, canCreate, prorationAmount, annualTotal, validateTruckRequest, formatMoney, licenseBanner, licenseErrorMessage, summarizeLicense } from '../shared/license.js';

const now = new Date('2026-11-08T15:00:00Z');
const lic = (over = {}) => ({ is_trial: false, valid_until: '2027-05-01', contracted_trucks: 5, price_per_truck_year: 1000, currency: 'USD', grace_days: 15, suspended: false, billing_mode: 'manual', ...over });
const plusDays = (n) => new Date(Date.UTC(2026, 10, 8 + n)).toISOString().slice(0, 10);

// Días
assert.equal(daysUntil('2026-11-08', now), 0);
assert.equal(daysUntil('2026-11-18', now), 10);
assert.equal(daysUntil('2026-11-05', now), -3);
assert.equal(daysUntil(null, now), null);
assert.equal(daysUntil('basura', now), null);

// Estados
assert.equal(licenseStatus(null, now), 'sin_licencia');
assert.equal(licenseStatus(lic({ is_trial: true, valid_until: plusDays(38) }), now), 'prueba');
assert.equal(licenseStatus(lic({ valid_until: plusDays(210) }), now), 'activo');
assert.equal(licenseStatus(lic({ valid_until: plusDays(16) }), now), 'activo');
assert.equal(licenseStatus(lic({ valid_until: plusDays(15) }), now), 'por_vencer');
assert.equal(licenseStatus(lic({ valid_until: plusDays(0) }), now), 'por_vencer');
assert.equal(licenseStatus(lic({ valid_until: plusDays(-1) }), now), 'vencido');
assert.equal(licenseStatus(lic({ valid_until: plusDays(-15) }), now), 'vencido');
assert.equal(licenseStatus(lic({ valid_until: plusDays(-16) }), now), 'suspendido');
assert.equal(licenseStatus(lic({ valid_until: plusDays(210), suspended: true }), now), 'suspendido');
assert.equal(licenseStatus(lic({ is_trial: true, valid_until: plusDays(-3) }), now), 'vencido');
assert.equal(licenseStatus(lic({ valid_until: plusDays(-10), grace_days: 5 }), now), 'suspendido');
assert.equal(licenseStatus(lic({ valid_until: null }), now), 'suspendido');

// Bloqueos
assert.deepEqual(canCreate(null, { kind: 'vehicle', vehicleCount: 99 }, now), { ok: true });
assert.deepEqual(canCreate(lic(), { kind: 'vehicle', vehicleCount: 4 }, now), { ok: true });
assert.deepEqual(canCreate(lic(), { kind: 'vehicle', vehicleCount: 5 }, now), { ok: false, reason: 'limite_camiones' });
assert.deepEqual(canCreate(lic(), { kind: 'route', vehicleCount: 5 }, now), { ok: true }, 'el límite solo aplica a camiones');
assert.deepEqual(canCreate(lic({ suspended: true }), { kind: 'route' }, now), { ok: false, reason: 'suspendido' });
assert.deepEqual(canCreate(lic({ valid_until: plusDays(-5) }), { kind: 'vehicle', vehicleCount: 1 }, now), { ok: true }, 'vencido sigue funcionando en gracia');

// Cargo proporcional
assert.equal(prorationAmount(lic({ valid_until: plusDays(100) }), 1, now), 273.97);
assert.equal(prorationAmount(lic({ valid_until: plusDays(365) }), 2, now), 2000);
assert.equal(prorationAmount(lic({ valid_until: plusDays(700) }), 1, now), 1000, 'tope de 365 días');
assert.equal(prorationAmount(lic({ is_trial: true, valid_until: plusDays(30) }), 1, now), null, 'en prueba no se cobra');
assert.equal(prorationAmount(lic({ valid_until: plusDays(-2) }), 1, now), null, 'vencida: se calcula al renovar');
assert.equal(prorationAmount(lic({ price_per_truck_year: 0 }), 1, now), null, 'sin tarifa no hay monto');
assert.equal(prorationAmount(lic(), 0, now), null);

// Total anual
assert.equal(annualTotal(lic()), 5000);
assert.equal(annualTotal(lic({ price_per_truck_year: 0 })), null);
assert.equal(annualTotal(null), null);

// Solicitud de camiones
assert.deepEqual(validateTruckRequest(3), { ok: true, trucks: 3 });
assert.equal(validateTruckRequest(0).ok, false);
assert.equal(validateTruckRequest(11).ok, false);
assert.match(validateTruckRequest(11).error, /hasta 10 camiones/);
assert.equal(validateTruckRequest(1.5).ok, false);
assert.equal(validateTruckRequest('x').ok, false);

// Dinero
assert.equal(formatMoney(1000, 'USD'), 'US$ 1,000');
assert.match(formatMoney(24000, 'DOP'), /^RD\$ 24[,.\s]?000$/);
assert.equal(formatMoney(null), '—');

// Avisos
assert.equal(licenseBanner(lic({ valid_until: plusDays(210) }), now), null);
assert.equal(licenseBanner(null, now), null);
assert.equal(licenseBanner(lic({ is_trial: true, valid_until: plusDays(38) }), now).tone, 'info');
assert.match(licenseBanner(lic({ valid_until: plusDays(9) }), now).title, /vence en 9 días/);
assert.match(licenseBanner(lic({ valid_until: plusDays(1) }), now).title, /vence en 1 día$/);
const venc = licenseBanner(lic({ valid_until: plusDays(-6) }), now);
assert.equal(venc.tone, 'bad');
assert.match(venc.title, /venció hace 6 días/);
assert.match(venc.body, /9 días de gracia/);
const susp = licenseBanner(lic({ suspended: true }), now);
assert.equal(susp.tone, 'off');
assert.match(susp.body, /app de tus choferes sigue funcionando/);

// Errores de la base de datos
assert.match(licenseErrorMessage(new Error('license_truck_limit: 5 de 5')), /límite de camiones/);
assert.match(licenseErrorMessage({ message: 'license_suspended' }), /suspendida/);
assert.match(licenseErrorMessage('license_forbidden'), /administrador/);
assert.equal(licenseErrorMessage(new Error('otro error')), null);

// Resumen
const s = summarizeLicense(lic({ valid_until: plusDays(210) }), 5, now);
assert.equal(s.status, 'activo');
assert.equal(s.atLimit, true);
assert.equal(s.annualTotal, 5000);
assert.equal(s.limit, 5);
assert.equal(summarizeLicense(null, 3, now).unlimited, true);

console.log('sw117-licencia ok');

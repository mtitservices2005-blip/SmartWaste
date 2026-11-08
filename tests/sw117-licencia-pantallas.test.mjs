// SW-117: modelo de vista y pantallas de la licencia (administrador del ayuntamiento y Master Admin).
import assert from 'node:assert/strict';
import { buildLicenseCardView, buildMasterLicenseView } from '../shared/license-view.js';
import { renderLicenseCard, renderMasterLicense, renderLicenseBanner } from '../frontend/components/license-screens.js';

const now = new Date('2026-11-08T12:00:00Z');
const lic = (o = {}) => ({ municipality_id: 'm1', is_trial: false, valid_until: '2027-05-01', contracted_trucks: 5, price_per_truck_year: 1000, currency: 'USD', grace_days: 15, suspended: false, billing_mode: 'manual', ...o });
const ev = (o = {}) => ({ id: 'e1', municipality_id: 'm1', type: 'ampliacion', amount: 273.97, currency: 'USD', billed: false, detail: '+1 camión(es); total contratado 6', created_at: '2026-11-08T10:00:00Z', ...o });

// Sin licencia no se muestra nada
assert.equal(buildLicenseCardView({ license: null }), null);
assert.equal(renderLicenseCard(null), '');

// Tarjeta del ayuntamiento
let v = buildLicenseCardView({ license: lic(), vehicleCount: 4, events: [ev()], now });
assert.equal(v.status, 'activo'); assert.equal(v.limit, 5); assert.equal(v.pct, 80); assert.equal(v.atLimit, false);
assert.equal(v.totalText, 'US$ 5,000'); assert.match(v.priceText, /US\$ 1,000 por camión al año/);
assert.match(v.hint, /Te quedan 1 camión/);
let html = renderLicenseCard(v);
assert.match(html, /Camiones contratados/); assert.match(html, /4 de 5 camiones en uso/); assert.match(html, /data-license-open>Agregar camiones/);
assert.ok(!html.includes('data-license-panel'), 'el panel está cerrado');
assert.match(html, /<h4>Historial<\/h4>/); assert.match(html, /Ampliación/);

// Límite alcanzado
v = buildLicenseCardView({ license: lic(), vehicleCount: 5, now });
assert.equal(v.atLimit, true); assert.match(v.hint, /Llegaste al límite/); assert.match(renderLicenseCard(v), /sw-license__bar is-full/);

// Panel abierto con cotización
v = buildLicenseCardView({ license: lic(), vehicleCount: 5, panel: { open: true, trucks: 2 }, now });
html = renderLicenseCard(v);
assert.match(html, /data-license-panel/); assert.match(html, /data-license-confirm>Confirmar y aplicar/); assert.match(html, /Cargo proporcional hoy: US\$ 953\.42/);
assert.match(html, /id="licenseTrucks"[^>]*value="2"/);

// Suspendida: botón bloqueado y panel cerrado aunque se pida abrir
v = buildLicenseCardView({ license: lic({ suspended: true }), vehicleCount: 2, panel: { open: true, trucks: 1 }, now });
html = renderLicenseCard(v);
assert.match(html, /data-license-open disabled/); assert.ok(!html.includes('data-license-panel'));
assert.match(html, /sw-license__banner--off/); assert.match(html, /app de tus choferes sigue funcionando/);

// En prueba sin tarifa
v = buildLicenseCardView({ license: lic({ is_trial: true, valid_until: '2027-01-07', price_per_truck_year: 0 }), vehicleCount: 1, now });
assert.equal(v.status, 'prueba'); assert.equal(v.priceText, 'Por definir'); assert.equal(v.totalText, 'Por definir');
assert.match(renderLicenseCard(v), /sw-license__banner--info/);

// Todo texto de datos va escapado
v = buildLicenseCardView({ license: lic(), vehicleCount: 1, events: [ev({ detail: '<img src=x onerror=alert(1)>' })], message: '<b>hola</b>', now });
html = renderLicenseCard(v);
assert.ok(!html.includes('<img src=x'), 'el detalle del historial se escapa'); assert.ok(!html.includes('<b>hola</b>')); assert.match(html, /&lt;img src=x/);
assert.equal(renderLicenseBanner(null), '');

// Master: sin licencia
let m = buildMasterLicenseView({ municipalityId: 'm9', entry: null, now });
html = renderMasterLicense(m);
assert.match(html, /sin licencia registrada/); assert.match(html, /data-license-create="m9"/);

// Master: con licencia, por facturar, historial y pago
m = buildMasterLicenseView({ municipalityId: 'm1', entry: { license: lic(), events: [ev(), ev({ id: 'e2', type: 'pago', billed: true, amount: 5000, detail: 'Pago anual' }), ev({ id: 'e3', amount: null })] }, vehicleCount: 4, now });
assert.equal(m.toBill.length, 2); assert.equal(m.toBill[1].moneyText, 'se cobra al activar'); assert.equal(m.historyCount, 3);
html = renderMasterLicense(m);
assert.match(html, /data-license-terms="m1"/); assert.match(html, /name="contractedTrucks"[^>]*value="5"/); assert.match(html, /name="price"[^>]*value="1000"/);
assert.match(html, /data-license-save="m1"/); assert.match(html, /data-license-pay="m1"/); assert.match(html, /data-license-suspend="m1"/);
assert.match(html, /data-license-billed="e1"/); assert.match(html, /data-license-billed="e3"/); assert.ok(!html.includes('data-license-billed="e2"'), 'un pago no se factura dos veces');
assert.match(html, /Historial \(3\)/); assert.match(html, /4 de 5 camiones en uso/);
assert.match(html, /<option value="automatic" disabled/, 'cobro automático aún no disponible');
assert.match(html, /name="isTrial" type="checkbox"/);

// Master: suspendida ofrece reactivar; en prueba marca la casilla
m = buildMasterLicenseView({ municipalityId: 'm1', entry: { license: lic({ suspended: true, is_trial: true }), events: [] }, vehicleCount: null, now });
html = renderMasterLicense(m);
assert.match(html, /data-license-reactivate="m1"/); assert.ok(!html.includes('data-license-suspend='));
assert.match(html, /name="isTrial" type="checkbox" checked/); assert.match(html, /— de 5 camiones en uso/);

console.log('sw117-licencia-pantallas ok');

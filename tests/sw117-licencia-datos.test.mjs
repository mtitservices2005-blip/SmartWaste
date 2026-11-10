// SW-117: llamadas a Supabase de la licencia (cliente simulado) y validación de condiciones.
import assert from 'node:assert/strict';
import { fetchLicense, fetchAllLicenses, addTrucks, validateTerms, saveLicenseTerms, createLicense, registerPayment, setSuspended, markEventBilled, todayPlus } from '../shared/license-data.js';
import { quoteText } from '../shared/license.js';

// Cliente simulado: cada tabla responde según un guion y registra las llamadas.
function fakeClient(script = {}) {
  const calls = [];
  const chain = (table, op, payload) => {
    const state = { table, op, payload, filters: [] };
    const result = () => script[`${table}.${op}`] ?? { data: null, error: null };
    const q = {
      eq: (k, v) => { state.filters.push([k, v]); return q; }, order: () => q, limit: () => q,
      select: () => q, maybeSingle: async () => { calls.push(state); return result(); }, single: async () => { calls.push(state); return result(); },
      then: (res, rej) => { calls.push(state); return Promise.resolve(result()).then(res, rej); }
    };
    return q;
  };
  return { calls, from: (t) => ({ select: () => chain(t, 'select'), insert: (p) => chain(t, 'insert', p), update: (p) => chain(t, 'update', p) }), rpc: async (name, args) => { calls.push({ rpc: name, args }); return script[`rpc.${name}`] ?? { data: { ok: 1 }, error: null }; } };
}
const lic = { municipality_id: 'm1', is_trial: false, valid_until: '2027-05-01', contracted_trucks: 5, price_per_truck_year: 1000, currency: 'USD' };

// fetchLicense
assert.equal((await fetchLicense(null, 'm1')).ok, false);
let c = fakeClient({ 'municipality_licenses.select': { data: null, error: null } });
assert.deepEqual(await fetchLicense(c, 'm1'), { ok: true, license: null, events: [] });
c = fakeClient({ 'municipality_licenses.select': { data: lic, error: null }, 'license_events.select': { data: [{ id: 'e1' }], error: null } });
let r = await fetchLicense(c, 'm1');
assert.equal(r.license.contracted_trucks, 5); assert.equal(r.events.length, 1);
c = fakeClient({ 'municipality_licenses.select': { data: lic, error: null }, 'license_events.select': { data: null, error: { message: 'permission denied' } } });
assert.deepEqual((await fetchLicense(c, 'm1')).events, [], 'sin permiso para el historial: queda vacío');
c = fakeClient({ 'municipality_licenses.select': { data: null, error: { message: 'boom' } } });
assert.equal((await fetchLicense(c, 'm1')).ok, false);

// fetchAllLicenses agrupa
c = fakeClient({ 'municipality_licenses.select': { data: [lic, { ...lic, municipality_id: 'm2' }], error: null }, 'license_events.select': { data: [{ id: 'e1', municipality_id: 'm2' }, { id: 'e2', municipality_id: 'm1' }, { id: 'e3', municipality_id: 'otro' }], error: null } });
r = await fetchAllLicenses(c);
assert.equal(r.byMunicipality.m2.events[0].id, 'e1'); assert.equal(r.byMunicipality.m1.events.length, 1); assert.equal(r.byMunicipality.otro, undefined);

// addTrucks valida antes de llamar a la base
c = fakeClient();
assert.equal((await addTrucks(c, 'm1', 0)).ok, false);
assert.equal((await addTrucks(c, 'm1', 11)).ok, false);
assert.equal(c.calls.length, 0, 'no se llama a la base con datos inválidos');
r = await addTrucks(c, 'm1', 3);
assert.equal(r.ok, true); assert.deepEqual(c.calls[0], { rpc: 'add_licensed_trucks', args: { p_municipality_id: 'm1', p_trucks: 3 } });
c = fakeClient({ 'rpc.add_licensed_trucks': { data: null, error: { message: 'license_truck_limit' } } });
r = await addTrucks(c, 'm1', 1);
assert.equal(r.ok, false); assert.match(r.error.message, /license_truck_limit/);

// validateTerms
const ok = { contractedTrucks: 8, price: 950.555, currency: 'USD', validUntil: '2027-01-31', isTrial: false, billingMode: 'manual', graceDays: 15, notes: 'Acuerdo del concejo' };
assert.equal(validateTerms(ok).ok, true);
assert.equal(validateTerms(ok).values.price_per_truck_year, 950.56);
assert.equal(validateTerms({ ...ok, contractedTrucks: -1 }).ok, false);
assert.equal(validateTerms({ ...ok, contractedTrucks: 2.5 }).ok, false);
assert.equal(validateTerms({ ...ok, price: -5 }).ok, false);
assert.equal(validateTerms({ ...ok, currency: 'EUR' }).ok, false);
assert.equal(validateTerms({ ...ok, validUntil: '31/01/2027' }).ok, false);
assert.equal(validateTerms({ ...ok, validUntil: '2027-13-40' }).ok, false);
assert.equal(validateTerms({ ...ok, billingMode: 'x' }).ok, false);
assert.equal(validateTerms({ ...ok, graceDays: 100 }).ok, false);

// saveLicenseTerms
c = fakeClient({ 'municipality_licenses.update': { data: lic, error: null } });
assert.equal((await saveLicenseTerms(c, 'm1', { ...ok, price: -1 })).ok, false);
assert.equal(c.calls.length, 0);
r = await saveLicenseTerms(c, 'm1', ok);
assert.equal(r.ok, true); assert.equal(c.calls[0].payload.contracted_trucks, 8); assert.deepEqual(c.calls[0].filters, [['municipality_id', 'm1']]);
c = fakeClient({ 'municipality_licenses.update': { data: null, error: null } });
assert.equal((await saveLicenseTerms(c, 'm1', ok)).ok, false, 'sin fila: license_not_found');

// createLicense: prueba, tarifa por definir y evento de alta
c = fakeClient({ 'municipality_licenses.insert': { data: { ...lic, is_trial: true }, error: null } });
r = await createLicense(c, 'm1', { contractedTrucks: 5, trialDays: 60, now: new Date('2026-11-08T12:00:00Z') });
assert.equal(r.ok, true);
assert.equal(c.calls[0].payload.valid_until, '2027-01-07'); assert.equal(c.calls[0].payload.is_trial, true); assert.equal(c.calls[0].payload.price_per_truck_year, 0);
assert.equal(c.calls[1].table, 'license_events'); assert.equal(c.calls[1].payload.type, 'alta');
assert.equal(todayPlus(60, new Date('2026-11-08T23:59:00Z')), '2027-01-07');

// registerPayment / setSuspended / markEventBilled
c = fakeClient();
assert.equal((await registerPayment(c, 'm1', { amount: -1, period: 'anual' })).ok, false);
assert.equal((await registerPayment(c, 'm1', { amount: 100, period: 'semanal' })).ok, false);
assert.equal(c.calls.length, 0);
await registerPayment(c, 'm1', { amount: 5000, period: 'anual', reference: 'TRF-1' });
assert.deepEqual(c.calls[0], { rpc: 'register_license_payment', args: { p_municipality_id: 'm1', p_amount: 5000, p_period: 'anual', p_reference: 'TRF-1' } });
await setSuspended(c, 'm1', true);
assert.deepEqual(c.calls[1], { rpc: 'set_license_suspended', args: { p_municipality_id: 'm1', p_suspended: true } });
assert.equal((await markEventBilled(fakeClient({ 'license_events.update': { error: null } }), 'e1')).ok, true);
assert.equal((await markEventBilled(fakeClient({ 'license_events.update': { error: { message: 'x' } } }), 'e1')).ok, false);

// quoteText
const now = new Date('2026-11-08T12:00:00Z');
assert.match(quoteText(lic, 2, now), /Nuevo total: 7 camiones\. Cargo proporcional hoy: US\$ 953\.42 \(174 días restantes/);
assert.match(quoteText({ ...lic, is_trial: true }, 1, now), /Se cobra al activar la licencia \(US\$ 1,000 al año por el camión adicional\)/);
assert.match(quoteText({ ...lic, price_per_truck_year: 0 }, 1, now), /La tarifa se confirma con MT IT Services/);
assert.match(quoteText({ ...lic, valid_until: '2026-11-01' }, 1, now), /vencida, el cargo se calcula al renovar/);
assert.match(quoteText(lic, 0, now), /al menos 1/);
assert.match(quoteText(lic, 11, now), /hasta 10 camiones/);

console.log('sw117-licencia-datos ok');

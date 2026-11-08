// SW-117: lectura y escritura de la licencia contra Supabase. Recibe el cliente ya autenticado (nunca service_role).
// Las reglas viven en la base (RLS, triggers y funciones); aquí solo se llaman y se validan los datos antes de enviarlos.
import { validateTruckRequest } from './license.js';

const fail = (error) => ({ ok: false, error: { message: String(error?.message ?? error ?? 'error desconocido') } });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const todayPlus = (days, now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
export const PAYMENT_PERIODS = ['mensual', 'trimestral', 'anual'];

export async function countVehicles(client, municipalityId) {
  const r = await client.from('vehicles').select('id', { count: 'exact', head: true }).eq('municipality_id', municipalityId);
  return r.error ? null : r.count;
}

// Licencia del ayuntamiento + historial (el historial solo lo ve el administrador; si no puede, queda vacío).
export async function fetchLicense(client, municipalityId) {
  if (!client || !municipalityId) return fail('sin_cliente');
  const lic = await client.from('municipality_licenses').select('*').eq('municipality_id', municipalityId).maybeSingle();
  if (lic.error) return fail(lic.error);
  if (!lic.data) return { ok: true, license: null, events: [] };
  const ev = await client.from('license_events').select('*').eq('municipality_id', municipalityId).order('created_at', { ascending: false }).limit(20);
  return { ok: true, license: lic.data, events: ev.error ? [] : (ev.data ?? []) };
}

// Master Admin: todas las licencias, agrupadas por ayuntamiento.
export async function fetchAllLicenses(client) {
  if (!client) return fail('sin_cliente');
  const lic = await client.from('municipality_licenses').select('*');
  if (lic.error) return fail(lic.error);
  const ev = await client.from('license_events').select('*').order('created_at', { ascending: false }).limit(300);
  const byMunicipality = {};
  for (const l of lic.data ?? []) byMunicipality[l.municipality_id] = { license: l, events: [] };
  for (const e of (ev.error ? [] : ev.data ?? [])) byMunicipality[e.municipality_id]?.events.push(e);
  return { ok: true, byMunicipality };
}

export async function addTrucks(client, municipalityId, trucks) {
  const check = validateTruckRequest(trucks);
  if (!check.ok) return fail(check.error);
  const r = await client.rpc('add_licensed_trucks', { p_municipality_id: municipalityId, p_trucks: check.trucks });
  return r.error ? fail(r.error) : { ok: true, data: r.data };
}

export function validateTerms(raw = {}) {
  const trucks = Number(raw.contractedTrucks);
  if (!Number.isInteger(trucks) || trucks < 0 || trucks > 1000) return { ok: false, message: 'Los camiones contratados deben ser un número entero entre 0 y 1000.' };
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) return { ok: false, message: 'La tarifa por camión al año debe ser un número igual o mayor que 0.' };
  if (!['USD', 'DOP'].includes(raw.currency)) return { ok: false, message: 'Elige la moneda (US$ o RD$).' };
  if (!isDate(raw.validUntil)) return { ok: false, message: 'La vigencia debe ser una fecha válida.' };
  if (!['manual', 'automatic'].includes(raw.billingMode)) return { ok: false, message: 'Elige el modo de cobro.' };
  const grace = Number(raw.graceDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > 90) return { ok: false, message: 'Los días de gracia deben estar entre 0 y 90.' };
  return { ok: true, values: { contracted_trucks: trucks, price_per_truck_year: Math.round(price * 100) / 100, currency: raw.currency, valid_until: raw.validUntil, is_trial: Boolean(raw.isTrial), billing_mode: raw.billingMode, grace_days: grace, notes: raw.notes ? String(raw.notes).slice(0, 500) : null } };
}

export async function saveLicenseTerms(client, municipalityId, raw) {
  const check = validateTerms(raw);
  if (!check.ok) return fail(check.message);
  const r = await client.from('municipality_licenses').update({ ...check.values, updated_at: new Date().toISOString() }).eq('municipality_id', municipalityId).select('*').maybeSingle();
  if (r.error) return fail(r.error);
  return r.data ? { ok: true, data: r.data } : fail('license_not_found');
}

// Primera licencia de un ayuntamiento: periodo de prueba, camiones iniciales y tarifa por definir (0).
export async function createLicense(client, municipalityId, { contractedTrucks = 5, trialDays = 60, now = new Date() } = {}) {
  const row = { municipality_id: municipalityId, is_trial: true, valid_until: todayPlus(trialDays, now), contracted_trucks: contractedTrucks, price_per_truck_year: 0, currency: 'USD', billing_mode: 'manual', grace_days: 15, suspended: false };
  const r = await client.from('municipality_licenses').insert(row).select('*').single();
  if (r.error) return fail(r.error);
  await client.from('license_events').insert({ municipality_id: municipalityId, type: 'alta', trucks_delta: contractedTrucks, billed: true, detail: `Alta en periodo de prueba de ${trialDays} días con ${contractedTrucks} camiones` });
  return { ok: true, data: r.data };
}

export async function registerPayment(client, municipalityId, { amount, period, reference = '' } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return fail('Indica el monto del pago (0 o más).');
  if (!PAYMENT_PERIODS.includes(period)) return fail('Elige el periodo del pago.');
  const r = await client.rpc('register_license_payment', { p_municipality_id: municipalityId, p_amount: value, p_period: period, p_reference: reference });
  return r.error ? fail(r.error) : { ok: true, data: r.data };
}

export async function setSuspended(client, municipalityId, suspended) {
  const r = await client.rpc('set_license_suspended', { p_municipality_id: municipalityId, p_suspended: Boolean(suspended) });
  return r.error ? fail(r.error) : { ok: true, data: r.data };
}

export async function markEventBilled(client, eventId) {
  const r = await client.from('license_events').update({ billed: true }).eq('id', eventId);
  return r.error ? fail(r.error) : { ok: true };
}

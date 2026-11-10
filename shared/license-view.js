// SW-117: modelo de vista de la licencia. Convierte la licencia y el historial en textos listos para pintar;
// frontend/components/license-screens.js solo recibe este modelo (los componentes no importan de shared/).
import { summarizeLicense, licenseBanner, licenseStatus, formatMoney, quoteText, STATUS_LABELS } from './license.js';

const EVENT_LABELS = { alta: 'Alta', ampliacion: 'Ampliación', pago: 'Pago', cambio_estado: 'Cambio de estado', ajuste: 'Ajuste' };
const fmtDate = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
export const dateOnlyText = (v) => (v ? fmtDate(`${String(v).slice(0, 10)}T00:00:00Z`) : '—');
const priceTextOf = (s) => (s.price > 0 ? `${formatMoney(s.price, s.currency)} por camión al año` : 'Por definir');
const totalTextOf = (s) => (s.annualTotal === null ? 'Por definir' : formatMoney(s.annualTotal, s.currency));
const eventRow = (e) => ({ id: e.id, dateText: fmtDate(e.created_at), label: EVENT_LABELS[e.type] ?? e.type, detail: e.detail ?? '', moneyText: e.amount === null || e.amount === undefined ? '' : formatMoney(e.amount, e.currency) });

// Tarjeta "Tu suscripción" (administrador del ayuntamiento). null = sin licencia: no se muestra nada.
export function buildLicenseCardView({ license, vehicleCount = 0, events = [], panel = { open: false, trucks: 1 }, message = '', now = new Date() }) {
  if (!license) return null;
  const s = summarizeLicense(license, vehicleCount, now);
  const suspended = s.status === 'suspendido';
  return {
    banner: licenseBanner(license, now),
    status: s.status, statusLabel: s.label, validUntilText: dateOnlyText(s.validUntil),
    limit: s.limit, used: s.used, atLimit: s.atLimit, pct: s.limit ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0,
    priceText: priceTextOf(s), totalText: totalTextOf(s), suspended,
    panelOpen: Boolean(panel.open) && !suspended, panelTrucks: panel.trucks, quote: quoteText(license, panel.trucks, now),
    hint: suspended ? 'Agregar camiones está bloqueado mientras la suscripción esté suspendida.' : s.atLimit ? 'Llegaste al límite de camiones contratados. Agrega más para registrar nuevos camiones.' : `Te quedan ${s.limit - s.used} camión(es) disponible(s).`,
    events: events.slice(0, 10).map(eventRow), message
  };
}

// Bloque de cada ayuntamiento en Master Admin.
export function buildMasterLicenseView({ municipalityId, entry, vehicleCount = null, message = '', now = new Date() }) {
  if (!entry?.license) return { id: municipalityId, hasLicense: false, message };
  const lic = entry.license; const events = entry.events ?? [];
  const s = summarizeLicense(lic, vehicleCount ?? 0, now);
  return {
    id: municipalityId, hasLicense: true, message,
    status: licenseStatus(lic, now), statusLabel: STATUS_LABELS[licenseStatus(lic, now)], validUntilText: dateOnlyText(lic.valid_until),
    usedText: `${vehicleCount === null ? '—' : vehicleCount} de ${s.limit} camiones en uso`, priceText: priceTextOf(s), totalText: totalTextOf(s),
    suspended: Boolean(lic.suspended),
    terms: { contractedTrucks: lic.contracted_trucks, price: lic.price_per_truck_year, currency: lic.currency, validUntil: String(lic.valid_until).slice(0, 10), graceDays: lic.grace_days, billingMode: lic.billing_mode, isTrial: Boolean(lic.is_trial) },
    toBill: events.filter((e) => e.type === 'ampliacion' && !e.billed).map((e) => ({ ...eventRow(e), moneyText: e.amount === null || e.amount === undefined ? 'se cobra al activar' : formatMoney(e.amount, e.currency), detail: e.detail ?? 'Ampliación' })),
    history: events.slice(0, 15).map(eventRow), historyCount: events.length
  };
}

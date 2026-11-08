// SW-117: licencia por camión. Puro (sin red ni DOM). El estado NO se guarda: se calcula de las fechas.
// Debe coincidir con license_effective_status() de supabase/migrations/202611080001_sw117_licencias.sql.
export const GRACE_DAYS_DEFAULT = 15;
export const WARN_DAYS = 15;
export const MAX_TRUCKS_PER_CHANGE = 10;

export const STATUS_LABELS = {
  prueba: 'Prueba',
  activo: 'Activo',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  suspendido: 'Suspendido',
  sin_licencia: 'Sin licencia'
};

const DAY_MS = 86400000;
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Días desde hoy (UTC) hasta la fecha de vigencia 'YYYY-MM-DD'. Negativo si ya pasó.
export function daysUntil(validUntil, now = new Date()) {
  if (!validUntil) return null;
  const [y, m, d] = String(validUntil).slice(0, 10).split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(y, m - 1, d) - utcDay(now)) / DAY_MS);
}

export function licenseStatus(license, now = new Date()) {
  if (!license) return 'sin_licencia';
  if (license.suspended) return 'suspendido';
  const days = daysUntil(license.valid_until, now);
  if (days === null) return 'suspendido';
  const grace = Number.isFinite(Number(license.grace_days)) ? Number(license.grace_days) : GRACE_DAYS_DEFAULT;
  if (days < -grace) return 'suspendido';
  if (days < 0) return 'vencido';
  if (license.is_trial) return 'prueba';
  return days <= WARN_DAYS ? 'por_vencer' : 'activo';
}

// ¿Puede el administrador crear esto ahora? kind: 'vehicle' | 'route' | 'driver'.
export function canCreate(license, { kind, vehicleCount = 0 } = {}, now = new Date()) {
  const status = licenseStatus(license, now);
  if (status === 'sin_licencia') return { ok: true };
  if (status === 'suspendido') return { ok: false, reason: 'suspendido' };
  if (kind === 'vehicle' && Number(vehicleCount) >= Number(license.contracted_trucks)) return { ok: false, reason: 'limite_camiones' };
  return { ok: true };
}

const round2 = (v) => Math.round(v * 100) / 100;

// Cargo por sumar camiones a mitad de vigencia: proporcional a los días restantes (máximo 365).
// null = todavía no se cobra (prueba, vencida o sin tarifa): se calcula al activar o renovar.
export function prorationAmount(license, trucks, now = new Date()) {
  if (!license || !Number.isFinite(Number(trucks)) || Number(trucks) < 1) return null;
  if (license.is_trial) return null;
  const days = daysUntil(license.valid_until, now);
  if (days === null || days <= 0) return null;
  const price = Number(license.price_per_truck_year);
  if (!(price > 0)) return null;
  return round2(Number(trucks) * price * Math.min(days, 365) / 365);
}

export function annualTotal(license) {
  if (!license) return null;
  const price = Number(license.price_per_truck_year);
  return price > 0 ? round2(Number(license.contracted_trucks) * price) : null;
}

export function validateTruckRequest(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return { ok: false, error: 'Indica cuántos camiones quieres agregar (al menos 1).' };
  if (v > MAX_TRUCKS_PER_CHANGE) return { ok: false, error: `Puedes agregar hasta ${MAX_TRUCKS_PER_CHANGE} camiones por vez. Para más, contacta a MT IT Services.` };
  return { ok: true, trucks: v };
}

const CURRENCY_SYMBOL = { USD: 'US$', DOP: 'RD$' };
export const currencySymbol = (c) => CURRENCY_SYMBOL[c] ?? c ?? '';
export function formatMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '—';
  return `${currencySymbol(currency)} ${Number(amount).toLocaleString('es-DO', { maximumFractionDigits: 2 })}`;
}

// Aviso que ve el administrador del ayuntamiento. tone: info | warn | bad | off. null = sin aviso.
export function licenseBanner(license, now = new Date()) {
  const status = licenseStatus(license, now);
  const days = license ? daysUntil(license.valid_until, now) : null;
  const grace = Number.isFinite(Number(license?.grace_days)) ? Number(license.grace_days) : GRACE_DAYS_DEFAULT;
  if (status === 'prueba') return { status, tone: 'info', title: 'Estás en periodo de prueba', body: `Termina en ${days} día${days === 1 ? '' : 's'}. Todo funciona con normalidad.` };
  if (status === 'por_vencer') return { status, tone: 'warn', title: `Tu suscripción vence en ${days} día${days === 1 ? '' : 's'}`, body: 'Contacta a MT IT Services para renovar y evitar interrupciones.' };
  if (status === 'vencido') return { status, tone: 'bad', title: `Tu suscripción venció hace ${-days} día${days === -1 ? '' : 's'}`, body: `Tienes ${grace + days} día${grace + days === 1 ? '' : 's'} de gracia. Todo sigue funcionando. Renueva para evitar la suspensión.` };
  if (status === 'suspendido') return { status, tone: 'off', title: 'Suscripción suspendida', body: 'Puedes consultar datos y descargar reportes. Para crear rutas, camiones o usuarios, renueva con MT IT Services. La app de tus choferes sigue funcionando.' };
  return null;
}

// Mensaje claro para los errores que lanza la base de datos.
export function licenseErrorMessage(error) {
  const text = String(error?.message ?? error ?? '');
  if (/license_truck_limit/.test(text)) return 'Llegaste al límite de camiones contratados. Agrega camiones en Configuración · Tu suscripción.';
  if (/license_suspended/.test(text)) return 'La suscripción está suspendida. Contacta a MT IT Services para renovar.';
  if (/license_forbidden/.test(text)) return 'Solo el administrador del ayuntamiento puede cambiar la suscripción.';
  if (/license_invalid_trucks/.test(text)) return `Puedes agregar de 1 a ${MAX_TRUCKS_PER_CHANGE} camiones por vez.`;
  if (/license_not_found/.test(text)) return 'Este ayuntamiento todavía no tiene una licencia registrada.';
  return null;
}

// Fila lista para mostrar: estado, vigencia, uso de camiones y totales.
export function summarizeLicense(license, vehicleCount = 0, now = new Date()) {
  const status = licenseStatus(license, now);
  if (!license) return { status, label: STATUS_LABELS[status], unlimited: true, used: vehicleCount, limit: null };
  const days = daysUntil(license.valid_until, now);
  return {
    status,
    label: STATUS_LABELS[status],
    days,
    validUntil: license.valid_until,
    used: vehicleCount,
    limit: Number(license.contracted_trucks),
    atLimit: vehicleCount >= Number(license.contracted_trucks),
    price: Number(license.price_per_truck_year) || 0,
    currency: license.currency ?? 'USD',
    annualTotal: annualTotal(license),
    billingMode: license.billing_mode ?? 'manual',
    isTrial: Boolean(license.is_trial)
  };
}

// Texto que ve el administrador antes de confirmar cuántos camiones agrega (cargo proporcional o motivo por el que aún no hay cargo).
export function quoteText(license, trucks, now = new Date()) {
  const v = validateTruckRequest(trucks);
  if (!v.ok) return v.error;
  const total = Number(license.contracted_trucks) + v.trucks;
  const head = `Nuevo total: ${total} camiones.`;
  const price = Number(license.price_per_truck_year);
  if (!(price > 0)) return `${head} La tarifa se confirma con MT IT Services.`;
  const cur = license.currency;
  if (license.is_trial) return `${head} Se cobra al activar la licencia (${formatMoney(v.trucks * price, cur)} al año por ${v.trucks === 1 ? 'el camión' : 'los camiones'} adicional${v.trucks === 1 ? '' : 'es'}).`;
  const days = daysUntil(license.valid_until, now);
  if (days === null || days <= 0) return `${head} Con la licencia vencida, el cargo se calcula al renovar.`;
  return `${head} Cargo proporcional hoy: ${formatMoney(prorationAmount(license, v.trucks, now), cur)} (${days} día${days === 1 ? '' : 's'} restantes de vigencia; tarifa ${formatMoney(price, cur)} por camión al año).`;
}

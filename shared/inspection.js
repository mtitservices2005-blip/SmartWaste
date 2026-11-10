// SW-123: chequeo mecánico del camión antes de salir. Puro (sin red ni DOM).
// El chofer marca cada punto como Bien o Falla; una falla es crítica o menor. El administrador decide en Configuración
// si un camión con falla crítica puede salir (por defecto sí: se avisa y queda registrado).

export const INSPECTION_GROUPS = [
  { id: 'frenos', label: 'Frenos y dirección', items: [{ key: 'frenos', label: 'Frenos' }, { key: 'direccion', label: 'Dirección' }] },
  { id: 'luces', label: 'Luces y señales', items: [{ key: 'luces', label: 'Luces delanteras y traseras' }, { key: 'direccionales', label: 'Direccionales y luz de freno' }, { key: 'bocina', label: 'Bocina y alarma de reversa' }] },
  { id: 'llantas', label: 'Llantas y carrocería', items: [{ key: 'llantas', label: 'Llantas (presión y desgaste)' }, { key: 'espejos', label: 'Espejos y parabrisas' }, { key: 'carroceria', label: 'Puertas y carrocería' }] },
  { id: 'motor', label: 'Motor y fluidos', items: [{ key: 'fluidos', label: 'Aceite y refrigerante' }, { key: 'fugas', label: 'Fugas visibles' }] },
  { id: 'compactador', label: 'Compactador', items: [{ key: 'hidraulico', label: 'Sistema hidráulico y compactadora' }] },
  { id: 'seguridad', label: 'Seguridad', items: [{ key: 'extintor', label: 'Extintor y botiquín' }, { key: 'cinturon', label: 'Cinturón de seguridad' }] }
];
export const INSPECTION_ITEMS = INSPECTION_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));
export const MAX_NOTE = 300;
export const DEFAULT_SETTINGS = Object.freeze({ required: true, allowCritical: true });

export function normalizeInspectionSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { required: typeof r.required === 'boolean' ? r.required : DEFAULT_SETTINGS.required, allowCritical: typeof r.allowCritical === 'boolean' ? r.allowCritical : DEFAULT_SETTINGS.allowCritical };
}

// results: { [key]: { status: 'ok'|'fail', severity?: 'minor'|'critical', note? } }
export function summarizeInspection(results = {}) {
  const answered = INSPECTION_ITEMS.filter((i) => results[i.key]?.status === 'ok' || results[i.key]?.status === 'fail');
  const fails = INSPECTION_ITEMS.filter((i) => results[i.key]?.status === 'fail');
  const critical = fails.filter((i) => results[i.key].severity === 'critical');
  return {
    total: INSPECTION_ITEMS.length, done: answered.length, complete: answered.length === INSPECTION_ITEMS.length,
    fails: fails.length, critical: critical.length, minor: fails.length - critical.length,
    result: critical.length ? 'critical' : fails.length ? 'minor' : 'ok'
  };
}

export function validateInspection(results = {}) {
  const errors = [];
  const s = summarizeInspection(results);
  if (!s.complete) errors.push(`Faltan ${s.total - s.done} puntos por revisar.`);
  for (const item of INSPECTION_ITEMS) {
    const r = results[item.key];
    if (r?.status === 'fail' && r.severity !== 'minor' && r.severity !== 'critical') errors.push(`Indica la gravedad de la falla en "${item.label}".`);
    if (r?.status === 'fail' && String(r.note ?? '').length > MAX_NOTE) errors.push(`La nota de "${item.label}" es demasiado larga (máximo ${MAX_NOTE} letras).`);
  }
  return { valid: errors.length === 0, errors };
}

export function buildSubmitItems(results = {}) {
  return INSPECTION_ITEMS.map((i) => {
    const r = results[i.key] ?? {};
    const fail = r.status === 'fail';
    return { key: i.key, label: i.label, status: fail ? 'fail' : 'ok', severity: fail ? r.severity : null, note: fail ? String(r.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) || null : null };
  });
}

// ¿Puede iniciar la ruta con este resultado? Con fallas críticas depende del interruptor del administrador.
export function departureDecision(settings, summary) {
  const s = normalizeInspectionSettings(settings);
  if (!summary.critical) return { canDepart: true, notifyAdmin: summary.fails > 0 };
  return s.allowCritical ? { canDepart: true, notifyAdmin: true, warning: 'Puedes salir, pero se avisa de inmediato al administrador y queda registrado.' }
    : { canDepart: false, notifyAdmin: true, warning: 'Este ayuntamiento no permite salir con fallas críticas. Avisa a tu administrador.' };
}

// Zona horaria de la República Dominicana (UTC-4 todo el año).
const TZ = 'America/Santo_Domingo';
export const dayKey = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };

// Un chequeo por camión y por chofer al día: si el último de hoy dejó salir, no se repite. Si bloqueó, se rehace.
export function needsInspection({ settings, inspections = [], vehicleId, driverId, now = new Date() } = {}) {
  if (!normalizeInspectionSettings(settings).required || !vehicleId) return false;
  const today = dayKey(now);
  const mine = inspections.filter((i) => i.vehicle_id === vehicleId && (i.driver_id ?? null) === (driverId ?? null) && dayKey(i.created_at) === today)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return !(mine[0] && mine[0].departed === true);
}

export function inspectionErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/inspection_not_allowed/.test(m)) return 'No tienes permiso para registrar el chequeo de este camión.';
  if (/inspection_invalid/.test(m)) return 'El chequeo está incompleto o tiene datos inválidos. Revísalo e inténtalo de nuevo.';
  if (/inspection_vehicle/.test(m)) return 'No se encontró el camión de este chequeo.';
  if (/fetch|network|failed to send/.test(m)) return 'Sin conexión. Conéctate para guardar el chequeo.';
  return null;
}

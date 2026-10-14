// SW-085: "Rutas de hoy" del chofer. Lógica pura (sin DOM ni red). La fecha es la local de República
// Dominicana (America/Santo_Domingo). Una ruta sin hora de inicio no inventa una: se muestra sin hora y al final.
const TIME_ZONE = 'America/Santo_Domingo';
const OPEN = new Set(['planned', 'assigned']);
const ACTIVE = new Set(['started', 'in_progress', 'delayed']);

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function localDateKey(value) { return localParts(value)?.key ?? null; }

export function formatStartTime(value) {
  if (!value) return null;
  const p = localParts(value);
  if (!p) return null;
  const hour12 = p.hour % 12 || 12;
  return `${hour12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'a. m.' : 'p. m.'}`;
}

export function selectTodayRoutes(runs, { now = new Date() } = {}) {
  const today = localDateKey(now);
  const items = [];
  for (const raw of Array.isArray(runs) ? runs : []) {
    if (!raw || !raw.id) continue;
    const status = raw.status ?? 'assigned';
    if (status === 'cancelled') continue;
    const hasTime = Boolean(raw.scheduledStartAt) && localDateKey(raw.scheduledStartAt) !== null;
    if (hasTime && localDateKey(raw.scheduledStartAt) !== today) continue;
    if (!hasTime && !OPEN.has(status) && !ACTIVE.has(status)) continue;
    items.push({ ...raw, status, startLabel: hasTime ? formatStartTime(raw.scheduledStartAt) : null, _t: hasTime ? new Date(raw.scheduledStartAt).getTime() : null });
  }
  items.sort((a, b) => {
    if (a._t !== null && b._t !== null) return a._t - b._t;
    if (a._t !== null) return -1;
    if (b._t !== null) return 1;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
  const activeId = items.find((r) => ACTIVE.has(r.status))?.id ?? null;
  const nextId = activeId ? null : (items.find((r) => OPEN.has(r.status))?.id ?? null);
  const withSlot = items.map(({ _t, ...r }) => ({ ...r, slot: r.status === 'completed' ? 'completada' : r.id === activeId ? 'en-curso' : r.id === nextId ? 'siguiente' : 'proxima' }));
  return { items: withSlot, nextId, activeId };
}

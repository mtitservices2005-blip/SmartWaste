// SW-086: hora de inicio y días de cada ruta. Lógica pura (sin DOM ni red). Días: 0 = domingo … 6 = sábado.
// La fecha local es la de República Dominicana (America/Santo_Domingo). Sin días elegidos = todos los días.
const TIME_ZONE = 'America/Santo_Domingo';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Lunes primero, como en el formulario y en la tabla.
export const DAY_CHIPS = [
  { value: 1, label: 'L', name: 'Lunes' }, { value: 2, label: 'M', name: 'Martes' }, { value: 3, label: 'X', name: 'Miércoles' },
  { value: 4, label: 'J', name: 'Jueves' }, { value: 5, label: 'V', name: 'Viernes' }, { value: 6, label: 'S', name: 'Sábado' },
  { value: 0, label: 'D', name: 'Domingo' }
];

export function normalizeDays(input) {
  if (!Array.isArray(input)) return [];
  const days = new Set();
  for (const item of input) {
    const n = typeof item === 'string' && item.trim() !== '' ? Number(item) : item;
    if (Number.isInteger(n) && n >= 0 && n <= 6) days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}

export function weekdayOf(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
  return WEEKDAYS[name] ?? null;
}

export function runsOnDay(days, date = new Date()) {
  const list = normalizeDays(days);
  if (list.length === 0 || list.length === 7) return true;
  const today = weekdayOf(date);
  return today !== null && list.includes(today);
}

export function formatDays(days) {
  const list = normalizeDays(days);
  if (list.length === 0 || list.length === 7) return 'Todos los días';
  return DAY_CHIPS.filter((d) => list.includes(d.value)).map((d) => d.label).join(' ');
}

// "8:05" o "08:05:00" → "08:05:00"; vacío o inválido → null.
export function normalizeStartTime(value) {
  if (value == null) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const h = Number(match[1]); const m = Number(match[2]); const s = Number(match[3] ?? 0);
  if (h > 23 || m > 59 || s > 59) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// "08:00:00" → "8:00 a. m." (mismo formato que la app del conductor).
export function formatTimeOfDay(value) {
  const t = normalizeStartTime(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

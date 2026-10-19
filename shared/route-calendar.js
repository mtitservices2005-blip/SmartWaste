// SW-101: calendario de rutas para el ciudadano (puro, sin DOM ni red). La hora es la de República Dominicana (UTC-4, sin horario de verano).
export const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const RD_OFFSET_MS = -4 * 3600e3;

function normalizeTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function normalizeRouteSchedule(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const name = String(row?.name ?? '').trim();
    if (!name) continue;
    const days = Array.isArray(row?.days_of_week)
      ? [...new Set(row.days_of_week.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    out.push({ name, days: days.length ? days : [...ALL_DAYS], time: normalizeTime(row?.start_time) });
  }
  return out;
}

const rdParts = (nowMs) => {
  const d = new Date(nowMs + RD_OFFSET_MS);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const toMinutes = (time) => (time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : Infinity);
const byTime = (a, b) => toMinutes(a.time) - toMinutes(b.time) || a.name.localeCompare(b.name, 'es');

export function buildWeekCalendar(routes, nowMs = Date.now()) {
  const { day: today } = rdParts(nowMs);
  return Array.from({ length: 7 }, (_, i) => {
    const day = (today + i) % 7;
    return {
      day,
      label: DAY_LABELS[day],
      isToday: i === 0,
      routes: routes.filter((r) => r.days.includes(day)).map((r) => ({ name: r.name, time: r.time })).sort(byTime)
    };
  });
}

function formatTime(time) {
  const h = Number(time.slice(0, 2));
  return `${h % 12 || 12}:${time.slice(3)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

export function describeNextDeparture(routes, nowMs = Date.now()) {
  if (!routes.length) return '';
  const { day: today, minutes: nowMin } = rdParts(nowMs);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = (today + offset) % 7;
    const candidates = routes
      .filter((r) => r.days.includes(day) && (offset > 0 || r.time === null || toMinutes(r.time) > nowMin))
      .sort(byTime);
    if (candidates.length) {
      const next = candidates[0];
      const when = offset === 0 ? 'hoy' : DAY_NAMES[day];
      return `Próxima salida: ${next.name}, ${when}${next.time ? ` ${formatTime(next.time)}` : ''}`;
    }
  }
  return '';
}

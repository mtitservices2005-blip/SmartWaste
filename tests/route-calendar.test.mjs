import assert from 'node:assert/strict';
import { normalizeRouteSchedule, buildWeekCalendar, describeNextDeparture, DAY_LABELS } from '../shared/route-calendar.js';

assert.deepEqual(DAY_LABELS, ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']);

// normalización: descarta rutas sin nombre, limpia días, hora a HH:MM, nulo = todos los días
const routes = normalizeRouteSchedule([
  { name: 'Ruta Centro', days_of_week: [1, 4], start_time: '08:00:00' },
  { name: 'Ruta Norte', days_of_week: null, start_time: '06:30' },
  { name: '  ', days_of_week: [2] },
  { name: 'Ruta Mercado', days_of_week: [9, 'x', 3, 3], start_time: null },
  { name: 'Ruta Sur', days_of_week: [], start_time: 'basura' }
]);
assert.deepEqual(routes.map((r) => r.name), ['Ruta Centro', 'Ruta Norte', 'Ruta Mercado', 'Ruta Sur']);
assert.deepEqual(routes[0], { name: 'Ruta Centro', days: [1, 4], time: '08:00' });
assert.deepEqual(routes[1].days, [0, 1, 2, 3, 4, 5, 6]);
assert.equal(routes[1].time, '06:30');
assert.deepEqual(routes[2].days, [3]);
assert.equal(routes[2].time, null);
assert.deepEqual(routes[3].days, [0, 1, 2, 3, 4, 5, 6]);
assert.equal(routes[3].time, null);
assert.deepEqual(normalizeRouteSchedule(null), []);

// calendario semanal: 7 columnas, empieza hoy (hora RD = UTC-4). 2026-10-19 es lunes.
const monday10am = Date.parse('2026-10-19T14:00:00Z'); // 10:00 en RD
const week = buildWeekCalendar(routes, monday10am);
assert.equal(week.length, 7);
assert.equal(week[0].label, 'Lun');
assert.equal(week[0].isToday, true);
assert.equal(week[1].isToday, false);
assert.deepEqual(week.map((d) => d.label), ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
const names = (d) => d.routes.map((r) => r.name);
assert.ok(names(week[0]).includes('Ruta Centro') && names(week[0]).includes('Ruta Norte'));
assert.ok(!names(week[1]).includes('Ruta Centro'));
assert.ok(names(week[3]).includes('Ruta Centro')); // jueves
assert.ok(names(week[2]).includes('Ruta Mercado')); // miércoles
// ordenadas por hora (sin hora al final)
assert.deepEqual(names(week[0]), ['Ruta Norte', 'Ruta Centro', 'Ruta Sur']);
// el día cambia con la hora de RD, no con UTC: domingo 23:30 UTC = domingo 19:30 RD
assert.equal(buildWeekCalendar(routes, Date.parse('2026-10-18T23:30:00Z'))[0].label, 'Dom');
// lunes 02:00 UTC sigue siendo domingo en RD
assert.equal(buildWeekCalendar(routes, Date.parse('2026-10-19T02:00:00Z'))[0].label, 'Dom');

// próxima salida
const only = normalizeRouteSchedule([{ name: 'Ruta Centro', days_of_week: [1, 4], start_time: '08:00' }]);
assert.equal(describeNextDeparture(only, monday10am), 'Próxima salida: Ruta Centro, jueves 8:00 a. m.');
assert.equal(describeNextDeparture(only, Date.parse('2026-10-19T11:00:00Z')), 'Próxima salida: Ruta Centro, hoy 8:00 a. m.'); // 07:00 RD
assert.equal(describeNextDeparture(only, Date.parse('2026-10-22T20:00:00Z')), 'Próxima salida: Ruta Centro, lunes 8:00 a. m.'); // jueves 16:00 RD
assert.equal(describeNextDeparture([], monday10am), '');
const noTime = normalizeRouteSchedule([{ name: 'Ruta Sur', days_of_week: [2], start_time: null }]);
assert.equal(describeNextDeparture(noTime, monday10am), 'Próxima salida: Ruta Sur, martes');
console.log('route-calendar ok');

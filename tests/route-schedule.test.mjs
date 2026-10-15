// SW-086 (CA1, CA13): hora de inicio y días de cada ruta. Fecha local de República Dominicana.
import assert from 'node:assert/strict';
import { normalizeDays, runsOnDay, formatDays, normalizeStartTime, formatTimeOfDay, weekdayOf, DAY_CHIPS } from '../shared/route-schedule.js';

// Días: 0 = domingo … 6 = sábado. Entrada inválida se descarta; salida ordenada y sin repetidos.
assert.deepEqual(normalizeDays([5, 1, 3, 1]), [1, 3, 5]);
assert.deepEqual(normalizeDays(['1', 2]), [1, 2]);
assert.deepEqual(normalizeDays([7, -1, 2.5, 'x', null, 4]), [4]);
assert.deepEqual(normalizeDays(null), []);
assert.deepEqual(normalizeDays(undefined), []);
assert.deepEqual(normalizeDays('1,2'), [], 'solo arreglos');

// Fecha: 14 oct 2026 es miércoles (3). 15 oct 2026 02:00 UTC aún es miércoles en Santo Domingo (22:00).
assert.equal(weekdayOf(new Date('2026-10-14T15:00:00Z')), 3);
assert.equal(weekdayOf(new Date('2026-10-15T02:00:00Z')), 3, 'UTC ya es jueves pero en RD sigue siendo miércoles');
assert.equal(weekdayOf(new Date('2026-10-15T04:00:00Z')), 4);

// Sin días elegidos = todos los días (D8).
assert.equal(runsOnDay([], new Date('2026-10-14T15:00:00Z')), true);
assert.equal(runsOnDay(null, new Date('2026-10-14T15:00:00Z')), true);
assert.equal(runsOnDay([1, 3, 5], new Date('2026-10-14T15:00:00Z')), true, 'miércoles');
assert.equal(runsOnDay([1, 5], new Date('2026-10-14T15:00:00Z')), false);

// Texto de días.
assert.equal(formatDays([]), 'Todos los días');
assert.equal(formatDays(null), 'Todos los días');
assert.equal(formatDays([0, 1, 2, 3, 4, 5, 6]), 'Todos los días');
assert.equal(formatDays([5, 1, 3]), 'L X V');
assert.equal(formatDays([0, 6]), 'S D', 'se muestra lunes primero y domingo al final');
assert.equal(formatDays([2]), 'M');

// Los botones de días del formulario: lunes primero.
assert.deepEqual(DAY_CHIPS.map((d) => d.label), ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
assert.deepEqual(DAY_CHIPS.map((d) => d.value), [1, 2, 3, 4, 5, 6, 0]);

// Hora de inicio del día (sin fecha).
assert.equal(normalizeStartTime('08:00'), '08:00:00');
assert.equal(normalizeStartTime('8:05'), '08:05:00');
assert.equal(normalizeStartTime('23:59:00'), '23:59:00');
assert.equal(normalizeStartTime(''), null);
assert.equal(normalizeStartTime(null), null);
assert.equal(normalizeStartTime('25:00'), null);
assert.equal(normalizeStartTime('12:60'), null);
assert.equal(normalizeStartTime('abc'), null);
assert.equal(formatTimeOfDay('08:00:00'), '8:00 a. m.');
assert.equal(formatTimeOfDay('00:05:00'), '12:05 a. m.');
assert.equal(formatTimeOfDay('12:00:00'), '12:00 p. m.');
assert.equal(formatTimeOfDay('15:30:00'), '3:30 p. m.');
assert.equal(formatTimeOfDay(null), null);
assert.equal(formatTimeOfDay('basura'), null);
console.log('route-schedule ok');

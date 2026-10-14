// SW-086 (CA5, CA6, CA11): trazo de la ruta nueva — añadir, mover, deshacer, borrar todo, validar y vista previa.
import assert from 'node:assert/strict';
import { addPoint, movePoint, undoPoint, clearPoints, validateDraft, previewDraft } from '../shared/route-draft.js';

const A = [19.0, -71.0]; const B = [19.001, -71.0]; const C = [19.002, -71.001];

// Añadir: no muta, ignora coordenadas inválidas.
const p0 = [];
const p1 = addPoint(p0, A);
assert.deepEqual(p0, []); assert.deepEqual(p1, [A]);
assert.deepEqual(addPoint(p1, [NaN, 1]), p1);
assert.deepEqual(addPoint(p1, null), p1);
assert.deepEqual(addPoint(p1, [95, 0]), p1, 'latitud fuera de rango');
assert.deepEqual(addPoint(p1, [0, 190]), p1, 'longitud fuera de rango');

// Mover: cambia solo ese punto; índice inválido no hace nada.
const p3 = [A, B, C];
assert.deepEqual(movePoint(p3, 1, [19.0015, -71.0005]), [A, [19.0015, -71.0005], C]);
assert.deepEqual(p3, [A, B, C], 'no muta');
assert.deepEqual(movePoint(p3, 9, A), p3);
assert.deepEqual(movePoint(p3, -1, A), p3);
assert.deepEqual(movePoint(p3, 1, [NaN, 0]), p3);

// Deshacer y borrar todo.
assert.deepEqual(undoPoint(p3), [A, B]);
assert.deepEqual(undoPoint([]), []);
assert.deepEqual(clearPoints(), []);

// Validar (mismos mensajes que la pantalla de hoy).
assert.deepEqual(validateDraft({ name: '', points: p3 }), { ok: false, message: 'Ingresa un nombre para la ruta.' });
assert.deepEqual(validateDraft({ name: '   ', points: p3 }), { ok: false, message: 'Ingresa un nombre para la ruta.' });
assert.deepEqual(validateDraft({ name: 'Centro', points: [A] }), { ok: false, message: 'Traza al menos 2 puntos en el mapa.' });
assert.deepEqual(validateDraft({ name: 'Centro', points: p3, saving: true }), { ok: false, message: 'Guardando la ruta…' });
assert.deepEqual(validateDraft({ name: ' Centro ', points: p3 }), { ok: true, message: '', name: 'Centro' });

// Vista previa: distancia, paradas, puntos; el tiempo solo si existe (D2).
const pv = previewDraft({ points: [A, B] });
assert.equal(pv.pointsText, '2 puntos trazados');
assert.equal(pv.distanceText, '111 m');
assert.ok(pv.stopsCount >= 2);
assert.equal(pv.timeText, '—', 'sin duración medida no se inventa');
assert.equal(previewDraft({ points: [A, B], durationSeconds: 2520 }).timeText, '42 min');
assert.equal(previewDraft({ points: [A, B], durationSeconds: 0 }).timeText, '—');
assert.equal(previewDraft({ points: [A, B], durationSeconds: 90 }).timeText, '2 min', 'se redondea al minuto más cercano, mínimo 1');
assert.equal(previewDraft({ points: [A] }).pointsText, '1 punto trazado');
assert.equal(previewDraft({ points: [] }).pointsText, '0 puntos trazados');
assert.equal(previewDraft({ points: [] }).distanceText, '—');
assert.equal(previewDraft({ points: [A] }).stopsCount, 0, 'con un punto aún no hay paradas');
// Con un trazo ya ajustado a calles, la distancia sale del trazo ajustado.
assert.equal(previewDraft({ points: [A, B], path: [A, [19.0005, -71.0002], B] }).distanceText, previewDraft({ points: [A, B], path: [A, [19.0005, -71.0002], B] }).distanceText);
assert.ok(parseFloat(previewDraft({ points: [A, C] }).distanceText) > 0);
console.log('route-draft ok');

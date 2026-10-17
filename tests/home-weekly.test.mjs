import assert from 'node:assert/strict';
import { renderHomeWeekly } from '../frontend/components/summary-screens.js';

const rec = (id, severity, title) => ({ id, severity, title, detail: `Detalle de ${title}` });
const weekly = {
  isEmpty: false, period: { days: 7, from: '2026-10-10', to: '2026-10-16' },
  headline: ['8 corridas completadas, 48 km medidos y 9 h 30 min en ruta.', 'Consumo: 13,5 L en 2 de 3 camiones con dato.', 'Huella de carbono estimada: 36,18 kg CO₂.'],
  recommendations: [rec('a', 'atencion', 'Uno <x>'), rec('b', 'atencion', 'Dos'), rec('c', 'info', 'Tres'), rec('d', 'ok', 'Cuatro')], text: ''
};
const h = renderHomeWeekly({ weekly });
assert.match(h, /Esta semana/); assert.match(h, /10 oct – 16 oct/);
for (const l of weekly.headline) assert.ok(h.includes(l));
assert.match(h, /Uno &lt;x&gt;/); assert.ok(!h.includes('<x>'), 'escapa texto');
assert.match(h, /Dos/); assert.match(h, /Tres/); assert.ok(!h.includes('Cuatro'), 'solo las 3 primeras');
assert.match(h, /1 recomendación más/);
assert.match(h, /href="#operaciones\/estadisticas"[^>]*data-metrics-open-summary/);
assert.match(h, /Ver el resumen completo/);
assert.ok(!renderHomeWeekly({ weekly: { ...weekly, recommendations: weekly.recommendations.slice(0, 2) } }).includes('recomendación más'));
const empty = renderHomeWeekly({ weekly: { isEmpty: true, period: { days: 7, from: null, to: null }, headline: ['No hubo corridas completadas en los últimos 7 días.'], recommendations: [], text: '' } });
assert.match(empty, /No hubo corridas completadas/);
assert.match(renderHomeWeekly({ weekly: null }), /Cuando haya corridas reales/);
console.log('home-weekly: ok');

// SW-093: app.js muestra el resumen semanal en Inicio.
import { readFileSync } from 'node:fs';
const appSrc = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
for (const needle of ['renderHomeWeekly', 'id="resumenSemana"', 'homeWeeklyHtml()', 'refreshResumenSemana', 'data-metrics-open-summary']) {
  assert.ok(appSrc.includes(needle), `app.js debe contener ${needle}`);
}
console.log('home-weekly wiring: ok');

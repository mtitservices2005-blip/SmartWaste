// SW-084 (CA5, CA6): indicadores del centro de control. Función pura: nunca inventa un número;
// un dato que no existe se muestra "—".
import assert from 'node:assert/strict';
import { computeOpsKpis, formatKm, formatLiters, formatPercent, freshnessLabel, FRESH_LIMIT_SECONDS } from '../shared/ops-kpis.js';

assert.equal(formatKm(6.44), '6,4 km');
assert.equal(formatKm(41), '41 km');
assert.equal(formatKm(1234.5), '1.234,5 km');
assert.equal(formatKm(null), '—');
assert.equal(formatKm(undefined), '—');
assert.equal(formatKm(Number.NaN), '—');
assert.equal(formatKm(0), '0 km', 'cero es un dato real, no ausencia');
assert.equal(formatLiters(72), '72 L');
assert.equal(formatLiters(18.5), '18,5 L');
assert.equal(formatLiters(null), '—');
assert.equal(formatPercent(64), '64%');
assert.equal(formatPercent(63.6), '64%');
assert.equal(formatPercent(null), '—');
assert.equal(formatPercent(-3), '—', 'un porcentaje negativo no es válido');

// Antigüedad del dato más reciente.
const now = Date.parse('2026-10-14T12:00:00Z');
assert.equal(freshnessLabel({ lastCapturedAt: now - 8000, now }), 'EN VIVO · 8 s');
assert.equal(freshnessLabel({ lastCapturedAt: now - 75000, now }), 'EN VIVO · 1 min');
assert.equal(freshnessLabel({ lastCapturedAt: now - (FRESH_LIMIT_SECONDS + 1) * 1000, now }), 'SIN DATOS RECIENTES');
assert.equal(freshnessLabel({ lastCapturedAt: null, now }), 'SIN DATOS');
assert.equal(freshnessLabel({ lastCapturedAt: now + 5000, now }), 'EN VIVO · 0 s', 'un reloj adelantado no da negativos');
assert.equal(freshnessLabel({ lastCapturedAt: '2026-10-14T11:59:50Z', now }), 'EN VIVO · 10 s', 'acepta fechas ISO');

// KPIs a partir de datos ya cargados.
{
  const k = computeOpsKpis({
    vehicles: [
      { id: 'c1', status: 'en_ruta', lastCapturedAt: now - 8000 },
      { id: 'c2', status: 'en_ruta', lastCapturedAt: now - 12000 },
      { id: 'c3', status: 'sin_senal', lastCapturedAt: now - 240000 },
      { id: 'c4', status: 'disponible', lastCapturedAt: null }
    ],
    coverageRate: 64, distanceKm: 41, fuelLiters: 72, now
  });
  assert.equal(k.enRuta, 2);
  assert.equal(k.alerts, 1, 'sin señal cuenta como alerta');
  assert.equal(k.coverage, '64%');
  assert.equal(k.distance, '41 km');
  assert.equal(k.fuel, '72 L');
  assert.equal(k.freshness, 'EN VIVO · 8 s', 'usa el dato más reciente de toda la flota');
}
{
  const k = computeOpsKpis({ vehicles: [], now });
  assert.equal(k.enRuta, 0);
  assert.equal(k.alerts, 0);
  assert.equal(k.coverage, '—');
  assert.equal(k.distance, '—');
  assert.equal(k.fuel, '—');
  assert.equal(k.freshness, 'SIN DATOS');
}
assert.doesNotThrow(() => computeOpsKpis({ now }), 'sin vehículos tampoco falla');
console.log('ops-kpis ok');

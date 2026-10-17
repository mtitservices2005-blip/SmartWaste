// SW-092: resumen semanal y recomendaciones. Puro (sin red ni DOM). Son reglas simples sobre las corridas
// guardadas, no una predicción: cada recomendación dice qué dato la motivó y qué revisar, sin afirmar la causa.
import { buildMetricsView, formatNumber, formatKm, formatDuration } from './metrics-view.js';

export const WEEKLY_THRESHOLDS = { estimatedShare: 0.5, minRunsForShare: 3, repeatedDeviations: 2, truckGapPct: 25, co2ChangePct: 10 };
const SEVERITY_ORDER = ['atencion', 'info', 'ok'];
const pctText = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${String(Math.abs(n)).replace('.', ',')} %`;

export function buildWeeklySummary({ runs = [], vehicles = [], routes = [], drivers = [], fuelLogs = [], now = new Date() } = {}) {
  const T = WEEKLY_THRESHOLDS;
  const view = buildMetricsView({ runs, vehicles, routes, drivers, fuelLogs, period: 7, filters: {}, now });
  const cmp = view.comparison;
  const s = view.summary;
  const period = { days: 7, from: view.series[0]?.day ?? null, to: view.series[view.series.length - 1]?.day ?? null };
  if (view.isEmpty) {
    const text = 'Resumen semanal de SmartWaste\nNo hubo corridas completadas en los últimos 7 días.';
    return { isEmpty: true, period, headline: ['No hubo corridas completadas en los últimos 7 días.'], recommendations: [{ id: 'sin-corridas', severity: 'info', title: 'No hubo corridas completadas esta semana', detail: 'Si debían salir rutas, revisa que los conductores inicien y terminen la corrida desde la app.' }], text };
  }

  const delta = cmp.periodVsPrevious.deltas;
  const headline = [`${s.runCount} ${s.runCount === 1 ? 'corrida completada' : 'corridas completadas'}, ${formatKm(s.totalKm)} medidos y ${formatDuration(s.totalMinutes)} en ruta.`];
  headline.push(s.liters === null ? 'Consumo: sin datos (falta rendimiento del camión o litros registrados).' : `Consumo: ${formatNumber(s.liters, 2)} L en ${s.vehiclesWithData} de ${s.vehiclesTotal} camiones con dato.`);
  headline.push(s.co2Kg === null ? 'Huella de carbono: sin datos.' : `Huella de carbono estimada: ${formatNumber(s.co2Kg, 2)} kg CO₂${delta.co2Kg === null ? '' : ` (${pctText(delta.co2Kg)} contra la semana anterior)`}.`);

  const recs = [];
  // 1. Camiones sin rendimiento: no entran en consumo ni CO₂.
  if (view.missingConfig.length) {
    const names = view.missingConfig.map((m) => m.label).join(', ');
    recs.push({ id: 'vehiculo-sin-rendimiento', severity: 'atencion', title: `Configura el rendimiento de ${names}`, detail: `Sin rendimiento (km por litro) ni litros registrados, ${view.missingConfig.length === 1 ? 'ese camión queda fuera' : 'esos camiones quedan fuera'} del consumo y la huella de carbono.`, action: { kind: 'flota' } });
  }
  // 2. Desvíos repetidos en una misma ruta.
  const byRoute = new Map();
  for (const d of cmp.deviations) byRoute.set(d.routeName, [...(byRoute.get(d.routeName) ?? []), d]);
  for (const [name, list] of byRoute) {
    if (list.length >= T.repeatedDeviations) recs.push({ id: 'desvios-repetidos', severity: 'atencion', title: `Revisa ${name}: ${list.length} corridas se salieron de lo habitual`, detail: 'Cada una fue más larga, más corta o con más CO₂ que la mediana de esa ruta. Puede ser tráfico, un desvío o un cambio de recorrido.', action: { kind: 'comparar' } });
  }
  // 3. Un camión emite mucho más CO₂ por km que otro en la misma ruta.
  for (const g of cmp.trucksOnRoute) {
    const withCo2 = g.trucks.filter((t) => t.co2PerKm !== null);
    if (withCo2.length < 2) continue;
    const best = withCo2.reduce((a, b) => (b.co2PerKm < a.co2PerKm ? b : a));
    const worst = withCo2.reduce((a, b) => (b.co2PerKm > a.co2PerKm ? b : a));
    const gap = Math.round(((worst.co2PerKm - best.co2PerKm) / best.co2PerKm) * 1000) / 10;
    if (gap > T.truckGapPct) recs.push({ id: 'camion-gasta-mas', severity: 'atencion', title: `${worst.label} emite ${pctText(gap).replace('+', '')} más CO₂ por km en ${g.routeName}`, detail: `${best.label} hace la misma ruta con ${formatNumber(best.co2PerKm, 2)} kg CO₂/km y ${worst.label} con ${formatNumber(worst.co2PerKm, 2)}. Conviene revisar el rendimiento configurado, el mantenimiento o la carga.`, action: { kind: 'comparar' } });
  }
  // 4. Cambio de la huella de carbono contra la semana anterior.
  if (delta.co2Kg !== null && delta.co2Kg >= T.co2ChangePct) recs.push({ id: 'co2-sube', severity: 'atencion', title: `La huella de carbono subió ${pctText(delta.co2Kg).replace('+', '')} contra la semana anterior`, detail: 'Compara kilómetros y corridas de ambas semanas en Métricas > Comparar para ver si fue más recorrido o más consumo por km.', action: { kind: 'comparar' } });
  if (delta.co2Kg !== null && delta.co2Kg <= -T.co2ChangePct) recs.push({ id: 'co2-baja', severity: 'ok', title: `La huella de carbono bajó ${pctText(delta.co2Kg).replace('−', '')} contra la semana anterior`, detail: 'Buen avance. Revisa en Comparar si se debe a menos kilómetros o a menos consumo por kilómetro.', action: { kind: 'comparar' } });
  // 5. Mucho consumo estimado: pedir litros reales.
  const est = s.rows.filter((r) => r.source === 'estimado').length;
  if (s.runCount >= T.minRunsForShare && est / s.runCount >= T.estimatedShare) recs.push({ id: 'litros-no-registrados', severity: 'info', title: 'Pide a los conductores registrar los litros al terminar la ruta', detail: `${est} de ${s.runCount} corridas usan consumo estimado. Con los litros reales la huella de carbono es más exacta.` });

  if (!recs.length) recs.push({ id: 'sin-novedades', severity: 'ok', title: 'Sin novedades esta semana', detail: 'Ninguna corrida se salió de lo habitual y los datos de consumo están completos.' });
  recs.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const text = ['Resumen semanal de SmartWaste', `Del ${period.from} al ${period.to}`, '', ...headline, '', 'Recomendaciones:', ...recs.map((r, i) => `${i + 1}. ${r.title}. ${r.detail}`)].join('\n');
  return { isEmpty: false, period, headline, recommendations: recs, text };
}

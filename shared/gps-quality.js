// SW-096: calidad de los puntos GPS. Un punto con precisión mala (el teléfono llegó a reportar 405 m)
// o un salto imposible entre dos puntos no deben contar para la distancia, el consumo ni el trazo.
// Los puntos ya guardados no se borran: solo se ignoran al calcular y al dibujar.
export const MAX_ACCURACY_METERS = 50;
export const MAX_SPEED_KMH = 120;

// Precisión desconocida (sin dato) se acepta; un número peor que el tope o un valor raro, no.
export function isAccuracyUsable(accuracy, max = MAX_ACCURACY_METERS) {
  if (accuracy === null || accuracy === undefined) return true;
  const n = Number(accuracy);
  return Number.isFinite(n) && n <= max;
}

function metersBetween(a, b) {
  const rad = (d) => Number(d) * Math.PI / 180;
  const dLat = rad(b.latitude) - rad(a.latitude);
  const dLon = rad(b.longitude) - rad(a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Puntos ordenados por hora, sin los de mala precisión y sin los saltos imposibles medidos contra el último punto conservado.
export function cleanTrack(samples, { maxAccuracy = MAX_ACCURACY_METERS, maxSpeedKmh = MAX_SPEED_KMH } = {}) {
  const sorted = (samples ?? [])
    .filter((s) => Number.isFinite(Number(s?.latitude)) && Number.isFinite(Number(s?.longitude)) && Number.isFinite(Date.parse(s?.captured_at)))
    .filter((s) => isAccuracyUsable(s.accuracy, maxAccuracy))
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const kept = [];
  for (const s of sorted) {
    const last = kept[kept.length - 1];
    if (last) {
      const seconds = (Date.parse(s.captured_at) - Date.parse(last.captured_at)) / 1000;
      const meters = metersBetween(last, s);
      if (seconds <= 0) { if (meters > maxAccuracy) continue; }
      else if ((meters / seconds) * 3.6 > maxSpeedKmh) continue;
    }
    kept.push(s);
  }
  return kept;
}

export function trackStats(samples, options) {
  const rawCount = (samples ?? []).length;
  const clean = cleanTrack(samples, options);
  let distanceMeters = 0;
  for (let i = 1; i < clean.length; i += 1) distanceMeters += metersBetween(clean[i - 1], clean[i]);
  return {
    distanceMeters,
    usedCount: clean.length,
    rawCount,
    startedAt: clean[0]?.captured_at ?? null,
    endedAt: clean[clean.length - 1]?.captured_at ?? null
  };
}

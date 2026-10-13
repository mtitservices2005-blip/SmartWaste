// SW-081: estado derivado de un camión de la flotilla. Mismas reglas y umbrales que la función SQL
// derive_vehicle_status (supabase/migrations/202610120001_sw081_fleet_live_state.sql); la tabla de
// casos de tests/fleet-status.test.mjs y de tests/fleet-ingest.test.mjs es la misma a propósito.
//   disponible: sin corrida activa (aunque se mueva).
//   sin_senal : corrida activa y última posición con más de 90 s (o ninguna).
//   detenido  : corrida activa, velocidad < 1 m/s desde hace más de 5 minutos.
//   en_ruta   : corrida activa y reportando.
export const FLEET_THRESHOLDS = Object.freeze({ noSignalSeconds: 90, stoppedSpeedMps: 1, stoppedMinutes: 5 });

function toMillis(value, name) {
  if (value === null || value === undefined) return null;
  const millis = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(millis)) throw new TypeError(`${name}: fecha inválida (${String(value)})`);
  return millis;
}

export function deriveVehicleStatus({ hasActiveRun, lastCapturedAt = null, lastSpeed = null, stoppedSince = null, now = Date.now() }) {
  if (!hasActiveRun) return 'disponible';
  const nowMs = toMillis(now, 'now');
  const lastMs = toMillis(lastCapturedAt, 'lastCapturedAt');
  if (lastMs === null || nowMs - lastMs > FLEET_THRESHOLDS.noSignalSeconds * 1000) return 'sin_senal';
  const stoppedMs = toMillis(stoppedSince, 'stoppedSince');
  const slow = lastSpeed === null || lastSpeed === undefined ? true : Number(lastSpeed) < FLEET_THRESHOLDS.stoppedSpeedMps;
  if (stoppedMs !== null && slow && nowMs - stoppedMs > FLEET_THRESHOLDS.stoppedMinutes * 60 * 1000) return 'detenido';
  return 'en_ruta';
}

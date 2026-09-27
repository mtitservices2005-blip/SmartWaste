// SW-029: "GPS del teléfono" toggle in the driver's own view (vista móvil conductor) — a demo/tour
// mode that shows the phone's real position on the map instead of the simulated one, with no real
// backend/session required. Deliberately separate from shared/browser-geolocation.js (the existing
// "Compartir mi ubicación real" flow, roadmap item 3), which already writes to Supabase via
// createTelemetryIngestionAdapter (source: 'browser_geolocation', requires an authenticated driver
// session + route_run_id) and is VERIFIED_REAL (docs/TECHNICAL_DEBT_REGISTER.md item #20) — that's
// the flow the real pilot (SW-041) will use once it starts.
//
// Pure, no DOM/navigator access here, so this is testable without a browser — same separation
// shared/browser-geolocation.js and shared/osrm-routing.js already use.
//
// Closure decision confirmed with the Project Owner (2026-09-27, docs/SW029_PHONE_GPS_FASE1.md):
// this module is demo/tour-only by permanent design, not a fase 1 of something completed later.
// There is no fase 2 — no Supabase persistence, no 'phone' added to TELEMETRY_SOURCES or the
// vehicle_positions CHECK constraint. The real GPS need is already solved by browser_geolocation;
// what's still pending is the pilot itself starting (SW-041), not more engineering here.

// A garbage truck's own GPS reading worse than this is unreliable enough to skip rather than draw
// a misleading position on the map — the caller (frontend/app.js) shows a "señal débil" message for
// a discarded reading instead of failing silently.
export const MAX_ACCURACY_METERS = 50;

export function isAccuracyAcceptable(accuracy, maxAccuracyMeters = MAX_ACCURACY_METERS) {
  return Number.isFinite(accuracy) && accuracy <= maxAccuracyMeters;
}

// watchPosition() can fire far more often than a garbage truck's position meaningfully changes —
// throttle client-side before recording each one. Same shape as shared/browser-geolocation.js's
// shouldSendPosition(), kept as its own copy (not imported) so this module's contract — and its
// tests — stand alone from that other, Supabase-writing flow's.
export function shouldSendPhonePing(lastSentAt, now, minIntervalMs = 4500) {
  return now - lastSentAt >= minIntervalMs;
}

// Converts a browser GeolocationPosition into the shape shared/telemetry-simulator.js's
// createDemoPositionHistory().record() already expects (see frontend/app.js's tickDriverTelemetry(),
// which records DeviceSimulator.emit()'s output into the same store) — no municipality_id/
// route_run_id required, since this mode never reaches validateTelemetryPosition()/ingest().
export function buildPhoneGpsPing(geoPosition, { vehicle_id, device_id = 'phone-browser' } = {}) {
  const { latitude, longitude, accuracy, speed, heading } = geoPosition.coords;
  return {
    vehicle_id,
    latitude,
    longitude,
    accuracy: accuracy ?? 0,
    speed: speed ?? 0,
    heading: heading ?? 0,
    captured_at: new Date(geoPosition.timestamp).toISOString(),
    received_at: new Date().toISOString(),
    source: 'phone',
    device_id
  };
}

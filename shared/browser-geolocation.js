// "GPS real" (roadmap ítem 3): converts a browser GeolocationPosition (from
// navigator.geolocation.watchPosition, called from frontend/app.js's driver mobile view) into the
// position shape shared/telemetry-simulator.js's validateTelemetryPosition()/ingest() already
// expect — no new validation rules, reuse what's there. Pure, no DOM/navigator access here, so this
// is testable without a browser (the same separation used for shared/osrm-routing.js).
export function positionFromGeolocationEvent(geoPosition, { vehicle_id, municipality_id, route_run_id = null, device_id = 'browser-geolocation' } = {}) {
  const { latitude, longitude, accuracy, speed, heading } = geoPosition.coords;
  return {
    vehicle_id,
    municipality_id,
    route_run_id,
    latitude,
    longitude,
    accuracy: accuracy ?? 0,
    speed: speed ?? 0,
    heading: heading ?? 0,
    captured_at: new Date(geoPosition.timestamp).toISOString(),
    received_at: new Date().toISOString(),
    source: 'browser_geolocation',
    device_id
  };
}

// watchPosition() can fire far more often than a garbage truck's position meaningfully changes —
// throttle client-side before spending a real insert on each event.
export function shouldSendPosition(lastSentAt, now, minIntervalMs = 5000) {
  return now - lastSentAt >= minIntervalMs;
}

// Starts getCurrentPosition() synchronously when called, preserving the short-lived user gesture
// browsers such as mobile Safari require before showing their location permission prompt. The
// injected geolocation object keeps this deterministic in Node tests and avoids reading navigator
// from shared code.
export function requestCurrentBrowserPosition(geolocation, options = {}) {
  if (!geolocation?.getCurrentPosition) {
    return Promise.resolve({ ok: false, error: { code: 'UNSUPPORTED', message: 'Este navegador no soporta geolocalización.' } });
  }
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => resolve({ ok: true, position }),
      (error) => resolve({ ok: false, error }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0, ...options }
    );
  });
}

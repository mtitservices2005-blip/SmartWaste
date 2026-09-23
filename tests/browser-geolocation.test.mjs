// Roadmap item 3 ("GPS real"): unit coverage for shared/browser-geolocation.js — pure conversion
// logic, no navigator/DOM needed, so a plain object stands in for a browser GeolocationPosition.
import assert from 'node:assert/strict';
import { positionFromGeolocationEvent, requestCurrentBrowserPosition, shouldSendPosition } from '../shared/browser-geolocation.js';
import { validateTelemetryPosition } from '../shared/telemetry-simulator.js';

// 1. Happy path: full coords convert to the shape ingest()/validateTelemetryPosition() expect.
const geoPosition = { coords: { latitude: 19.6489, longitude: -71.0956, accuracy: 8, speed: 3.2, heading: 90 }, timestamp: Date.now() };
const position = positionFromGeolocationEvent(geoPosition, { vehicle_id: 'truck-01', municipality_id: 'laguna-salada-rd', route_run_id: 'run-01' });
assert.equal(position.vehicle_id, 'truck-01');
assert.equal(position.municipality_id, 'laguna-salada-rd');
assert.equal(position.route_run_id, 'run-01');
assert.equal(position.latitude, 19.6489);
assert.equal(position.longitude, -71.0956);
assert.equal(position.accuracy, 8);
assert.equal(position.speed, 3.2);
assert.equal(position.heading, 90);
assert.equal(position.source, 'browser_geolocation');
assert.equal(position.device_id, 'browser-geolocation');
assert.ok(position.captured_at);
assert.ok(position.received_at);
const validation = validateTelemetryPosition(position);
assert.deepEqual(validation.errors, []);
assert.equal(validation.valid, true, 'a converted browser position must pass the same validation real ingestion uses');

// 2. Null-prone browser fields (accuracy/speed/heading can be null in real GeolocationCoordinates)
// must default to 0, not leak null into the telemetry payload / fail validation.
const sparseGeoPosition = { coords: { latitude: 19.65, longitude: -71.10, accuracy: null, speed: null, heading: null }, timestamp: Date.now() };
const sparsePosition = positionFromGeolocationEvent(sparseGeoPosition, { vehicle_id: 'truck-02', municipality_id: 'laguna-salada-rd', route_run_id: 'run-02' });
assert.equal(sparsePosition.accuracy, 0);
assert.equal(sparsePosition.speed, 0);
assert.equal(sparsePosition.heading, 0);
assert.equal(validateTelemetryPosition(sparsePosition).valid, true);

// 3. Custom device_id is honored when passed.
const customDevice = positionFromGeolocationEvent(geoPosition, { vehicle_id: 'truck-01', municipality_id: 'm1', route_run_id: 'run-01', device_id: 'phone-123' });
assert.equal(customDevice.device_id, 'phone-123');

const unscopedBrowserPosition = positionFromGeolocationEvent(geoPosition, { vehicle_id: 'truck-01', municipality_id: 'm1' });
assert.equal(validateTelemetryPosition(unscopedBrowserPosition).valid, false, 'browser GPS must be tied to an active route_run');

// 4. shouldSendPosition: throttle behavior.
assert.equal(shouldSendPosition(0, 4999, 5000), false, 'must not send before the minimum interval elapses');
assert.equal(shouldSendPosition(0, 5000, 5000), true, 'must send exactly at the minimum interval');
assert.equal(shouldSendPosition(0, 10000, 5000), true, 'must send well after the minimum interval');
assert.equal(shouldSendPosition(1000, 1000, 5000), false, 'zero elapsed time must not send');

// 5. Permission preflight starts immediately (inside the click call stack), returns the first
// position, and keeps the high-accuracy/no-cache defaults needed for a real route start.
let requestedOptions;
let requestStarted = false;
const successfulRequest = requestCurrentBrowserPosition({
  getCurrentPosition(success, _failure, options) {
    requestStarted = true;
    requestedOptions = options;
    queueMicrotask(() => success(geoPosition));
  }
});
assert.equal(requestStarted, true, 'permission request must start synchronously before any await');
assert.deepEqual(await successfulRequest, { ok: true, position: geoPosition });
assert.deepEqual(requestedOptions, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });

const denied = await requestCurrentBrowserPosition({
  getCurrentPosition(_success, failure) { failure({ code: 1, message: 'User denied Geolocation' }); }
});
assert.equal(denied.ok, false);
assert.equal(denied.error.code, 1);

const unsupported = await requestCurrentBrowserPosition(null);
assert.equal(unsupported.ok, false);
assert.equal(unsupported.error.code, 'UNSUPPORTED');

console.log('browser-geolocation ok');

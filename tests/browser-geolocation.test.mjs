// Roadmap item 3 ("GPS real"): unit coverage for shared/browser-geolocation.js — pure conversion
// logic, no navigator/DOM needed, so a plain object stands in for a browser GeolocationPosition.
import assert from 'node:assert/strict';
import { positionFromGeolocationEvent, shouldSendPosition } from '../shared/browser-geolocation.js';
import { validateTelemetryPosition } from '../shared/telemetry-simulator.js';

// 1. Happy path: full coords convert to the shape ingest()/validateTelemetryPosition() expect.
const geoPosition = { coords: { latitude: 19.6489, longitude: -71.0956, accuracy: 8, speed: 3.2, heading: 90 }, timestamp: Date.now() };
const position = positionFromGeolocationEvent(geoPosition, { vehicle_id: 'truck-01', municipality_id: 'laguna-salada-rd' });
assert.equal(position.vehicle_id, 'truck-01');
assert.equal(position.municipality_id, 'laguna-salada-rd');
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
const sparsePosition = positionFromGeolocationEvent(sparseGeoPosition, { vehicle_id: 'truck-02', municipality_id: 'laguna-salada-rd' });
assert.equal(sparsePosition.accuracy, 0);
assert.equal(sparsePosition.speed, 0);
assert.equal(sparsePosition.heading, 0);
assert.equal(validateTelemetryPosition(sparsePosition).valid, true);

// 3. Custom device_id is honored when passed.
const customDevice = positionFromGeolocationEvent(geoPosition, { vehicle_id: 'truck-01', municipality_id: 'm1', device_id: 'phone-123' });
assert.equal(customDevice.device_id, 'phone-123');

// 4. shouldSendPosition: throttle behavior.
assert.equal(shouldSendPosition(0, 4999, 5000), false, 'must not send before the minimum interval elapses');
assert.equal(shouldSendPosition(0, 5000, 5000), true, 'must send exactly at the minimum interval');
assert.equal(shouldSendPosition(0, 10000, 5000), true, 'must send well after the minimum interval');
assert.equal(shouldSendPosition(1000, 1000, 5000), false, 'zero elapsed time must not send');

console.log('browser-geolocation ok');

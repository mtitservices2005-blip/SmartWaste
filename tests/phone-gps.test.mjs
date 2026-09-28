// SW-029 fase 1: unit coverage for shared/phone-gps.js — pure conversion/filter/throttle logic, no
// navigator/DOM needed, so a plain object stands in for a browser GeolocationPosition (same
// approach as tests/browser-geolocation.test.mjs).
import assert from 'node:assert/strict';
import { isAccuracyAcceptable, shouldSendPhonePing, buildPhoneGpsPing, MAX_ACCURACY_METERS } from '../shared/phone-gps.js';

// 1. Accuracy filter: discard readings worse than 50m, keep everything at or better than it.
assert.equal(isAccuracyAcceptable(8), true);
assert.equal(isAccuracyAcceptable(50), true, 'exactly at the threshold must still be acceptable');
assert.equal(isAccuracyAcceptable(51), false, 'just past the threshold must be discarded');
assert.equal(isAccuracyAcceptable(200), false);
assert.equal(isAccuracyAcceptable(undefined), false, 'a missing/invalid accuracy must not be treated as acceptable');
assert.equal(isAccuracyAcceptable(null), false);
assert.equal(isAccuracyAcceptable(NaN), false);
assert.equal(isAccuracyAcceptable(30, 20), false, 'a custom, stricter threshold must be honored');
assert.equal(MAX_ACCURACY_METERS, 50);

// 2. Throttle: no more than one ping every 4-5s, mirroring shouldSendPosition()'s behavior.
assert.equal(shouldSendPhonePing(0, 4499, 4500), false, 'must not send before the minimum interval elapses');
assert.equal(shouldSendPhonePing(0, 4500, 4500), true, 'must send exactly at the minimum interval');
assert.equal(shouldSendPhonePing(0, 9000, 4500), true, 'must send well after the minimum interval');
assert.equal(shouldSendPhonePing(1000, 1000, 4500), false, 'zero elapsed time must not send');
assert.equal(shouldSendPhonePing(0, 4999, 5000), false, 'a custom, wider interval must be honored');

// 3. Ping assembly: source/device_id fixed to this flow's identity, coords/timestamps carried
// through, null-prone browser fields default to 0 (same defensive posture as
// positionFromGeolocationEvent() in shared/browser-geolocation.js).
const geoPosition = { coords: { latitude: 19.6489, longitude: -71.0956, accuracy: 12, speed: 2.1, heading: 45 }, timestamp: Date.now() };
const ping = buildPhoneGpsPing(geoPosition, { vehicle_id: 'truck-01' });
assert.equal(ping.vehicle_id, 'truck-01');
assert.equal(ping.latitude, 19.6489);
assert.equal(ping.longitude, -71.0956);
assert.equal(ping.accuracy, 12);
assert.equal(ping.speed, 2.1);
assert.equal(ping.heading, 45);
assert.equal(ping.source, 'phone', 'fase 1 pings must be tagged source: phone, distinct from the existing browser_geolocation flow');
assert.equal(ping.device_id, 'phone-browser', 'default device_id when none is given');
assert.ok(ping.captured_at);
assert.ok(ping.received_at);

const sparseGeoPosition = { coords: { latitude: 19.65, longitude: -71.10, accuracy: null, speed: null, heading: null }, timestamp: Date.now() };
const sparsePing = buildPhoneGpsPing(sparseGeoPosition, { vehicle_id: 'truck-02' });
assert.equal(sparsePing.accuracy, 0);
assert.equal(sparsePing.speed, 0);
assert.equal(sparsePing.heading, 0);

const customDevicePing = buildPhoneGpsPing(geoPosition, { vehicle_id: 'truck-01', device_id: 'phone-abc123' });
assert.equal(customDevicePing.device_id, 'phone-abc123');

console.log('phone-gps ok');

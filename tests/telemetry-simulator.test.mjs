import assert from 'node:assert/strict';
import { DeviceSimulator, makeTelemetry, TELEMETRY_SOURCES, createDemoPositionHistory } from '../shared/telemetry-simulator.js';
assert(TELEMETRY_SOURCES.includes('dedicated_tracker'));
const simulator = new DeviceSimulator('truck-01');
const point = simulator.start();
assert.equal(point.vehicle_id, 'truck-01');
assert.equal(point.source, 'simulator');
simulator.setSpeed(0);
assert.equal(simulator.simulateStopped().speed, 0);
assert.equal(simulator.simulateSignalLoss(), null);
assert.equal(simulator.emit(), null);
assert.equal(simulator.simulateIncident('delay').type, 'delay');
assert(makeTelemetry({ vehicle_id:'v1', latitude:1, longitude:2 }).captured_at);

const history = createDemoPositionHistory();
assert.deepEqual(history.listPositions('truck-01'), []);
const older = { vehicle_id:'truck-01', captured_at:'2026-01-01T00:00:00.000Z', latitude:1, longitude:1 };
const newer = { vehicle_id:'truck-01', captured_at:'2026-01-01T00:01:00.000Z', latitude:2, longitude:2 };
history.record(newer);
history.record(older);
const sorted = history.listPositions('truck-01');
assert.equal(sorted.length, 2);
assert.equal(sorted[0], older, 'oldest point must come first, regardless of record() order');
assert.equal(sorted[1], newer);
assert.deepEqual(history.listPositions('truck-02'), [], 'positions must not leak across vehicles');

// docs/TECHNICAL_DEBT_REGISTER.md item 16: getPath, when given, must win over the routePaths/trucks
// fallback lookup, and must be called lazily on every emit() (not read once at construction) so a
// caller can supply geometry that isn't known yet when the simulator is built.
let callCount = 0;
const customPath = [[1, 1], [2, 2], [3, 3]];
const customSimulator = new DeviceSimulator('truck-01', { getPath: () => { callCount += 1; return customPath; } });
const firstPoint = customSimulator.start();
assert.deepEqual([firstPoint.latitude, firstPoint.longitude], customPath[0], 'must use getPath()\'s geometry, not routePaths');
customSimulator.emit();
assert.equal(callCount, 2, 'getPath() must be called again on each emit(), not cached from construction');

// Omitting getPath must behave exactly as before (routePaths/trucks fallback) — every existing
// caller that doesn't pass it must be unaffected.
const fallbackSimulator = new DeviceSimulator('truck-01');
assert.ok(fallbackSimulator.start().latitude, 'fallback lookup must still work without getPath');

console.log('telemetry-simulator ok');

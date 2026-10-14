import assert from 'node:assert/strict';
import {
  createDriverBackgroundBridge,
  DRIVER_TRACKING_NOTIFICATION,
  getOrCreateDriverDeviceId
} from '../shared/driver-app-background.js';

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const firstId = getOrCreateDriverDeviceId(storage, { randomUUID: () => 'stable-id' });
assert.equal(firstId, 'android-stable-id');
assert.equal(getOrCreateDriverDeviceId(storage, { randomUUID: () => 'different' }), firstId, 'device id must survive app restarts');

let options;
let callback;
let removed;
let releaseCapture;
const captureFinished = new Promise((resolve) => { releaseCapture = resolve; });
const plugin = {
  async addWatcher(nextOptions, nextCallback) { options = nextOptions; callback = nextCallback; return 'watch-1'; },
  async removeWatcher({ id }) { removed = id; }
};
const locations = [];
const bridge = createDriverBackgroundBridge({ plugin, onLocation: async (location) => { locations.push(location); await captureFinished; } });
assert.equal(bridge.active, false);
await bridge.start();
assert.equal(bridge.active, true);
assert.equal(options.backgroundMessage, DRIVER_TRACKING_NOTIFICATION);
assert.equal(options.backgroundMessage, 'SmartWaste está registrando tu recorrido');
assert.equal(options.distanceFilter, 0, 'session cadence must receive callbacks before applying 10s/25m filtering');
callback({ latitude: 19.6, longitude: -71.1, time: Date.now() });
const stopping = bridge.stop({ flush: true });
releaseCapture();
await stopping;
assert.equal(removed, 'watch-1');
assert.equal(bridge.active, false);
assert.equal(locations.length, 1);

console.log('driver-app-background ok');

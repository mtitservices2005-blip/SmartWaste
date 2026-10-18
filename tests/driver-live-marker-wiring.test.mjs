// SW-098: el punto del mapa usa el marcador visible y recibe la posición del GPS nativo (no solo la del WebView).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const driver = readFileSync('frontend/driver-app.js', 'utf8');
const app = readFileSync('frontend/app.js', 'utf8');
const css = readFileSync('frontend/styles/driver.css', 'utf8');
assert.match(driver, /createLiveMarker\(/);
assert.doesNotMatch(driver, /circleMarker\([^)]*fillOpacity: 1 \}\)\.addTo\(map\)/, 'sin el marcador blanco anterior');
assert.match(driver, /\[data-driver-recenter\]/);
assert.match(driver, /live\?\.recenter\(\)/);
assert.match(driver, /controller\.onPosition\s*=/);
assert.match(app, /driverController\s*=\s*await mountDriverApp\(/);
const onLoc = app.slice(app.indexOf('onLocation: async (location)'));
assert.ok(onLoc.indexOf('driverController?.setPosition?.(') > -1 && onLoc.indexOf('driverController?.setPosition?.(') < onLoc.indexOf('session.capture('), 'la posición se dibuja antes de guardar');
assert.match(css, /\.sw-driver__recenter\b/);
console.log('driver-live-marker-wiring ok');

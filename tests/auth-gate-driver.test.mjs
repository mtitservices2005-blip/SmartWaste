// SW-085 (CA5-CA8): el acceso del APK del conductor solo se activa con SMARTWASTE_DRIVER_APP; el acceso web
// del personal no cambia. La comprobación en el navegador real queda "pendiente de prueba en dispositivo".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDriverApp } from '../frontend/auth-gate.js';

assert.equal(isDriverApp({ SMARTWASTE_DRIVER_APP: true }), true);
assert.equal(isDriverApp({ SMARTWASTE_DRIVER_APP: 'true' }), false, 'solo el booleano true');
assert.equal(isDriverApp({}), false);
assert.equal(isDriverApp(undefined), false);

const src = readFileSync(new URL('../frontend/auth-gate.js', import.meta.url), 'utf8');
assert.match(src, /flowType: 'pkce'/, 'PKCE solo en el APK');
assert.match(src, /driverApp \? \{ auth: \{ flowType: 'pkce' \} \} : undefined/, 'el cliente del personal no cambia');
assert.match(src, /checkDriverAccess\(existing\)/, 'la sesión guardada también pasa por la regla de acceso');
assert.match(src, /checkDriverAccess\(resolved\)/, 'cada inicio de sesión pasa por la regla de acceso');
assert.match(src, /await client\.auth\.signOut\(\);\s*\n\s*initialError|showError\(access\.message\); await client\.auth\.signOut\(\)/, 'si no está registrado se cierra la sesión');
assert.match(src, /needsOwnPassword\(resolved\.user\)/, 'Google no pide contraseña temporal');
assert.ok(!/signUp\(/.test(src), 'el acceso nunca crea cuentas');
assert.match(src, /provider: 'google'/);
assert.match(src, /skipBrowserRedirect: true/);
assert.match(src, /exchangeCodeForSession/);
console.log('auth-gate-driver ok');

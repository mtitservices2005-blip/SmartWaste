// SW-087 (D3): la sesión del conductor se queda guardada. Solo una negativa real (correo no registrado) la cierra;
// un fallo de conexión al reabrir la app NUNCA cierra la sesión guardada.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { driverAuthOptions, isConnectivityError } from '../shared/session-restore.js';

assert.deepEqual(driverAuthOptions(), { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true } });

for (const e of [
  new TypeError('Failed to fetch'),
  Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' }),
  new Error('TypeError: Failed to fetch'),
  new Error('NetworkError when attempting to fetch resource.'),
  new Error('Load failed'),
  new Error('The request timed out'),
  Object.assign(new Error('bad gateway'), { status: 502 }),
  Object.assign(new Error('x'), { status: 0 })
]) assert.equal(isConnectivityError(e), true, String(e.message));
for (const e of [null, undefined, new Error('permission denied for table drivers'), Object.assign(new Error('JWT expired'), { status: 401 }), 'texto']) {
  assert.equal(isConnectivityError(e), false, String(e?.message ?? e));
}

const src = readFileSync(new URL('../frontend/auth-gate.js', import.meta.url), 'utf8');
assert.match(src, /driverAuthOptions\(\)/, 'el cliente del conductor usa las opciones de sesión guardada');
assert.match(src, /connectivity: isConnectivityError\(error\)/, 'checkDriverAccess distingue fallo de conexión');
assert.match(src, /if \(!access\.connectivity\) await client\.auth\.signOut\(\);/, 'sin conexión no se cierra la sesión guardada');
console.log('session-restore ok');

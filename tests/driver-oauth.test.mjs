// SW-085 (CA6, CA8): piezas puras del acceso con Google en el APK: leer el código de regreso, saber si la
// sesión actual entró con Google y decidir si hace falta cambiar la contraseña temporal.
import assert from 'node:assert/strict';
import { DRIVER_REDIRECT_URL, extractAuthCode, signedInWithGoogle, needsOwnPassword } from '../shared/driver-oauth.js';

assert.equal(DRIVER_REDIRECT_URL, 'com.mtitservices.smartwaste.driver://auth');

// Regreso por enlace profundo: PKCE trae ?code=..., un error trae error_description.
assert.deepEqual(extractAuthCode('com.mtitservices.smartwaste.driver://auth?code=abc123'), { code: 'abc123' });
assert.deepEqual(extractAuthCode('com.mtitservices.smartwaste.driver://auth/?code=abc123&state=x'), { code: 'abc123' });
assert.deepEqual(extractAuthCode('com.mtitservices.smartwaste.driver://auth?error=access_denied&error_description=Signups+not+allowed+for+this+instance'), { error: 'Signups not allowed for this instance' });
assert.deepEqual(extractAuthCode('com.mtitservices.smartwaste.driver://auth#error=server_error&error_description=Database+error'), { error: 'Database error' });
assert.equal(extractAuthCode('com.mtitservices.smartwaste.driver://auth'), null, 'sin código ni error: no es de Google');
assert.equal(extractAuthCode('https://otro.sitio/auth?code=abc'), null, 'solo el enlace de esta app');
assert.equal(extractAuthCode('com.otra.app://auth?code=abc'), null);
assert.equal(extractAuthCode(''), null);
assert.equal(extractAuthCode(null), null);
assert.equal(extractAuthCode('no es una url'), null);

const emailUser = { identities: [{ provider: 'email', last_sign_in_at: '2026-10-14T10:00:00Z' }], user_metadata: { requires_password_change: true } };
const googleUser = { identities: [{ provider: 'email', last_sign_in_at: '2026-10-13T10:00:00Z' }, { provider: 'google', last_sign_in_at: '2026-10-14T10:00:00Z' }], user_metadata: { requires_password_change: true } };
const googleThenEmail = { identities: [{ provider: 'google', last_sign_in_at: '2026-10-13T10:00:00Z' }, { provider: 'email', last_sign_in_at: '2026-10-14T10:00:00Z' }], user_metadata: { requires_password_change: true } };
assert.equal(signedInWithGoogle(googleUser), true);
assert.equal(signedInWithGoogle(emailUser), false);
assert.equal(signedInWithGoogle(googleThenEmail), false, 'si lo último fue correo y contraseña, no cuenta como Google');
assert.equal(signedInWithGoogle({}), false);
assert.equal(signedInWithGoogle(null), false);

// D5: con Google no se pide cambiar la contraseña temporal; con correo y contraseña sí.
assert.equal(needsOwnPassword(emailUser), true);
assert.equal(needsOwnPassword(googleUser), false);
assert.equal(needsOwnPassword(googleThenEmail), true);
assert.equal(needsOwnPassword({ identities: [{ provider: 'email' }], user_metadata: {} }), false, 'sin marcador no hace falta');
assert.equal(needsOwnPassword(null), false);
console.log('driver-oauth ok');

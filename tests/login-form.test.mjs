// SW-088: acceso web del personal. Validación y mensajes (lógica pura).
import assert from 'node:assert/strict';
import { validateLogin, loginErrorMessage, googleErrorMessage, FORGOT_MESSAGE, NO_ACCESS_MESSAGE } from '../shared/login-form.js';

assert.deepEqual(validateLogin({ email: ' ana@ejemplo.do ', password: 'abc' }), { ok: true, values: { email: 'ana@ejemplo.do', password: 'abc' } });
assert.equal(validateLogin({ email: '', password: 'x' }).message, 'Escribe tu correo.');
assert.equal(validateLogin({ email: 'sin-arroba', password: 'x' }).message, 'Escribe un correo válido.');
assert.equal(validateLogin({ email: 'a@b.do', password: '' }).message, 'Escribe tu contraseña.');
assert.equal(validateLogin().ok, false);

assert.equal(loginErrorMessage(new TypeError('Failed to fetch')), 'Sin conexión. Revisa tu internet e inténtalo de nuevo.');
assert.equal(loginErrorMessage({ name: 'AuthRetryableFetchError', message: 'x' }), 'Sin conexión. Revisa tu internet e inténtalo de nuevo.');
assert.equal(loginErrorMessage({ message: 'Invalid login credentials', status: 400 }), 'Correo o contraseña incorrectos.');
assert.equal(loginErrorMessage(null), 'Correo o contraseña incorrectos.');

assert.equal(FORGOT_MESSAGE, 'Si tu correo está registrado, recibirás un enlace para cambiar tu contraseña.');
assert.equal(NO_ACCESS_MESSAGE, 'Tu correo no tiene acceso. Pídele a tu administrador que te cree la cuenta.');
assert.equal(googleErrorMessage('Signups not allowed for this instance'), NO_ACCESS_MESSAGE);
assert.equal(googleErrorMessage('Database error saving new user'), NO_ACCESS_MESSAGE);
assert.equal(googleErrorMessage('access_denied'), 'No se pudo entrar con Google. Inténtalo de nuevo.');
assert.equal(googleErrorMessage(''), 'No se pudo entrar con Google. Inténtalo de nuevo.');
console.log('login-form ok');

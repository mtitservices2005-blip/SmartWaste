// SW-085 (CA7): quién puede usar la app del conductor tras iniciar sesión (con Google o con contraseña).
// Regla: solo un conductor ACTIVO del municipio, con ficha en `drivers` y correo igual (sin distinguir
// mayúsculas) al que registró la central. Cualquier otro caso se rechaza con un mensaje en español.
import assert from 'node:assert/strict';
import { decideDriverAccess, DRIVER_ACCESS_DENIED_MESSAGE } from '../shared/driver-access.js';

const base = {
  authEmail: 'carlos@ejemplo.do',
  role: 'driver',
  municipalityId: 'muni-1',
  driver: { email: 'carlos@ejemplo.do', status: 'available', municipality_id: 'muni-1', profile_id: 'u-1' },
  userId: 'u-1'
};

assert.deepEqual(decideDriverAccess(base), { allowed: true, reason: 'ok' }, 'correo registrado entra');
assert.equal(decideDriverAccess({ ...base, authEmail: 'Carlos@Ejemplo.DO' }).allowed, true, 'mayúsculas distintas entran');
assert.equal(decideDriverAccess({ ...base, authEmail: ' carlos@ejemplo.do ' }).allowed, true, 'espacios sobrantes se ignoran');
assert.equal(decideDriverAccess({ ...base, driver: { ...base.driver, status: 'assigned' } }).allowed, true, 'estado asignado entra');
assert.equal(decideDriverAccess({ ...base, driver: { ...base.driver, status: 'off_duty' } }).allowed, true, 'fuera de turno entra (ve su pantalla)');

const denied = (patch, reason) => {
  const r = decideDriverAccess({ ...base, ...patch });
  assert.equal(r.allowed, false, `debe rechazar: ${reason}`);
  assert.equal(r.reason, reason);
  assert.equal(r.message, DRIVER_ACCESS_DENIED_MESSAGE, 'mensaje único: no revela por qué');
};
denied({ driver: null }, 'sin-ficha');
denied({ driver: undefined }, 'sin-ficha');
denied({ authEmail: 'otro@ejemplo.do' }, 'correo-distinto');
denied({ authEmail: '' }, 'sin-correo');
denied({ authEmail: null }, 'sin-correo');
denied({ driver: { ...base.driver, email: null } }, 'correo-distinto');
denied({ role: 'dispatcher' }, 'rol');
denied({ role: 'municipal_admin' }, 'rol');
denied({ role: null }, 'rol');
denied({ municipalityId: 'muni-2' }, 'municipio');
denied({ driver: { ...base.driver, municipality_id: 'muni-2' } }, 'municipio');
denied({ driver: { ...base.driver, status: 'suspended' } }, 'inactivo');
denied({ userId: 'u-999' }, 'ficha-de-otro');

// Si la ficha aún no está enlazada a un perfil (profile_id vacío), el correo manda.
assert.equal(decideDriverAccess({ ...base, driver: { ...base.driver, profile_id: null } }).allowed, true);

assert.match(DRIVER_ACCESS_DENIED_MESSAGE, /no está registrado/);
assert.match(DRIVER_ACCESS_DENIED_MESSAGE, /central/);
console.log('driver-access ok');

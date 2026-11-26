// SW-133: prueba estática del acceso sin red en auth-gate.js (no carga sin navegador).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../frontend/auth-gate.js', import.meta.url), 'utf8');

assert.match(src, /import \{[^}]*createDriverAccessStore[^}]*decideOfflineAccess[^}]*\} from '\.\.\/shared\/driver-offline-access\.js'/);
assert.match(src, /accessStore = driverApp \? createDriverAccessStore\(/, 'el registro solo existe en el APK del conductor');
assert.match(src, /SIGNED_OUT[\s\S]{0,80}accessStore\.clear\(\)/, 'cerrar sesión (o sesión revocada) borra el acceso guardado');
assert.match(src, /lastResolveConnectivity = isConnectivityError\(/, 'distingue falta de red de un rechazo real');
// Codex P2: resolveContext pierde el estado HTTP (503); se revisa primero el resultado directo de getUser
const resolver = src.slice(src.indexOf('async function resolveAuthenticatedUser'), src.indexOf('async function tryOfflineAccess'));
assert.match(resolver, /Promise\.allSettled\(/, 'una falla de contexto no tapa el error original de getUser');
assert.ok(resolver.indexOf('userResult.error') < resolver.indexOf("ctxResult.status === 'rejected'"), 'primero el error directo de la autenticación');
const gate = src.slice(src.indexOf('async function tryOfflineAccess'), src.indexOf('async function tryOfflineAccess') + 900);
assert.match(gate, /if \(!driverApp \|\| !accessStore\) return null/, 'jamás para el personal/web');
assert.match(gate, /decideOfflineAccess\(/);
assert.match(gate, /identity\.createContext\(/);
assert.match(src, /const offlineCtx = await tryOfflineAccess\(\)/, 'se usa al arrancar');
assert.match(src, /if \(offlineCtx\) return offlineCtx/);
// el registro se guarda solo cuando el acceso ya fue concedido (con internet), después del cambio de contraseña
const grant = src.slice(src.indexOf('function grantApplicationAccess'), src.indexOf('function grantApplicationAccess') + 500);
assert.match(grant, /accessStore\?\.save\(\{ user, ctx \}\)/);
assert.ok(!/signUp\(/.test(src), 'nunca crea cuentas');
console.log('driver-offline-access-wiring: ok');

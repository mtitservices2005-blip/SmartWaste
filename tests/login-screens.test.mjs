// SW-088: pantalla de acceso web del diseño Mando. HTML puro; sin registro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStaffLogin } from '../frontend/components/login-screens.js';

const html = renderStaffLogin({ demo: true, googleEnabled: true, errorMessage: 'Error <b>x</b>' });
assert.match(html, /Cada camión, cada ruta, en un solo mapa\./);
assert.match(html, /Gestión de residuos para Laguna Salada\./);
assert.match(html, /<h1[^>]*>Bienvenido de nuevo<\/h1>/);
assert.match(html, /Entra para ver tus rutas y camiones\./);
assert.match(html, /data-staff-google[^>]*>[\s\S]*Continuar con Google/);
assert.match(html, /o con tu correo/);
assert.match(html, /<form id="authForm"/);
assert.match(html, /name="email"[^>]*type="email"|type="email"[^>]*name="email"/);
assert.match(html, /name="password"/);
assert.match(html, /data-staff-forgot>¿Olvidaste tu contraseña\?</);
assert.match(html, /<button type="submit"[^>]*>Entrar<\/button>/);
assert.match(html, /Con Google no guardamos tu contraseña\. Solo recibimos tu nombre y tu correo\./);
assert.match(html, /¿No tienes acceso\? Pídele a tu administrador que te cree la cuenta\./);
assert.match(html, /Datos demo · no producción/);
assert.match(html, /id="skipToPublic"/);
assert.ok(html.includes('Error &lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'), 'escapa el error');
assert.match(html, /id="authError"[^>]*role="alert"/);
assert.doesNotMatch(html, /Crear cuenta|Regístrate|Registrarte/i, 'no hay registro (D1, opción A)');

const noGoogle = renderStaffLogin({ googleEnabled: false });
assert.doesNotMatch(noGoogle, /data-staff-google/);
assert.doesNotMatch(noGoogle, /o con tu correo/);
assert.doesNotMatch(noGoogle, /Con Google no guardamos/);
const real = renderStaffLogin({ demo: false, googleEnabled: true });
assert.doesNotMatch(real, /Datos demo/);
assert.doesNotMatch(real, /Datos de ejemplo/i, 'en despliegue real no se dice "datos de ejemplo"');

const src = readFileSync(new URL('../frontend/auth-gate.js', import.meta.url), 'utf8');
assert.ok(!/signUp\(/.test(src), 'ningún camino crea cuentas');
assert.match(src, /renderStaffLogin\(/);
assert.match(src, /data-staff-google/);
assert.match(src, /data-staff-forgot/);
assert.match(src, /googleLogin/);
assert.ok(!/persistSession: false/.test(src), 'la sesión del personal se guarda');
console.log('login-screens ok');

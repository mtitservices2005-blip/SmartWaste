// SW-088: acceso web del personal. Validación y mensajes en español neutro ("tú"). Lógica pura, sin red.
import { isConnectivityError } from './session-restore.js';

export const FORGOT_MESSAGE = 'Si tu correo está registrado, recibirás un enlace para cambiar tu contraseña.';
export const NO_ACCESS_MESSAGE = 'Tu correo no tiene acceso. Pídele a tu administrador que te cree la cuenta.';

export function validateLogin({ email, password } = {}) {
  const mail = String(email ?? '').trim();
  const pass = String(password ?? '');
  if (!mail) return { ok: false, message: 'Escribe tu correo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, message: 'Escribe un correo válido.' };
  if (!pass) return { ok: false, message: 'Escribe tu contraseña.' };
  return { ok: true, values: { email: mail, password: pass } };
}

export function loginErrorMessage(error) {
  return isConnectivityError(error) ? 'Sin conexión. Revisa tu internet e inténtalo de nuevo.' : 'Correo o contraseña incorrectos.';
}

// Google solo entra a cuentas que ya existen: si el servidor rechaza crear el usuario, es "sin acceso".
export function googleErrorMessage(raw) {
  return /sign.?ups?|not allowed|database error/i.test(String(raw ?? '')) ? NO_ACCESS_MESSAGE : 'No se pudo entrar con Google. Inténtalo de nuevo.';
}

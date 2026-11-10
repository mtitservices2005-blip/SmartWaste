// SW-120: alta de un ayuntamiento nuevo desde Master Admin. Llama a la función create-municipality-account (crea el
// ayuntamiento, la cuenta de su administrador con contraseña temporal y la licencia de prueba) y traduce sus errores.
// Módulo puro: el cliente de Supabase llega por parámetro.
export const DEFAULT_TRIAL_TRUCKS = 5;
export const DEFAULT_TRIAL_DAYS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewMunicipality({ name = '', email = '', trucks = DEFAULT_TRIAL_TRUCKS } = {}) {
  const errors = [];
  const cleanName = String(name).replace(/\s+/g, ' ').trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const n = Number(trucks);
  if (cleanName.length < 3) errors.push('Escribe el nombre del ayuntamiento.');
  if (cleanName.length > 120) errors.push('El nombre es demasiado largo (máximo 120 letras).');
  if (!EMAIL_RE.test(cleanEmail)) errors.push('El correo del administrador no parece válido.');
  if (!Number.isInteger(n) || n < 1 || n > 50) errors.push('Los camiones de la prueba deben ser un número entre 1 y 50.');
  return { valid: errors.length === 0, errors, value: { name: cleanName, email: cleanEmail, trucks: n } };
}

export function onboardingErrorMessage(message) {
  const m = String(message ?? '').toLowerCase();
  if (/already (been )?registered|already exists|duplicate/.test(m)) return 'Ese correo ya tiene una cuenta. Usa otro correo para el administrador.';
  if (/not authorized|forbidden|403/.test(m)) return 'Solo Master Admin puede dar de alta ayuntamientos.';
  if (/invalid or expired|missing authorization|401/.test(m)) return 'Tu sesión venció. Entra de nuevo e inténtalo otra vez.';
  if (/license|municipality_licenses/.test(m)) return 'No se pudo crear la licencia de prueba. No se creó nada; inténtalo de nuevo.';
  if (/non-2xx|failed to send|fetch|network/.test(m)) return 'No se pudo contactar el servicio de altas. Revisa la conexión e inténtalo de nuevo.';
  return null;
}

async function errorText(error) {
  try { const body = await error.context?.json?.(); if (body?.error) return String(body.error); } catch { /* sin cuerpo */ }
  return error?.message ?? '';
}

export async function createMunicipalityAccount(client, input) {
  if (!client?.functions?.invoke) return { ok: false, message: 'No hay sesión de Supabase activa.' };
  const check = validateNewMunicipality(input);
  if (!check.valid) return { ok: false, message: check.errors.join(' ') };
  const { name, email, trucks } = check.value;
  const { data, error } = await client.functions.invoke('create-municipality-account', { body: { municipality_name: name, admin_email: email, trucks, trial_days: DEFAULT_TRIAL_DAYS } });
  if (error) { const raw = await errorText(error); return { ok: false, message: onboardingErrorMessage(raw) ?? `No se pudo crear el ayuntamiento: ${raw || 'error desconocido'}` }; }
  if (!data?.ok || !data.municipality?.id) return { ok: false, message: 'El servicio respondió sin crear el ayuntamiento. Revisa la lista antes de reintentar.' };
  return { ok: true, municipalityId: data.municipality.id, name: data.municipality.name ?? name, email, temporaryPassword: data.temporary_password ?? '', validUntil: data.license?.valid_until ?? '', trucks: data.license?.contracted_trucks ?? trucks };
}

// Texto listo para pegar en un mensaje al administrador del ayuntamiento.
export function credentialsMessage({ name, email, temporaryPassword, appUrl = '' } = {}) {
  return [`Acceso a SmartWaste · ${name}`, appUrl ? `Entrada: ${appUrl}` : '', `Correo: ${email}`, `Contraseña temporal: ${temporaryPassword}`, 'Al entrar por primera vez el sistema te pedirá crear tu propia contraseña.'].filter(Boolean).join('\n');
}

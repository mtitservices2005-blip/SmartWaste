// SW-085: decisión pura de acceso a la app del conductor. Se ejecuta después de cualquier inicio de sesión
// (Google o correo y contraseña). Es una de las capas de "solo choferes registrados": si devuelve
// allowed=false la app cierra la sesión. Las reglas de seguridad (RLS) de la base siguen siendo la última capa.
export const DRIVER_ACCESS_DENIED_MESSAGE = 'Tu correo no está registrado. Pídele a la central que lo registre.';

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

export function decideDriverAccess({ authEmail, role, municipalityId, driver, userId } = {}) {
  const deny = (reason) => ({ allowed: false, reason, message: DRIVER_ACCESS_DENIED_MESSAGE });
  const email = normalizeEmail(authEmail);
  if (!email) return deny('sin-correo');
  if (role !== 'driver') return deny('rol');
  if (!driver) return deny('sin-ficha');
  if (!municipalityId || driver.municipality_id !== municipalityId) return deny('municipio');
  if (driver.status === 'suspended') return deny('inactivo');
  if (normalizeEmail(driver.email) !== email) return deny('correo-distinto');
  if (driver.profile_id && userId && driver.profile_id !== userId) return deny('ficha-de-otro');
  return { allowed: true, reason: 'ok' };
}

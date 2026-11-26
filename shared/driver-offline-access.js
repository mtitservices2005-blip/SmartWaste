// SW-133: acceso del conductor sin internet. Al entrar con internet se guarda en el teléfono QUIÉN entró (usuario,
// correo, rol y municipio; nunca contraseña ni tokens). Sin señal, la app del conductor se reabre con ese registro
// mientras sea reciente. No es un login local: no compara contraseñas. La sesión de Supabase (que ya vive en el
// teléfono) se renueva sola al volver la señal, y el servidor (RLS) sigue decidiendo todo lo que se envía.
export const OFFLINE_ACCESS_MAX_DAYS = 7;
const DAY_MS = 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export function createDriverAccessStore({ storage, key = 'smartwaste.driver-access.v1', now = () => new Date() } = {}) {
  return {
    // Solo se guarda un conductor con contexto de su propio usuario. Devuelve si se guardó.
    async save({ user, ctx } = {}) {
      if (!user?.id || ctx?.role !== 'driver' || ctx?.user_id !== user.id || !ctx?.municipality_id) return false;
      try {
        await storage.setItem(key, JSON.stringify({ userId: user.id, email: String(user.email ?? '').trim().toLowerCase(), role: 'driver', municipalityId: ctx.municipality_id, verifiedAt: now().toISOString() }));
        return true;
      } catch { return false; }
    },
    async load() {
      try {
        const raw = await storage.getItem(key);
        if (!raw) return null;
        const rec = JSON.parse(raw);
        return rec && typeof rec === 'object' ? rec : null;
      } catch { return null; }
    },
    async clear() {
      try { if (storage.removeItem) await storage.removeItem(key); else await storage.setItem(key, ''); } catch { /* nada que borrar */ }
    }
  };
}

// ¿Se puede abrir la app del conductor sin red con este registro?
export function decideOfflineAccess({ stored, now = new Date(), maxDays = OFFLINE_ACCESS_MAX_DAYS } = {}) {
  const deny = (reason) => ({ allowed: false, reason });
  if (!stored) return deny('sin-registro');
  if (stored.role !== 'driver') return deny('rol');
  if (!stored.userId || !stored.municipalityId) return deny('registro-incompleto');
  const verified = Date.parse(stored.verifiedAt);
  if (!Number.isFinite(verified) || verified > now.getTime() + CLOCK_SKEW_MS) return deny('fecha');
  if (now.getTime() - verified > maxDays * DAY_MS) return deny('vencido');
  return { allowed: true, reason: 'ok', ctx: { user_id: stored.userId, role: 'driver', municipality_id: stored.municipalityId }, email: stored.email ?? '' };
}

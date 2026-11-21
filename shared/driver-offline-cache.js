// SW-095: copia local de "Hoy" (rutas, paradas, camión) para abrir la app sin internet. Un solo registro por
// teléfono, atado al usuario: otra cuenta nunca ve la copia de la anterior. Contrato de almacenamiento
// getItem/setItem/removeItem (puede ser asíncrono); cualquier fallo del almacenamiento se ignora.
export function createDriverCache({ storage, key = 'smartwaste.driver-cache.v1', now = () => new Date() } = {}) {
  return {
    async save(userId, snapshot) {
      try { await storage.setItem(key, JSON.stringify({ userId, savedAt: now().toISOString(), snapshot })); } catch { /* almacenamiento lleno o no disponible */ }
    },
    async load(userId) {
      try {
        const raw = await storage.getItem(key);
        if (!raw) return null;
        const rec = JSON.parse(raw);
        if (!rec || rec.userId !== userId || !rec.snapshot || typeof rec.snapshot !== 'object') return null;
        return { snapshot: rec.snapshot, savedAt: rec.savedAt ?? null };
      } catch { return null; }
    },
    async clear() {
      try { if (storage.removeItem) await storage.removeItem(key); else await storage.setItem(key, ''); } catch { /* nada que limpiar */ }
    }
  };
}

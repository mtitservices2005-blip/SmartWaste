// SW-108: aviso de nueva versión de la app del conductor (distribución directa del APK, fuera de Play Store).
// Lógica pura: no toca el DOM; la red y la versión instalada llegan por parámetro para poder probarla.
// El archivo publicado (downloads/version.json) lo escribe scripts/publish-apk.mjs.
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_APK_NAME = 'SmartWaste-Conductor.apk';

const isPosInt = (n) => Number.isInteger(n) && n > 0;

// Valida el version.json. Devuelve { ok: true, manifest } o { ok: false, reason }; nunca lanza.
export function parseManifest(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'no es un objeto' };
  const versionCode = Number(raw.versionCode);
  if (!isPosInt(versionCode)) return { ok: false, reason: 'versionCode inválido' };
  const versionName = typeof raw.versionName === 'string' ? raw.versionName.trim() : '';
  if (!versionName) return { ok: false, reason: 'versionName vacío' };
  const apkUrl = typeof raw.apkUrl === 'string' && raw.apkUrl.trim() ? raw.apkUrl.trim() : DEFAULT_APK_NAME;
  const sha256 = typeof raw.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(raw.sha256.trim()) ? raw.sha256.trim().toLowerCase() : null;
  const sizeBytes = isPosInt(Number(raw.sizeBytes)) ? Number(raw.sizeBytes) : null;
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 200) : '';
  const publishedAt = typeof raw.publishedAt === 'string' && !Number.isNaN(Date.parse(raw.publishedAt)) ? raw.publishedAt : null;
  return { ok: true, manifest: { versionCode, versionName, apkUrl, sha256, sizeBytes, notes, publishedAt } };
}

export function isNewerBuild(currentBuild, latestBuild) {
  const cur = Number(currentBuild); const lat = Number(latestBuild);
  return Number.isFinite(cur) && Number.isFinite(lat) && lat > cur;
}

// La URL del APK se resuelve contra la del manifiesto y debe ser https (el APK se instala en un teléfono).
export function resolveApkUrl(manifest, manifestUrl) {
  try {
    const url = new URL(manifest.apkUrl, manifestUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function createUpdateChecker({ manifestUrl = '', fetchImpl, getCurrentBuild, now = () => Date.now(), intervalMs = UPDATE_CHECK_INTERVAL_MS, timeoutMs = 8000 } = {}) {
  let lastCheckedAt = null; let lastResult = null; const dismissed = new Set();

  const visible = (r) => (r && !dismissed.has(r.versionCode) ? r : null);

  async function fetchManifest() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const sep = manifestUrl.includes('?') ? '&' : '?';
      const res = await fetchImpl(`${manifestUrl}${sep}t=${now()}`, { cache: 'no-store', signal: controller?.signal });
      if (!res?.ok) return null;
      return await res.json();
    } finally { if (timer) clearTimeout(timer); }
  }

  return {
    // Devuelve { versionCode, versionName, notes, apkUrl } si hay una versión mayor que la instalada; si no, null.
    // Cualquier fallo (sin internet, JSON roto, plugin ausente) devuelve null en silencio: el aviso es opcional.
    async check({ force = false } = {}) {
      if (!manifestUrl || !/^https:\/\//i.test(manifestUrl) || typeof fetchImpl !== 'function') return null;
      if (!force && lastCheckedAt != null && now() - lastCheckedAt < intervalMs) return visible(lastResult);
      try {
        const current = Number(await getCurrentBuild());
        if (!Number.isFinite(current)) return null;
        const parsed = parseManifest(await fetchManifest());
        if (!parsed.ok) return null;
        const apkUrl = resolveApkUrl(parsed.manifest, manifestUrl);
        lastCheckedAt = now();
        lastResult = apkUrl && isNewerBuild(current, parsed.manifest.versionCode)
          ? { versionCode: parsed.manifest.versionCode, versionName: parsed.manifest.versionName, notes: parsed.manifest.notes, apkUrl }
          : null;
        return visible(lastResult);
      } catch { return null; }
    },
    // "Después": oculta ese versionCode hasta la siguiente apertura de la app (solo en memoria).
    dismiss(versionCode) { dismissed.add(Number(versionCode)); }
  };
}

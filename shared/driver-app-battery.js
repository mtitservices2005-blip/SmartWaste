// SW-083: lectura de batería del teléfono. Usa la API estándar del WebView de Android
// (navigator.getBattery), sin plugin nativo. Si no existe o falla, devuelve null: nunca bloquea el GPS.
export async function readBatteryPct(nav = globalThis.navigator) {
  try {
    if (typeof nav?.getBattery !== 'function') return null;
    const battery = await nav.getBattery();
    const level = Number(battery?.level);
    return Number.isFinite(level) ? level : null;
  } catch {
    return null;
  }
}

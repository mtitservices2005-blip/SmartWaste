export const DRIVER_TRACKING_NOTIFICATION = 'SmartWaste está registrando tu recorrido';
export const DRIVER_DEVICE_ID_KEY = 'smartwaste.driver-device-id.v1';

export function getOrCreateDriverDeviceId(storage, { randomUUID = () => globalThis.crypto.randomUUID() } = {}) {
  const existing = storage?.getItem?.(DRIVER_DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = `android-${randomUUID()}`;
  storage?.setItem?.(DRIVER_DEVICE_ID_KEY, deviceId);
  return deviceId;
}

// Thin, dependency-injected wrapper around @capacitor-community/background-geolocation. Keeping
// lifecycle and callback draining here makes the native boundary testable without Android.
export function createDriverBackgroundBridge({ plugin, onLocation, onError } = {}) {
  let watcherId = null;
  let starting = null;
  const pending = new Set();

  const runCallback = (location, error) => {
    const callback = error ? onError?.(error) : onLocation?.(location);
    if (!callback?.then) return;
    pending.add(callback);
    callback.then(() => pending.delete(callback), () => pending.delete(callback));
  };

  return {
    get active() { return watcherId !== null || starting !== null; },
    async start() {
      if (watcherId !== null) return watcherId;
      if (starting) return starting;
      if (!plugin?.addWatcher) throw new Error('El GPS en segundo plano no está disponible en esta instalación.');
      starting = plugin.addWatcher({
        backgroundMessage: DRIVER_TRACKING_NOTIFICATION,
        backgroundTitle: 'SmartWaste Conductor',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0
      }, runCallback);
      try {
        watcherId = await starting;
        return watcherId;
      } finally {
        starting = null;
      }
    },
    async stop({ flush = false } = {}) {
      if (starting) await starting;
      const id = watcherId;
      watcherId = null;
      if (id !== null) await plugin?.removeWatcher?.({ id });
      if (flush && pending.size) await Promise.allSettled([...pending]);
    }
  };
}

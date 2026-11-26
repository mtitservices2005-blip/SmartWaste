// SW-095: ¿el fallo es de red (hay que usar la copia / encolar) o un rechazo real del servidor (se muestra)?
// Un error de reglas, permisos o transición NUNCA se toma como "sin red" para no esconder un problema real.
const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|econn|enotfound|offline|sin conexi/i;

export function isNetworkFailure(result, { online = true } = {}) {
  if (!result || result.ok !== false) return false;
  if (online === false) return true;
  const message = result.error?.message ?? result.message ?? '';
  return NETWORK_RE.test(String(message));
}

// El GPS pide la asignación al arrancar; sin red usa la guardada (de la corrida abierta en la app).
export function createOfflineAssignmentAdapter(adapter, { getCached = () => null, isOnline = () => true } = {}) {
  return {
    ...adapter,
    async findOwnVehicleAssignment(profileId, opts) {
      const result = await adapter.findOwnVehicleAssignment(profileId, opts);
      if (isNetworkFailure(result, { online: isOnline() })) {
        const cached = getCached();
        if (cached) return { ok: true, source: 'OFFLINE_CACHE', data: cached };
      }
      return result;
    }
  };
}

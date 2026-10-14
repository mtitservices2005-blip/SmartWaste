// SW-083: texto del estado de conexión de la app del chofer.
export function connectionStatusText({ online, pending = 0 }) {
  const n = Math.max(0, Math.floor(Number(pending) || 0));
  const unit = n === 1 ? 'posición' : 'posiciones';
  if (online) return n === 0 ? 'Conectado · todo enviado' : `Conectado · enviando ${n} ${unit}…`;
  if (n === 0) return 'Sin conexión · se guardará todo y se enviará al reconectar';
  return `Sin conexión · ${n} ${n === 1 ? 'posición guardada, se enviará' : 'posiciones guardadas, se enviarán'} al reconectar`;
}

// SW-084: preferencia de este navegador para mostrar u ocultar las etiquetas del mapa (número de
// camión y texto de las situaciones). Lógica pura: el almacenamiento y el documento se reciben.
export const MAP_LABELS_KEY = 'smartwaste-map-labels';

export function readMapLabels(storage) {
  try { return storage?.getItem(MAP_LABELS_KEY) !== '0'; } catch { return true; }
}

export function saveMapLabels(storage, visible) {
  try { storage.setItem(MAP_LABELS_KEY, visible ? '1' : '0'); return true; } catch { return false; }
}

export function applyMapLabels(doc, visible) {
  doc.body.classList.toggle('sw-hide-map-labels', !visible);
}

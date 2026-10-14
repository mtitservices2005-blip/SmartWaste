// SW-084: tema oscuro/claro de la plataforma. Lógica pura: el documento, el almacenamiento y matchMedia
// se reciben como argumentos para poder probarla sin navegador. Si el almacenamiento falla (modo privado,
// bloqueado) la plataforma funciona igual, solo que no recuerda la elección.
export const THEMES = ['oscuro', 'claro'];
export const THEME_KEY = 'smartwaste-theme';

export function resolveTheme({ stored, prefersDark } = {}) {
  if (THEMES.includes(stored)) return stored;
  return prefersDark ? 'oscuro' : 'claro';
}

export function nextTheme(current) {
  return current === 'oscuro' ? 'claro' : 'oscuro';
}

export function readStoredTheme(storage) {
  try {
    const value = storage?.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveTheme(storage, theme) {
  if (!THEMES.includes(theme)) return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(doc, theme) {
  if (!THEMES.includes(theme)) throw new Error(`tema desconocido "${theme}"`);
  doc.documentElement.dataset.theme = theme;
}

export function initTheme({ document: doc, storage, matchMedia } = {}) {
  let prefersDark = false;
  try { prefersDark = Boolean(matchMedia?.('(prefers-color-scheme: dark)')?.matches); } catch { /* sin preferencia */ }
  let current = resolveTheme({ stored: readStoredTheme(storage), prefersDark });
  applyTheme(doc, current);
  return {
    current: () => current,
    toggle() {
      current = nextTheme(current);
      applyTheme(doc, current);
      saveTheme(storage, current);
      return current;
    }
  };
}

// Se pega tal cual en <head> de index.html, antes de los estilos, para fijar el tema antes de pintar.
export const EARLY_THEME_SCRIPT = `try{var s=null;try{s=window.localStorage.getItem('${THEME_KEY}')}catch(e){}var d=false;try{d=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}document.documentElement.dataset.theme=(s==='oscuro'||s==='claro')?s:(d?'oscuro':'claro')}catch(e){}`;

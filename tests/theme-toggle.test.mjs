// SW-084 (CA2): selector de tema. Lógica pura y probada con almacenamiento falso; nunca depende de localStorage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_KEY, resolveTheme, nextTheme, readStoredTheme, saveTheme, applyTheme, initTheme, EARLY_THEME_SCRIPT } from '../frontend/theme.js';

assert.deepEqual(THEMES, ['oscuro', 'claro']);

// resolveTheme: la elección guardada manda; si no hay, se sigue al sistema (D4).
assert.equal(resolveTheme({ stored: 'claro', prefersDark: true }), 'claro');
assert.equal(resolveTheme({ stored: 'oscuro', prefersDark: false }), 'oscuro');
assert.equal(resolveTheme({ stored: null, prefersDark: true }), 'oscuro');
assert.equal(resolveTheme({ stored: null, prefersDark: false }), 'claro');
assert.equal(resolveTheme({ stored: 'violeta', prefersDark: true }), 'oscuro', 'un valor guardado inválido se ignora');
assert.equal(resolveTheme({}), 'claro');

assert.equal(nextTheme('oscuro'), 'claro');
assert.equal(nextTheme('claro'), 'oscuro');
assert.equal(nextTheme('otro'), 'oscuro');

// Almacenamiento: lectura/escritura seguras aunque el acceso lance error (modo privado, bloqueado).
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
{
  const s = mem();
  assert.equal(readStoredTheme(s), null);
  assert.equal(saveTheme(s, 'claro'), true);
  assert.equal(s.getItem(THEME_KEY), 'claro');
  assert.equal(readStoredTheme(s), 'claro');
  assert.equal(saveTheme(s, 'violeta'), false, 'no guarda temas inválidos');
  assert.equal(s.getItem(THEME_KEY), 'claro');
}
assert.equal(readStoredTheme(broken), null);
assert.equal(saveTheme(broken, 'claro'), false);
assert.equal(readStoredTheme(undefined), null);

// applyTheme pone el atributo y el meta theme-color si existe.
{
  const doc = { documentElement: { dataset: {} } };
  applyTheme(doc, 'oscuro');
  assert.equal(doc.documentElement.dataset.theme, 'oscuro');
  assert.throws(() => applyTheme(doc, 'violeta'), /tema/);
}

// initTheme: resuelve, aplica y devuelve un alternador que guarda.
{
  const doc = { documentElement: { dataset: {} } };
  const storage = mem();
  const api = initTheme({ document: doc, storage, matchMedia: () => ({ matches: true }) });
  assert.equal(doc.documentElement.dataset.theme, 'oscuro', 'sin elección guardada sigue al sistema');
  assert.equal(api.current(), 'oscuro');
  assert.equal(api.toggle(), 'claro');
  assert.equal(doc.documentElement.dataset.theme, 'claro');
  assert.equal(storage.getItem(THEME_KEY), 'claro', 'la elección se recuerda');
  const doc2 = { documentElement: { dataset: {} } };
  initTheme({ document: doc2, storage, matchMedia: () => ({ matches: true }) });
  assert.equal(doc2.documentElement.dataset.theme, 'claro', 'la elección guardada gana al sistema');
}
{
  const doc = { documentElement: { dataset: {} } };
  const api = initTheme({ document: doc, storage: broken, matchMedia: undefined });
  assert.equal(doc.documentElement.dataset.theme, 'claro', 'sin matchMedia ni almacenamiento: claro');
  assert.equal(api.toggle(), 'oscuro', 'alterna aunque no pueda guardar');
}

// Script temprano (evita el parpadeo): corre en <head> antes de los estilos, con la misma clave y la misma regla.
{
  const run = (stored, dark) => {
    const doc = { documentElement: { dataset: {} } };
    const win = { localStorage: { getItem: () => stored }, matchMedia: () => ({ matches: dark }) };
    new Function('document', 'window', EARLY_THEME_SCRIPT)(doc, win);
    return doc.documentElement.dataset.theme;
  };
  assert.equal(run('claro', true), 'claro');
  assert.equal(run(null, true), 'oscuro');
  assert.equal(run(null, false), 'claro');
  const throwing = new Function('document', 'window', EARLY_THEME_SCRIPT);
  assert.doesNotThrow(() => throwing({ documentElement: { dataset: {} } }, { get localStorage() { throw new Error('x'); }, matchMedia: () => ({ matches: false }) }));
}
const html = readFileSync('frontend/index.html', 'utf8');
const early = html.indexOf('data-sw-theme-early');
const firstCss = html.indexOf('<link rel="stylesheet"');
assert.ok(early > -1, 'index.html incluye el script temprano de tema');
assert.ok(early < firstCss, 'el script de tema va antes de los estilos');
assert.ok(html.includes(EARLY_THEME_SCRIPT), 'el script de index.html es exactamente EARLY_THEME_SCRIPT');
assert.ok(html.includes('styles/theme-mando.css'), 'index.html carga los temas');
assert.ok(html.indexOf('styles/theme-mando.css') > html.indexOf('styles/tokens.css'), 'los temas van después de los tokens base');

console.log('theme-toggle ok');

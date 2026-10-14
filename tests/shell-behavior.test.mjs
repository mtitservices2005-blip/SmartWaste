// SW-084 (CA2, CA3): comportamiento del riel (menú "Más", cambio de tema, elemento activo) con un DOM falso mínimo.
import assert from 'node:assert/strict';
import { mountShell } from '../frontend/shell.js';

function makeEnv({ hash = '#operaciones/mapa', stored = null, dark = false } = {}) {
  const attrs = (init = {}) => { const m = { ...init }; return { getAttribute: (k) => (k in m ? m[k] : null), setAttribute: (k, v) => { m[k] = String(v); }, removeAttribute: (k) => { delete m[k]; }, _m: m }; };
  const els = {};
  const mk = (id, init) => { els[id] = { id, ...attrs(init), hidden: init?.hidden === '' , matches: (sel) => sel === `#${id}`, closest(sel) { return sel.split(',').map((s) => s.trim()).includes(`#${id}`) ? this : null; } }; return els[id]; };
  const host = { outerHTML: '<header id="swRail"></header>' };
  const listeners = { document: {}, window: {} };
  const links = [{ href: '#operaciones/mapa' }, { href: '#impacto' }].map((l) => { const a = attrs({ href: l.href, 'aria-current': l.href === '#operaciones/mapa' ? 'page' : undefined }); if (l.href !== '#operaciones/mapa') delete a._m['aria-current']; return a; });
  const doc = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === 'swRail') return host;
      if (id === 'swMoreBtn') return els.swMoreBtn ?? mk('swMoreBtn', { 'aria-expanded': 'false' });
      if (id === 'swMore') return els.swMore ?? mk('swMore', { hidden: '' });
      return null;
    },
    querySelectorAll: (sel) => (sel.startsWith('#swRail a[href^="#"]') ? links : []),
    addEventListener: (type, fn) => { (listeners.document[type] ??= []).push(fn); }
  };
  const win = { location: { hash }, matchMedia: () => ({ matches: dark }), addEventListener: (type, fn) => { (listeners.window[type] ??= []).push(fn); } };
  const store = new Map(stored ? [['smartwaste-theme', stored]] : []);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const click = (target) => listeners.document.click.forEach((fn) => fn({ target }));
  const target = (id) => (id ? { closest: (sel) => (sel.split(',').map((s) => s.trim()).some((s) => s === `#${id}` || (s.startsWith('.') && id.startsWith('link:'))) ? { id } : null) } : { closest: () => null });
  return { doc, win, storage, host, els, listeners, links, click, target };
}

{
  const env = makeEnv({ dark: true });
  let themeChanges = [];
  const api = mountShell({ document: env.doc, window: env.win, storage: env.storage, hideDemo: false, onThemeChange: (t) => themeChanges.push(t) });
  assert.match(env.host.outerHTML, /^<header class="topbar sw-rail" id="swRail">/, 'rellena el riel');
  assert.equal(env.doc.documentElement.dataset.theme, 'oscuro', 'aplica el tema del sistema');

  // Botón de tema.
  env.click(env.target('swThemeBtn'));
  assert.equal(env.doc.documentElement.dataset.theme, 'claro');
  assert.equal(env.storage.getItem('smartwaste-theme'), 'claro');
  assert.deepEqual(themeChanges, ['claro'], 'avisa al resto de la app (el mapa debe repintarse con los colores del tema)');

  // Menú "Más": abre, cierra con otro clic, y cierra con Escape.
  const btn = env.doc.getElementById('swMoreBtn'), panel = env.doc.getElementById('swMore');
  env.click(env.target('swMoreBtn'));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.getAttribute('hidden'), null, 'el panel se muestra');
  env.click(env.target('swMoreBtn'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.notEqual(panel.getAttribute('hidden'), null);
  env.click(env.target('swMoreBtn'));
  env.listeners.document.keydown.forEach((fn) => fn({ key: 'Escape' }));
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'Escape cierra el menú');
  env.click(env.target('swMoreBtn'));
  env.click(env.target(null));
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'un clic fuera cierra el menú');

  // Elemento activo sigue al hash.
  env.win.location.hash = '#impacto';
  env.listeners.window.hashchange.forEach((fn) => fn());
  assert.equal(env.links[1].getAttribute('aria-current'), 'page');
  assert.equal(env.links[0].getAttribute('aria-current'), null);
  assert.equal(typeof api.syncRail, 'function');
}
{
  const env = makeEnv({ stored: 'claro', dark: true });
  mountShell({ document: env.doc, window: env.win, storage: env.storage, hideDemo: true });
  assert.equal(env.doc.documentElement.dataset.theme, 'claro', 'la elección guardada gana');
  assert.ok(!env.host.outerHTML.includes('Datos demo'), 'hideDemo oculta el aviso');
}
console.log('shell-behavior ok');

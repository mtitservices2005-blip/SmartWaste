// SW-084: monta el riel Mando y su comportamiento (tema, menú "Más", elemento activo). Recibe el
// documento, la ventana y el almacenamiento como argumentos para poder probarse sin navegador.
import { renderRail, activeHref } from './components/rail.js';
import { initTheme } from './theme.js';

export function mountShell({ document: doc, window: win, storage, hideDemo = false, onThemeChange = () => {} }) {
  const host = doc.getElementById('swRail');
  if (host) host.outerHTML = renderRail({ hash: win.location.hash, hideDemo });
  const theme = initTheme({ document: doc, storage, matchMedia: win.matchMedia?.bind(win) });

  function setMore(open) {
    const btn = doc.getElementById('swMoreBtn');
    const panel = doc.getElementById('swMore');
    if (!btn || !panel) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
  }
  const isOpen = () => doc.getElementById('swMoreBtn')?.getAttribute('aria-expanded') === 'true';

  function syncRail() {
    const active = activeHref(win.location.hash);
    doc.querySelectorAll('#swRail a[href^="#"]').forEach((link) => {
      if (link.getAttribute('href') === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  doc.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('#swThemeBtn')) { onThemeChange(theme.toggle()); return; }
    if (target.closest('#swMoreBtn')) { setMore(!isOpen()); return; }
    if (target.closest('.sw-rail__morelink')) { setMore(false); return; }
    if (!target.closest('#swMore')) setMore(false);
  });
  doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMore(false); });
  win.addEventListener('hashchange', syncRail);
  return { theme, syncRail };
}

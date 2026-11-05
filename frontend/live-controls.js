// SW-110: controlador del selector de camiones y la pantalla completa sobre el mapa en vivo.
// Lo comparten /en-vivo, Ciudadanía y el mapa del panel (Operaciones · Mapa). Delega los clics en el documento:
// el menú se abre y se cierra aquí; la elección, el ícono y la pantalla completa se avisan al dueño del mapa.
import { renderLiveControls } from './components/live-map.js';

export function createLiveControls({ host, onSelect, onIcon, onFullscreen, doc = host.ownerDocument } = {}) {
  let open = false;
  let last = { vehicles: [], selectedCode: null, icon: 'compactador', fullscreen: false };
  const draw = () => { host.innerHTML = renderLiveControls({ ...last, open }); };
  const onClick = (e) => {
    const t = e.target;
    if (!host.contains(t)) { if (open) { open = false; draw(); } return; }
    if (t.closest('[data-live-picker]')) { open = !open; draw(); return; }
    const veh = t.closest('[data-live-vehicle]');
    if (veh) { open = false; onSelect?.(veh.getAttribute('data-live-vehicle') || null); return; }
    const ic = t.closest('[data-live-icon]');
    if (ic) { onIcon?.(ic.getAttribute('data-live-icon')); return; }
    if (t.closest('[data-live-fullscreen]')) { open = false; onFullscreen?.(); return; }
    if (open && !t.closest('.live-picker')) { open = false; draw(); }
  };
  const onKey = (e) => { if (e.key === 'Escape' && open) { open = false; draw(); } };
  doc.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey);
  return {
    render(next) { last = { ...last, ...next }; draw(); },
    close() { if (open) { open = false; draw(); } },
    destroy() { doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onKey); }
  };
}

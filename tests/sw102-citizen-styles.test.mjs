// SW-102: Ciudadanía salía sin estilos (live.css no estaba en index.html) y con un cuadro de mapa vacío sin camiones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountLiveMap } from '../frontend/en-vivo.js';

const index = readFileSync('frontend/index.html', 'utf8');
assert.match(index, /<link rel="stylesheet" href="\.\/styles\/live\.css">/, 'index.html carga live.css');
assert.ok(index.indexOf('live.css') > index.indexOf('tokens.css'), 'live.css va después de los tokens');

const css = readFileSync('frontend/styles/live.css', 'utf8');
assert.match(css, /\.is-empty \.live-map \{ display: none; \}/);

const chain = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function env() {
  const classes = new Set();
  const stage = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  const els = {};
  const get = (sel) => (els[sel] ??= { innerHTML: '', addEventListener() {}, querySelector: () => null, parentElement: sel === '#livePanel' ? stage : null });
  const win = { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} };
  return { classes, root: { innerHTML: '', querySelector: get, addEventListener() {}, removeEventListener() {} }, win };
}
const payload = (vehicles) => ({ municipality: { name: 'X', slug: 'x' }, server_time: '2026-10-18T15:00:10Z', vehicles });
const truck = { code: 'C1', route_name: 'R', status: 'en_ruta', lat: 19.8, lng: -71.1, heading: 0, captured_at: '2026-10-18T15:00:05Z', stopped_since: null, run_started_at: null, path: [] };

{ const { classes, root, win } = env();
  const h = mountLiveMap({ root, win, municipalityId: 'u', variant: 'section', loadLeaflet: async () => chain(), fetchFleet: async () => payload([]) });
  await flush(); assert.ok(classes.has('is-empty'), 'sin camiones se oculta el cuadro del mapa'); h.stop(); }
{ const { classes, root, win } = env();
  const h = mountLiveMap({ root, win, municipalityId: 'u', variant: 'section', loadLeaflet: async () => chain(), fetchFleet: async () => payload([truck]) });
  await flush(); assert.ok(!classes.has('is-empty'), 'con camiones el mapa se muestra'); h.stop(); }
console.log('sw102-citizen-styles ok');

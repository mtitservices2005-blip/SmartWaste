import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mountLiveMap } from '../frontend/en-vivo.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// (a) HTML
const html = read('frontend/en-vivo.html');
assert.match(html, /<script type="module" src="\.\/en-vivo\.js">/);
assert.match(html, /styles\/tokens\.css/);
assert.match(html, /styles\/live\.css/);
assert.ok(!/auth-gate/.test(html));
assert.match(html, /id="liveRoot"/);

// (b) rewrite
const vercel = JSON.parse(read('vercel.json'));
assert.ok(vercel.rewrites?.some((r) => r.source === '/en-vivo' && r.destination === '/en-vivo.html'));

// (c) mountLiveMap con dobles
const chain = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
function makeWin() {
  let seq = 0; const timeouts = new Map(); const intervals = new Map();
  return {
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn) => { const id = ++seq; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    timeouts, intervals
  };
}
function makeRoot() {
  const els = {};
  const get = (sel) => (els[sel] ??= { innerHTML: '', addEventListener() {}, querySelector: () => null });
  return { els, innerHTML: '', querySelector: get, addEventListener() {}, removeEventListener() {} };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const payload = (extra = {}) => ({
  municipality: { name: 'Laguna Salada', slug: 'laguna' },
  server_time: '2026-10-18T15:00:10Z',
  vehicles: [{ code: 'SW-LS-01', route_name: 'Ruta Norte', status: 'en_ruta', lat: 19.8, lng: -71.1, heading: 0, captured_at: '2026-10-18T15:00:05Z', stopped_since: null, run_started_at: '2026-10-18T14:00:00Z', path: [[19.8, -71.1], [19.81, -71.11]] }],
  ...extra
});

{ // sin slug
  const root = makeRoot(); const win = makeWin(); let calls = 0;
  const h = mountLiveMap({ root, win, fetchFleet: async () => { calls++; return payload(); }, loadLeaflet: async () => chain(), slug: '' });
  await flush();
  assert.match(root.innerHTML, /Falta indicar el municipio/);
  assert.equal(calls, 0);
  h.stop();
}
{ // con datos, luego fallo conserva lista
  const root = makeRoot(); const win = makeWin(); let calls = 0; let leaflet = 0; let fail = false;
  const h = mountLiveMap({ root, win, slug: 'laguna', loadLeaflet: async () => { leaflet++; return chain(); },
    fetchFleet: async () => { calls++; if (fail) throw new Error('red'); return payload(); } });
  await flush();
  assert.equal(calls, 1); assert.equal(leaflet, 1);
  const panel = () => root.els['#livePanel'].innerHTML;
  assert.match(panel(), /data-live-vehicle="SW-LS-01"/);
  assert.match(panel(), /Ruta Norte/);
  assert.match(root.els['#liveHeader'].innerHTML, /Laguna Salada/);
  fail = true;
  const [id, t] = [...win.timeouts.entries()][0]; win.timeouts.delete(id); t.fn(); await flush();
  assert.equal(calls, 2);
  assert.match(panel(), /data-live-vehicle="SW-LS-01"/);
  assert.match(panel(), /No pudimos actualizar/);
  h.stop();
  assert.equal(win.timeouts.size, 0); assert.equal(win.intervals.size, 0);
}
{ // sin slug pero con municipio del despliegue (SW-100)
  const root = makeRoot(); const win = makeWin(); let calls = 0;
  const h = mountLiveMap({ root, win, municipalityId: 'uuid-1', loadLeaflet: async () => chain(), fetchFleet: async () => { calls++; return payload(); } });
  await flush();
  assert.equal(calls, 1);
  assert.match(root.els['#livePanel'].innerHTML, /data-live-vehicle="SW-LS-01"/);
  h.stop();
}
{ // sin camiones
  const root = makeRoot(); const win = makeWin();
  const h = mountLiveMap({ root, win, slug: 'laguna', loadLeaflet: async () => chain(), fetchFleet: async () => payload({ vehicles: [] }) });
  await flush();
  assert.match(root.els['#livePanel'].innerHTML, /Hoy aún no hay camiones en ruta/);
  h.stop();
}

// (d) build
const build = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/build-frontend-config.mjs', import.meta.url))], {
  env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-test' }, encoding: 'utf8'
});
assert.equal(build.status, 0, build.stderr);
const dist = new URL('../dist/en-vivo.html', import.meta.url);
assert.ok(existsSync(dist));
const out = readFileSync(dist, 'utf8');
assert.match(out, /SMARTWASTE_SUPABASE_CONFIG:START/);
assert.match(out, /https:\/\/x\.supabase\.co/);
const js = readFileSync(new URL('../dist/en-vivo.js', import.meta.url), 'utf8');
assert.ok(!js.includes('../shared/') && js.includes('./shared/'));
console.log('en-vivo-wiring ok');

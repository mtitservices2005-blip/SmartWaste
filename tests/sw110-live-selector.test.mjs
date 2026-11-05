// SW-110: selector único de camiones + pantalla completa, y "Detenido hace X min" por corrida.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLiveControls } from '../frontend/components/live-map.js';
import { createLiveControls } from '../frontend/live-controls.js';

const vs = [
  { code: 'SW-LS-01', routeName: 'Ruta Centro', status: 'en_ruta', statusText: 'En ruta' },
  { code: 'SW-LS-02', routeName: 'Pueblo <Nuevo>', status: 'detenido', statusText: 'Detenido hace 3 min' }
];

// 1) HTML del selector
const all = renderLiveControls({ vehicles: vs, selectedCode: null, icon: 'compactador', open: false });
assert.match(all, /Todos los camiones/);
assert.match(all, /\(2\)/);
assert.match(all, /data-live-picker[^>]*aria-expanded="false"/);
assert.match(all, /<div class="live-picker__menu" hidden>/);
assert.match(all, /data-live-vehicle=""/, 'opción "ver todos"');
assert.match(all, /data-live-vehicle="SW-LS-02"/);
assert.match(all, /Detenido hace 3 min/);
assert.match(all, /data-live-icon="volquete"/, 'el ícono vive al pie del menú');
assert.match(all, /data-live-fullscreen[^>]*aria-label="Pantalla completa"/);
assert.ok(all.includes('Pueblo &lt;Nuevo&gt;'), 'texto escapado');
const one = renderLiveControls({ vehicles: vs, selectedCode: 'SW-LS-02', icon: 'punto', open: true, fullscreen: true });
assert.match(one, /SW-LS-02 · Pueblo &lt;Nuevo&gt;<\/span>/);
assert.ok(!/\(2\)/.test(one.split('live-picker__menu')[0]), 'con camión elegido no muestra el conteo');
assert.match(one, /aria-expanded="true"/);
assert.ok(!/ hidden>/.test(one));
assert.match(one, /aria-label="Salir de pantalla completa"/);
assert.equal((one.match(/is-on/g) || []).length, 1);
assert.match(renderLiveControls({ vehicles: [] }), /Todos los camiones[\s\S]*\(0\)/);

// 2) Controlador con documento falso
function fakeEl(sel = {}) { return { closest: (q) => sel[q] ?? null, ownerDocument: null }; }
const listeners = {};
const doc = { addEventListener: (t, f) => { (listeners[t] ??= []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); } };
const host = { innerHTML: '', contains: (t) => t.inside === true };
const picks = []; const icons = []; let fs = 0;
const c = createLiveControls({ host, doc, onSelect: (x) => picks.push(x), onIcon: (x) => icons.push(x), onFullscreen: () => { fs += 1; } });
c.render({ vehicles: vs, selectedCode: null, icon: 'compactador' });
assert.match(host.innerHTML, /aria-expanded="false"/);
const click = (t) => listeners.click.forEach((f) => f({ target: t }));
const attr = (v) => ({ getAttribute: () => v });
click({ inside: true, closest: (q) => (q === '[data-live-picker]' ? {} : null) });
assert.match(host.innerHTML, /aria-expanded="true"/, 'abre el menú');
click({ inside: true, closest: (q) => (q === '[data-live-icon]' ? attr('volquete') : null) });
assert.deepEqual(icons, ['volquete']);
assert.match(host.innerHTML, /aria-expanded="true"/, 'elegir ícono no cierra el menú');
click({ inside: true, closest: (q) => (q === '[data-live-vehicle]' ? attr('SW-LS-01') : null) });
assert.deepEqual(picks, ['SW-LS-01']);
c.render({});
assert.match(host.innerHTML, /aria-expanded="false"/, 'elegir camión cierra el menú');
click({ inside: true, closest: (q) => (q === '[data-live-picker]' ? {} : null) });
click({ inside: true, closest: (q) => (q === '[data-live-vehicle]' ? attr('') : null) });
assert.deepEqual(picks, ['SW-LS-01', null], '"ver todos" avisa null');
click({ inside: true, closest: (q) => (q === '[data-live-fullscreen]' ? {} : null) });
assert.equal(fs, 1);
click({ inside: true, closest: (q) => (q === '[data-live-picker]' ? {} : null) });
click({ inside: false, closest: () => null });
assert.match(host.innerHTML, /aria-expanded="false"/, 'clic fuera cierra');
click({ inside: true, closest: (q) => (q === '[data-live-picker]' ? {} : null) });
listeners.keydown.forEach((f) => f({ key: 'Escape' }));
assert.match(host.innerHTML, /aria-expanded="false"/, 'Esc cierra');
c.destroy();
assert.equal((listeners.click ?? []).length + (listeners.keydown ?? []).length, 0, 'destroy quita los oyentes');

// 3) CSS: bandera de Leaflet y panel vacío
const css = readFileSync('frontend/styles/live.css', 'utf8');
assert.match(css, /\.live-map \.leaflet-attribution-flag \{[^}]*width: 1em/);
assert.match(css, /\.live-panel\[hidden\] \{ display: none; \}/);
assert.match(css, /\.live-map\.is-full \{ position: fixed/);

// 4) Migración: la parada solo se hereda dentro de la misma corrida
const sql = readFileSync('supabase/migrations/202611050001_sw110_stopped_since_por_corrida.sql', 'utf8');
assert.match(sql, /create or replace function ingest_positions\(batch jsonb\)/);
assert.match(sql, /prev\.stopped_since is not null\s+and prev\.route_run_id is not distinct from v\.route_run_id/);
assert.match(sql, /update vehicle_live_state ls[\s\S]*ls\.stopped_since < rr\.started_at/);
assert.ok(!/drop table|delete from|truncate/i.test(sql));
const orig = readFileSync('supabase/migrations/202610120001_sw081_fleet_live_state.sql', 'utf8');
const body = (t) => t.slice(t.indexOf('create or replace function ingest_positions'), t.indexOf('create or replace function ingest_positions') + 6000).replace(/\s+/g, ' ');
const strip = (t) => body(t).replace(' and prev.route_run_id is not distinct from v.route_run_id', '');
assert.equal(strip(sql).slice(0, 3800), strip(orig).slice(0, 3800), 'idéntica a SW-081 salvo la condición nueva');
console.log('sw110-live-selector ok');

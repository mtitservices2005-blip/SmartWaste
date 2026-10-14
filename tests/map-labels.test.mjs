// SW-084: preferencia "mostrar etiquetas en el mapa" (Configuración). Por defecto visibles; si el
// almacenamiento falla, la plataforma sigue funcionando sin recordar la elección.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP_LABELS_KEY, readMapLabels, saveMapLabels, applyMapLabels } from '../frontend/map-prefs.js';

const mem = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };
const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };

assert.equal(readMapLabels(mem()), true, 'por defecto se ven las etiquetas');
assert.equal(readMapLabels(broken), true, 'sin almacenamiento, se ven');
const s = mem();
assert.equal(saveMapLabels(s, false), true);
assert.equal(s.getItem(MAP_LABELS_KEY), '0');
assert.equal(readMapLabels(s), false);
assert.equal(saveMapLabels(s, true), true);
assert.equal(readMapLabels(s), true);
assert.equal(saveMapLabels(broken, false), false, 'no revienta si falla');

const classes = new Set();
const doc = { body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
applyMapLabels(doc, false); assert.ok(classes.has('sw-hide-map-labels'));
applyMapLabels(doc, true); assert.ok(!classes.has('sw-hide-map-labels'));

const css = readFileSync(new URL('../frontend/styles/shell.css', import.meta.url), 'utf8');
assert.match(css, /\.sw-hide-map-labels \.leaflet-truck small/, 'CSS oculta el número del camión');
assert.match(css, /\.sw-hide-map-labels \.leaflet-incident small/, 'CSS oculta el texto de la situación');
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /id="mapLabelsToggle"/, 'Configuración tiene el checkbox');
assert.match(app, /applyMapLabels\(document, readMapLabels\(mapPrefStorage\(\)\)\)/, 'se aplica al iniciar');
console.log('map-labels ok');

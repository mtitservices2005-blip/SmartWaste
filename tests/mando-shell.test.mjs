// SW-084 (CA3, CA8): riel de navegación Mando. HTML puro; conserva los enlaces por hash que usan
// app.js (showSection) y auth-gate.js (ocultar por rol), y es operable con teclado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPS_ITEMS, MORE_ITEMS, renderRail, activeHref } from '../frontend/components/rail.js';

assert.deepEqual(OPS_ITEMS.map((i) => i.href), ['#operaciones/mapa', '#operaciones/rutas', '#operaciones/flota', '#operaciones/incidencias', '#operaciones/estadisticas']);
assert.deepEqual(OPS_ITEMS.map((i) => i.label), ['Mapa en vivo', 'Rutas', 'Flotilla', 'Incidencias', 'Métricas']);
assert.deepEqual(MORE_ITEMS.map((i) => i.href), ['#resumen', '#supervisor', '#conductor', '#ciudadania', '#impacto', '#configuracion', '#master']);

// Qué elemento está activo según el hash.
assert.equal(activeHref('#operaciones/rutas'), '#operaciones/rutas');
assert.equal(activeHref('#operaciones'), '#operaciones/mapa', 'sin sub-vista se asume el mapa, como showOpsView');
assert.equal(activeHref('#impacto'), '#impacto');
assert.equal(activeHref(''), '#resumen', 'sin hash la sección inicial es Resumen');
assert.equal(activeHref('#nada'), '#resumen');
assert.equal(activeHref('#operaciones/otra'), '#operaciones/mapa');

const html = renderRail({ hash: '#operaciones/flota' });
assert.match(html, /^<header class="topbar sw-rail"/, 'conserva la clase .topbar que usan app.js y auth-gate.js');
for (const i of [...OPS_ITEMS, ...MORE_ITEMS]) assert.ok(html.includes(`href="${i.href}"`), `falta el enlace ${i.href}`);
// Cada enlace de icono tiene nombre accesible (el icono solo no lo da).
for (const i of OPS_ITEMS) assert.match(html, new RegExp(`<a [^>]*href="${i.href}"[^>]*aria-label="${i.label}"`), `${i.label} sin aria-label`);
// Activo: exactamente uno y con aria-current.
assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
assert.match(html, /<a [^>]*href="#operaciones\/flota"[^>]*aria-current="page"/);
assert.match(renderRail({ hash: '#impacto' }), /<a [^>]*href="#impacto"[^>]*aria-current="page"/, 'un elemento de "Más" también puede estar activo');
// "Más": botón con estado expandido y panel enlazado; los iconos son decorativos.
assert.match(html, /<button [^>]*id="swMoreBtn"[^>]*aria-expanded="false"[^>]*aria-controls="swMore"/);
assert.match(html, /id="swMore"[^>]*hidden/);
assert.ok(html.includes('aria-hidden="true"'), 'los svg son decorativos');
// Tema: botón con nombre accesible.
assert.match(html, /<button [^>]*id="swThemeBtn"[^>]*aria-label="Cambiar tema"/);
// Aviso demo (regla permanente 7): presente por defecto, ausente cuando hideDemo.
assert.ok(html.includes('Datos demo · no producción'));
assert.ok(!renderRail({ hash: '', hideDemo: true }).includes('Datos demo'));
// Un "Más" activo abre el panel solo con el botón, nunca por el hash (no cambia el estado inicial).
assert.match(renderRail({ hash: '#impacto' }), /aria-expanded="false"/);

// index.html: el riel se llena desde app.js y ya no trae la barra de texto antigua.
const index = readFileSync('frontend/index.html', 'utf8');
assert.match(index, /<header class="topbar sw-rail" id="swRail"><\/header>/);
assert.ok(!index.includes('<nav><a href="#resumen">'));

// Estilos del riel: objetivos táctiles de 44 px y foco visible.
const css = readFileSync('frontend/styles/shell.css', 'utf8');
assert.match(css, /\.sw-rail[^{]*\{[^}]*\}/);
assert.match(css, /min-(width|height):\s*44px/);
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(max-width:\s*820px\)/);
console.log('mando-shell ok');

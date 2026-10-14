// SW-084 (CA9): las pantallas aún no rediseñadas se adaptan a los temas con tokens, sin colores fijos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('frontend/index.html', 'utf8');
const legacy = readFileSync('frontend/styles/legacy-theme.css', 'utf8');
const shell = readFileSync('frontend/styles/shell.css', 'utf8');

// Orden de carga: tokens → componentes → temas → estructura → estilos antiguos → adaptación de lo antiguo.
const order = ['styles/tokens.css', 'styles/components.css', 'styles/theme-mando.css', 'styles/shell.css', './styles.css', 'styles/legacy-theme.css'].map((f) => index.indexOf(f));
assert.ok(order.every((i) => i > -1), 'index.html carga todas las hojas de estilo');
assert.deepEqual([...order].sort((a, b) => a - b), order, 'las hojas se cargan en el orden correcto (legacy-theme.css después de styles.css)');

// Ningún color fijo: solo var(--token). (Los scrims translúcidos de los diálogos quedan fuera de este archivo.)
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
for (const [name, css] of [['legacy-theme.css', legacy], ['shell.css', shell]]) {
  const hex = strip(css).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `${name} tiene colores fijos: ${hex.join(', ')}`);
}
// Cada variable var(--x) usada existe en tokens.css, en un tema, o es una variable heredada con alias aquí.
const defined = new Set([...readFileSync('frontend/styles/tokens.css', 'utf8').matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const m of readFileSync('frontend/styles/theme-mando.css', 'utf8').matchAll(/--([a-z0-9-]+)\s*:/g)) defined.add(m[1]);
for (const m of strip(legacy).matchAll(/--([a-z0-9-]+)\s*:/g)) defined.add(m[1]);
for (const [name, css] of [['legacy-theme.css', legacy], ['shell.css', shell]]) {
  const used = [...strip(css).matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((u) => !defined.has(u));
  assert.deepEqual(missing, [], `${name} usa variables que no existen: ${missing.join(', ')}`);
}
// El tema oscuro del mapa: los mosaicos se oscurecen con el filtro del tema.
assert.match(legacy, /\.leaflet-tile-pane\s*\{[^}]*filter:\s*var\(--map-tile-filter/);
// Los alias heredados apuntan a tokens.
for (const [alias, token] of [['card', 'color-surface'], ['green', 'color-primary'], ['blue', 'color-info'], ['amber', 'color-warning'], ['red', 'color-danger'], ['muted', 'color-muted'], ['ink', 'color-text']]) {
  assert.match(strip(legacy), new RegExp(`--${alias}:\\s*var\\(--${token}\\)`), `alias --${alias} → --${token}`);
}
// Botón primario con texto de contraste (en el tema oscuro el primario es claro).
assert.match(strip(legacy), /btn-primary[^{]*\{[^}]*color:\s*var\(--color-primary-contrast\)/);
console.log('theme-legacy ok');

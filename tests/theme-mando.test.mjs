// SW-084 (CA1): los temas Mando (oscuro y claro) redefinen TODOS los tokens de color de SW-082 y cada
// par de texto/fondo cumple WCAG AA en ambos. Lee el CSS real: si alguien cambia un token y rompe el
// contraste, o agrega un color base sin versión en un tema, esta prueba falla.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTokens, parseTheme, checkPairs, TOKEN_PAIRS, THEME_PAIRS } from '../scripts/check-contrast.mjs';

const isColor = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
const baseCss = readFileSync('frontend/styles/tokens.css', 'utf8');
const themeCss = readFileSync('frontend/styles/theme-mando.css', 'utf8');
const { base } = parseTokens(baseCss);

// parseTheme lee solo el bloque de ese tema y devuelve {} si no existe.
assert.deepEqual(parseTheme(':root[data-theme="x"]{--a:#fff;--b:1px;}', 'x'), { a: '#fff', b: '1px' });
assert.deepEqual(parseTheme(':root[data-theme="x"]{--a:#fff;}', 'y'), {});

const baseColors = Object.entries(base).filter(([, v]) => isColor(v)).map(([k]) => k);

for (const theme of ['oscuro', 'claro']) {
  const t = parseTheme(themeCss, theme);
  assert.ok(Object.keys(t).length > 0, `theme-mando.css no define el tema "${theme}"`);

  // Ningún color base queda sin versión en el tema (evita zonas claras en el tema oscuro).
  const missing = baseColors.filter((name) => !(name in t));
  assert.deepEqual(missing, [], `tema ${theme}: faltan tokens de color: ${missing.join(', ')}`);

  // El tema solo redefine tokens que existen en la base o los nuevos declarados en THEME_PAIRS.
  const newTokens = new Set(THEME_PAIRS.flatMap((p) => [p.fg, p.bg]).filter((n) => !(n in base)));
  for (const name of Object.keys(t)) assert.ok(name in base || newTokens.has(name) || name.startsWith('map-'), `tema ${theme}: --${name} no existe en tokens.css ni está verificado`);

  const tokens = { ...base, ...t };
  assert.deepEqual(checkPairs(tokens, TOKEN_PAIRS.normal), [], `tema ${theme}: pares que no cumplen AA`);
  assert.deepEqual(checkPairs(tokens, THEME_PAIRS), [], `tema ${theme}: pares nuevos que no cumplen AA`);

  // Todo color del tema queda medido o es decorativo.
  const covered = new Set([...TOKEN_PAIRS.normal, ...TOKEN_PAIRS.high, ...THEME_PAIRS].flatMap((p) => [p.fg, p.bg]));
  const unchecked = Object.entries(t).filter(([k, v]) => isColor(v) && !covered.has(k) && !TOKEN_PAIRS.decorative.includes(k) && !k.startsWith('map-')).map(([k]) => k);
  assert.deepEqual(unchecked, [], `tema ${theme}: colores sin par de contraste: ${unchecked.join(', ')}`);
}

// Los dos temas son realmente distintos (no uno copiado del otro).
assert.notEqual(parseTheme(themeCss, 'oscuro')['color-background'], parseTheme(themeCss, 'claro')['color-background']);
console.log('theme-mando ok');

// SW-082 (CA-082-1): contraste de texto normal >= 4.5:1 y de texto grande/iconos >= 3:1 en todos los
// pares de colores de los tokens de diseño (frontend/styles/tokens.css); el modo de alto contraste
// de la app del chofer exige >= 7:1. Lee el CSS real: si alguien cambia un token y rompe el
// contraste, esta prueba falla.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, parseTokens, checkPairs, TOKEN_PAIRS } from '../scripts/check-contrast.mjs';

// La fórmula WCAG 2.1 contra valores conocidos.
assert.equal(contrastRatio('#000000', '#ffffff'), 21);
assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.01, '#767676 sobre blanco es 4.54:1');
assert.equal(contrastRatio('#fff', '#000'), 21, 'acepta #rgb');

// La prueba sabe fallar: un par de ~2:1 debe reportarse.
{
  const failures = checkPairs({ a: '#8a8a8a', b: '#ffffff' }, [{ fg: 'a', bg: 'b', min: 4.5, label: 'gris sobre blanco' }]);
  assert.equal(failures.length, 1, 'un par con contraste ~3.4:1 no cumple 4.5:1');
  assert.match(failures[0], /gris sobre blanco/);
  const worse = checkPairs({ a: '#999999', b: '#ffffff' }, [{ fg: 'a', bg: 'b', min: 3, label: 'texto grande' }]);
  assert.equal(worse.length, 1, '#999 sobre blanco (2.85:1) no cumple ni 3:1');
  assert.deepEqual(checkPairs({ a: '#000000', b: '#ffffff' }, [{ fg: 'a', bg: 'b', min: 7, label: 'ok' }]), []);
  assert.equal(checkPairs({ a: '#000000' }, [{ fg: 'a', bg: 'falta', min: 3, label: 'token inexistente' }]).length, 1, 'un token faltante también es fallo');
}

const css = readFileSync('frontend/styles/tokens.css', 'utf8');
const { base, high } = parseTokens(css);

// Tokens obligatorios (interfaz acordada en el plan SW-080).
for (const name of ['color-primary', 'color-primary-contrast', 'color-warning', 'color-danger', 'color-success', 'color-surface', 'color-text', 'color-muted',
  'status-en-ruta', 'status-detenido', 'status-sin-senal', 'status-disponible', 'status-fuera-servicio',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-7', 'space-8', 'radius-1', 'radius-2', 'radius-3']) {
  assert.ok(base[name], `falta el token --${name} en tokens.css`);
}
// Estados de camión: color + fondo (el icono y el texto los pone el componente; nunca solo color).
for (const state of ['en-ruta', 'detenido', 'sin-senal', 'disponible', 'fuera-servicio']) assert.ok(base[`status-${state}-bg`], `falta --status-${state}-bg`);

// Todos los pares declarados cumplen su mínimo, en modo normal y en alto contraste.
assert.deepEqual(checkPairs(base, TOKEN_PAIRS.normal), [], 'pares de contraste que no cumplen (modo normal)');
assert.deepEqual(checkPairs({ ...base, ...high }, TOKEN_PAIRS.high), [], 'pares de contraste que no cumplen (alto contraste)');

// Ningún token de color queda fuera de la verificación (evita agregar colores sin medir).
const covered = new Set([...TOKEN_PAIRS.normal, ...TOKEN_PAIRS.high].flatMap((p) => [p.fg, p.bg]));
const colorTokens = Object.entries(base).filter(([, v]) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)).map(([k]) => k);
const unchecked = colorTokens.filter((name) => !covered.has(name) && !TOKEN_PAIRS.decorative.includes(name));
assert.deepEqual(unchecked, [], `tokens de color sin par de contraste: ${unchecked.join(', ')}`);
for (const name of Object.keys(high)) assert.ok(name in base, `el modo alto contraste redefine --${name}, que no existe en :root`);

console.log('design-contrast ok');

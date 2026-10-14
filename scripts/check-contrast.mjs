// SW-082: verificación de contraste WCAG 2.1 de los tokens de diseño (frontend/styles/tokens.css).
// Uso: `node scripts/check-contrast.mjs` (sale con código 1 si algún par no cumple).
// tests/design-contrast.test.mjs usa estas mismas funciones.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function toRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new TypeError(`color inválido: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Razón de contraste WCAG entre dos colores hex (1 a 21).
export function contrastRatio(hexA, hexB) {
  const [lighter, darker] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 1e6) / 1e6;
}

// Lee las variables `--nombre: valor;` de :root y del bloque :root[data-contrast="high"].
export function parseTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const read = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]));
  const highMatch = clean.match(/:root\[data-contrast=["']high["']\]\s*\{([^}]*)\}/);
  const baseMatch = clean.match(/:root\s*\{([^}]*)\}/);
  return { base: baseMatch ? read(baseMatch[1]) : {}, high: highMatch ? read(highMatch[1]) : {} };
}

// Devuelve una lista de mensajes de los pares que NO cumplen (vacía si todo cumple).
export function checkPairs(tokens, pairs) {
  const failures = [];
  for (const { fg, bg, min, label } of pairs) {
    if (!tokens[fg] || !tokens[bg]) {
      failures.push(`${label}: falta el token ${!tokens[fg] ? fg : bg}`);
      continue;
    }
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    if (ratio < min) failures.push(`${label}: --${fg} sobre --${bg} = ${ratio.toFixed(2)}:1 (mínimo ${min}:1)`);
  }
  return failures;
}

const STATES = ['en-ruta', 'detenido', 'sin-senal', 'disponible', 'fuera-servicio'];
const statePairs = (min) => STATES.map((s) => ({ fg: `status-${s}`, bg: `status-${s}-bg`, min, label: `estado ${s}` }));

// min 4.5 = texto normal; 3 = texto grande, iconos y bordes de controles.
export const TOKEN_PAIRS = {
  normal: [
    { fg: 'color-text', bg: 'color-surface', min: 4.5, label: 'texto sobre tarjeta' },
    { fg: 'color-text', bg: 'color-background', min: 4.5, label: 'texto sobre fondo' },
    { fg: 'color-muted', bg: 'color-surface', min: 4.5, label: 'texto secundario sobre tarjeta' },
    { fg: 'color-muted', bg: 'color-background', min: 4.5, label: 'texto secundario sobre fondo' },
    { fg: 'color-primary-contrast', bg: 'color-primary', min: 4.5, label: 'botón primario' },
    { fg: 'color-primary-contrast', bg: 'color-primary-strong', min: 4.5, label: 'botón primario (hover)' },
    { fg: 'color-primary', bg: 'color-surface', min: 4.5, label: 'enlace verde sobre tarjeta' },
    { fg: 'color-on-ink', bg: 'color-ink', min: 4.5, label: 'barra superior' },
    { fg: 'color-on-ink-muted', bg: 'color-ink', min: 4.5, label: 'subtítulo de la barra superior' },
    { fg: 'color-success', bg: 'color-success-bg', min: 4.5, label: 'aviso de éxito' },
    { fg: 'color-warning', bg: 'color-warning-bg', min: 4.5, label: 'aviso de atención' },
    { fg: 'color-danger', bg: 'color-danger-bg', min: 4.5, label: 'aviso de error' },
    { fg: 'color-info', bg: 'color-info-bg', min: 4.5, label: 'aviso informativo' },
    { fg: 'color-danger', bg: 'color-surface', min: 4.5, label: 'texto de error sobre tarjeta' },
    { fg: 'color-warning', bg: 'color-surface', min: 4.5, label: 'texto de atención sobre tarjeta' },
    { fg: 'color-border-input', bg: 'color-surface', min: 3, label: 'borde de campos de formulario' },
    { fg: 'color-focus', bg: 'color-surface', min: 3, label: 'anillo de foco' },
    ...statePairs(4.5)
  ],
  // Alto contraste para uso a la intemperie (app del chofer): 7:1.
  high: [
    { fg: 'color-text', bg: 'color-surface', min: 7, label: 'texto sobre tarjeta' },
    { fg: 'color-muted', bg: 'color-surface', min: 7, label: 'texto secundario sobre tarjeta' },
    { fg: 'color-primary-contrast', bg: 'color-primary', min: 7, label: 'botón primario' },
    { fg: 'color-success', bg: 'color-success-bg', min: 7, label: 'aviso de éxito' },
    { fg: 'color-warning', bg: 'color-warning-bg', min: 7, label: 'aviso de atención' },
    { fg: 'color-danger', bg: 'color-danger-bg', min: 7, label: 'aviso de error' },
    { fg: 'color-border-input', bg: 'color-surface', min: 4.5, label: 'borde de campos de formulario' },
    ...statePairs(7)
  ],
  // Colores que solo decoran (bordes de tarjeta, separadores): no transmiten información.
  decorative: ['color-border', 'color-background-alt']
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { base, high } = parseTokens(readFileSync(new URL('../frontend/styles/tokens.css', import.meta.url), 'utf8'));
  const failures = [...checkPairs(base, TOKEN_PAIRS.normal), ...checkPairs({ ...base, ...high }, TOKEN_PAIRS.high).map((f) => `[alto contraste] ${f}`)];
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log(`contraste ok: ${TOKEN_PAIRS.normal.length} pares en modo normal, ${TOKEN_PAIRS.high.length} en alto contraste`);
}

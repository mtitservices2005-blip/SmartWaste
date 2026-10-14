// SW-082: los tokens de diseño deben cargarse antes de styles.css y llegar a dist/ (Vercel publica
// solo dist/). Corre el script de build real con un entorno mínimo (modo demo, sin Supabase).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync('frontend/index.html', 'utf8');
const tokensAt = html.indexOf('./styles/tokens.css');
const componentsAt = html.indexOf('./styles/components.css');
const stylesAt = html.indexOf('./styles.css');
assert.ok(tokensAt > -1, 'frontend/index.html debe enlazar ./styles/tokens.css');
assert.ok(componentsAt > tokensAt, 'components.css va después de tokens.css');
assert.ok(stylesAt > componentsAt, 'styles.css (existente) va al final para no perder sus reglas');

const env = {};
for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
const build = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/build-frontend-config.mjs', import.meta.url))], { env, encoding: 'utf8' });
assert.equal(build.status, 0, `el build falló: ${build.stderr}`);
for (const file of ['dist/styles/tokens.css', 'dist/styles/components.css', 'dist/components/button.js', 'dist/ui-mode.js']) {
  assert.ok(existsSync(file), `el build debe copiar ${file}`);
}
assert.ok(readFileSync('dist/index.html', 'utf8').includes('./styles/tokens.css'));
console.log('design-assets ok');

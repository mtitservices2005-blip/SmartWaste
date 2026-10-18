import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sw097-'));
execFileSync('node', ['scripts/sw097-harness.mjs', dir], { stdio: 'pipe' });
const expect = {
  'en-ruta': /En ruta/, 'detenido': /Detenido hace 7 min/, 'sin-senal': /Sin señal/,
  'vacio': /Hoy aún no hay camiones en ruta/, 'error': /No pudimos actualizar\. Reintentando…/, 'sin-municipio': /Falta indicar el municipio/
};
for (const [name, re] of Object.entries(expect)) {
  const html = readFileSync(join(dir, `harness-${name}.html`), 'utf8');
  assert.match(html, re, name);
  assert.ok(!/plate|battery|driver/i.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), `${name} no debe exponer datos internos`);
}
console.log('sw097-harness ok');

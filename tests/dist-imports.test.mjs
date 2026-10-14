// Guardia de despliegue: reproduce lo que hace scripts/build-frontend-config.mjs (copiar frontend/ y shared/ a dist/,
// reescribiendo '../shared/' solo en los .js de primer nivel) y comprueba que TODA importación relativa resuelve.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = mkdtempSync(join(tmpdir(), 'sw-dist-'));
try {
  cpSync(join(root, 'frontend'), dist, { recursive: true });
  cpSync(join(root, 'shared'), join(dist, 'shared'), { recursive: true });
  for (const f of readdirSync(dist)) {
    if (!f.endsWith('.js')) continue;
    const p = join(dist, f); const c = readFileSync(p, 'utf8');
    const r = c.replaceAll('../shared/', './shared/');
    if (r !== c) writeFileSync(p, r);
  }
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === 'vendor' ? [] : walk(join(d, n))) : [join(d, n)]));
  let checked = 0;
  for (const file of walk(dist).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]);
      assert.ok(existsSync(target), `${file.replace(dist, 'dist')} importa ${m[1]} que no existe en dist/`);
      checked += 1;
    }
  }
  assert.ok(checked > 50, 'se revisaron las importaciones');
} finally {
  rmSync(dist, { recursive: true, force: true });
}
console.log('dist-imports ok');

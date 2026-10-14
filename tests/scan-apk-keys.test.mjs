// SW-083: el escaneo del APK final busca LLAVES, no la palabra. La palabra "service_role" aparece en
// comentarios y documentación legítimos (falso positivo del 14-oct); una llave service_role real, en cambio,
// es un JWT cuyo payload dice role=service_role y NO contiene esa palabra en texto plano.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectory } from '../scripts/scan-apk-keys.mjs';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${'s'.repeat(43)}`;
const dir = () => mkdtempSync(join(tmpdir(), 'apkscan-'));

// 1. Comentarios y documentación con la palabra: limpio.
{
  const d = dir();
  writeFileSync(join(d, 'app.js'), '// Anon key only (rule 8 — never a service_role key here).\nconsole.log("ok");');
  writeFileSync(join(d, 'status.json'), '{"note":"driver-scoped and a service_role-scoped subscription"}');
  assert.deepEqual(scanDirectory(d), []);
}
// 2. La anon key (JWT con role=anon) SÍ va en el APK y no es hallazgo.
{
  const d = dir();
  writeFileSync(join(d, 'index.html'), `<script>window.CFG={"anonKey":"${jwt({ role: 'anon', iss: 'supabase' })}"}</script>`);
  assert.deepEqual(scanDirectory(d), []);
}
// 3. Una llave service_role real (JWT) es hallazgo aunque la palabra no aparezca en texto plano, y no se imprime.
{
  const d = dir();
  mkdirSync(join(d, 'assets'));
  const key = jwt({ role: 'service_role', iss: 'supabase' });
  writeFileSync(join(d, 'assets', 'config.js'), `var k="${key}";`);
  const findings = scanDirectory(d);
  assert.equal(findings.length, 1);
  assert.match(findings[0].file, /config\.js$/);
  assert.match(findings[0].reason, /service_role/);
  assert.equal(JSON.stringify(findings).includes(key), false, 'nunca imprimir la llave');
}
// 4. Identificador de llave con valor.
{
  const d = dir();
  writeFileSync(join(d, 'a.js'), 'const SUPABASE_SERVICE_ROLE_KEY = "abcdefghijklmnopqrstuvwxyz0123456789";');
  assert.equal(scanDirectory(d).length, 1);
}
{
  const d = dir();
  writeFileSync(join(d, 'b.js'), 'cfg = { service_role: "abcdefghijklmnopqrstuvwxyz0123456789" }');
  assert.equal(scanDirectory(d).length, 1);
}
// 5. Binarios (dex, etc.) se leen sin romper.
{
  const d = dir();
  writeFileSync(join(d, 'classes.dex'), Buffer.from([0, 255, 1, 2, 3, 200, 100]));
  assert.deepEqual(scanDirectory(d), []);
}
console.log('scan-apk-keys ok');

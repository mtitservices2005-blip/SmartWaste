// SW-070: `--dry-run` must be runnable as a real process and truthfully describe what a real run
// would attempt, WITHOUT building a Supabase client or reading SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
//
// This test spawns scripts/seed-empty-municipality-remote.mjs as a child process (process.execPath,
// not an in-process import of internal functions) with an explicit env that deliberately omits the
// provisioning variables, then asserts the printed simulation names the municipality slug, every
// requested account with its email + role, and — for drivers — the `drivers` row it would create or
// reuse. A temporary, non-real fixture file (example.test / example.invalid identities) exercises the
// realistic multi-account --from-file path (supervisor + dispatcher + driver).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/seed-empty-municipality-remote.mjs', import.meta.url));

// Minimal, explicit env: only Node's own needs on Windows. The provisioning variables are
// deliberately absent, so the run must succeed on --dry-run alone.
const BASE_ENV = {};
for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP']) {
  if (process.env[key]) BASE_ENV[key] = process.env[key];
}

function runDryRun(args) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...BASE_ENV },
    encoding: 'utf8'
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`
  };
}

const tempDir = mkdtempSync(join(tmpdir(), 'sw070-dry-run-'));
try {
  const slug = 'piloto-prueba';
  const accounts = [
    { email: 'supervisor@example.test', role: 'supervisor', name: 'Supervisión Piloto' },
    { email: 'dispatcher@example.test', role: 'dispatcher', name: 'Despacho Piloto' },
    { email: 'conductor@example.invalid', role: 'driver', name: 'Conducción Piloto' }
  ];
  const fixturePath = join(tempDir, 'provisioning-users.json');
  writeFileSync(fixturePath, JSON.stringify({ users: accounts }, null, 2));

  // Caso múltiple realista vía --from-file: supervisor + dispatcher + driver.
  const bulk = runDryRun([
    'add-user',
    '--municipality-slug', slug,
    '--from-file', fixturePath,
    '--dry-run'
  ]);

  assert.equal(bulk.status, 0, '--dry-run sin credenciales debe terminar con exit 0');

  // No crea cliente ni escribe, y no lee las variables de provisión.
  assert.match(bulk.output, /no se crea cliente/i, 'debe indicar que no se crea cliente');
  assert.match(bulk.output, /no se escribe en Supabase/i, 'debe indicar que no se escribe en Supabase');
  assert.match(bulk.output, /SUPABASE_SERVICE_ROLE_KEY/i, 'debe aclarar que no lee las variables de provisión');

  // Menciona el municipio por slug.
  assert.ok(bulk.output.includes(slug), 'debe mostrar el slug del municipio');

  // Cada cuenta solicitada con su correo y su rol.
  for (const account of accounts) {
    assert.ok(bulk.output.includes(account.email), `debe mostrar el correo ${account.email}`);
    assert.ok(
      bulk.output.includes(`rol ${account.role}`),
      `debe mostrar el rol ${account.role} de ${account.email}`
    );
  }

  // Para el driver, menciona explícitamente la fila de `drivers` ligada a su correo.
  const driver = accounts.find((account) => account.role === 'driver');
  assert.match(
    bulk.output,
    new RegExp(`${driver.email.replace(/[.@]/g, '\\$&')}[\\s\\S]*?drivers`),
    'la línea del driver debe mencionar la tabla drivers'
  );

  // Caso simple: alta de municipal_admin sobre un municipio, también sin credenciales.
  const single = runDryRun([
    'municipality',
    '--municipality-slug', slug,
    '--municipality-name', 'Municipio Piloto Prueba',
    '--email', 'admin@example.test',
    '--name', 'Administración Piloto',
    '--dry-run'
  ]);
  assert.equal(single.status, 0, '--dry-run de municipality sin credenciales debe terminar con exit 0');
  assert.ok(single.output.includes(slug), 'debe mostrar el slug del municipio');
  assert.ok(single.output.includes('admin@example.test'), 'debe mostrar el correo solicitado');
  assert.ok(single.output.includes('rol municipal_admin'), 'debe mostrar el rol municipal_admin');
  assert.match(single.output, /no se crea cliente/i);
  assert.match(single.output, /no se escribe en Supabase/i);

  console.log('SW-070 dry-run process tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

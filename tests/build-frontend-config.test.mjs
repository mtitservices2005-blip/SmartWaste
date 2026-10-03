// SW-070 (CA3): verifies scripts/build-frontend-config.mjs fails with a clear message when
// SUPABASE_BUILD_STRICT=true and a required variable is missing, while preserving the existing
// demo-only behavior (never fails, only warns) when the strict flag is absent — CLAUDE.md rule 5.
//
// Runs the real script as an isolated child process with an explicit env (never inheriting the
// test process' full environment), so the outcome is deterministic regardless of the machine's
// own SUPABASE_* variables.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/build-frontend-config.mjs', import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const CONFIG_MARKER = 'SMARTWASTE_SUPABASE_CONFIG:START';

// Minimal, explicit env: only what Node itself may need on Windows, plus the SUPABASE_* overrides
// under test. The real process env is deliberately NOT spread in, so a stray SUPABASE_URL on the
// developer's machine cannot mask a missing-variable assertion.
const BASE_ENV = {};
for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP']) {
  if (process.env[key]) BASE_ENV[key] = process.env[key];
}

// Uses process.execPath (absolute path to the running node) instead of relying on PATH resolution.
// spawnSync (not execFileSync) so stderr is captured even when the child exits 0 — the demo path
// only warns, and that warning is exactly what test (a) asserts.
function runBuild(overrides) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...BASE_ENV, ...overrides },
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

try {
  // a. Sin SUPABASE_BUILD_STRICT y sin credenciales: comportamiento demo preservado (exit 0).
  {
    const demo = runBuild({});
    assert.equal(demo.status, 0, 'sin SUPABASE_BUILD_STRICT el build nunca debe fallar (regla 5)');
    assert.match(demo.stderr, /modo demo/i, 'debe advertir que dist/ queda en modo demo');
  }

  // b. SUPABASE_BUILD_STRICT=true sin SUPABASE_URL: falla y nombra la variable faltante.
  {
    const strictMissingUrl = runBuild({
      SUPABASE_BUILD_STRICT: 'true',
      SUPABASE_ANON_KEY: 'anon-key-ficticia-de-prueba'
    });
    assert.notEqual(strictMissingUrl.status, 0, 'build estricto sin SUPABASE_URL debe fallar');
    assert.match(strictMissingUrl.stderr, /Build estricto de staging/, 'debe indicar que es el build estricto');
    assert.match(strictMissingUrl.stderr, /SUPABASE_URL/, 'debe nombrar exactamente SUPABASE_URL');
    assert.doesNotMatch(strictMissingUrl.stderr, /SUPABASE_ANON_KEY/, 'no debe nombrar una variable que sí está presente');
    // El bloque de config no debe quedar escrito en dist/index.html cuando el build falla.
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(html.includes(CONFIG_MARKER), false, 'un build estricto fallido no debe escribir la config de Supabase');
  }

  // b'. SUPABASE_BUILD_STRICT=true sin SUPABASE_ANON_KEY: falla y nombra la otra variable faltante.
  {
    const strictMissingAnonKey = runBuild({
      SUPABASE_BUILD_STRICT: 'true',
      SUPABASE_URL: 'https://staging.invalid'
    });
    assert.notEqual(strictMissingAnonKey.status, 0, 'build estricto sin SUPABASE_ANON_KEY debe fallar');
    assert.match(strictMissingAnonKey.stderr, /SUPABASE_ANON_KEY/, 'debe nombrar exactamente SUPABASE_ANON_KEY');
  }

  // b''. Ambas faltan: el mensaje debe nombrar las dos.
  {
    const strictMissingBoth = runBuild({ SUPABASE_BUILD_STRICT: 'true' });
    assert.notEqual(strictMissingBoth.status, 0, 'build estricto sin ninguna variable debe fallar');
    assert.match(strictMissingBoth.stderr, /SUPABASE_URL/);
    assert.match(strictMissingBoth.stderr, /SUPABASE_ANON_KEY/);
  }

  // c. SUPABASE_BUILD_STRICT=true con ambas variables (ficticias): exit 0 y config inyectada.
  {
    const strictOk = runBuild({
      SUPABASE_BUILD_STRICT: 'true',
      SUPABASE_URL: 'https://staging.invalid',
      SUPABASE_ANON_KEY: 'anon-key-ficticia-de-prueba'
    });
    assert.equal(strictOk.status, 0, 'build estricto con ambas variables debe terminar con exit 0');
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(html.includes(CONFIG_MARKER), true, 'un build estricto correcto debe inyectar la config');
  }

  console.log('build-frontend-config tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

// SW-070 (CA3): verifies scripts/build-frontend-config.mjs strict-mode activation and behavior.
//
// Strict mode must engage when EITHER VERCEL_ENV === 'production' (a production deploy must never
// silently ship a demo-only dist/) OR SUPABASE_BUILD_STRICT === 'true' (the explicit staging/opt-in
// flag). Previews and local runs stay demo-only (exit 0, warning) when neither is set — CLAUDE.md
// rule 5 (never break the demo).
//
// Runs the real script as an isolated child process with an explicit env (never inheriting the test
// process' full environment), so the outcome is deterministic regardless of the machine's own
// SUPABASE_*/VERCEL_* variables.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/build-frontend-config.mjs', import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const CONFIG_MARKER = 'SMARTWASTE_SUPABASE_CONFIG:START';

// Minimal, explicit env: only what Node itself may need on Windows, plus the SUPABASE_*/VERCEL_*
// overrides under test. The real process env is deliberately NOT spread in, so a stray SUPABASE_URL
// or VERCEL_ENV=production on the developer's machine cannot mask an assertion.
const BASE_ENV = {};
for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP']) {
  if (process.env[key]) BASE_ENV[key] = process.env[key];
}

// Uses process.execPath (absolute path to the running node) instead of relying on PATH resolution.
// spawnSync (not execFileSync) so stderr is captured even when the child exits 0 — the demo path
// only warns, and that warning is exactly what the lenient cases assert.
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
  // a. Sin VERCEL_ENV ni SUPABASE_BUILD_STRICT y sin credenciales: comportamiento demo (exit 0).
  {
    const demo = runBuild({});
    assert.equal(demo.status, 0, 'sin flag estricto el build nunca debe fallar (regla 5)');
    assert.match(demo.stderr, /modo demo/i, 'debe advertir que dist/ queda en modo demo');
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(html.includes(CONFIG_MARKER), false, 'la ruta demo no debe inyectar config de Supabase');
  }

  // a'. VERCEL_ENV=preview sin SUPABASE_BUILD_STRICT y sin credenciales: sigue en modo demo (exit 0).
  {
    const preview = runBuild({ VERCEL_ENV: 'preview' });
    assert.equal(preview.status, 0, 'un preview sin flag estricto no debe fallar');
    assert.match(preview.stderr, /modo demo/i, 'un preview sin credenciales debe advertir modo demo');
  }

  // b. VERCEL_ENV=production sin credenciales: build estricto automático, falla y nombra faltantes.
  {
    const production = runBuild({ VERCEL_ENV: 'production' });
    assert.notEqual(production.status, 0, 'VERCEL_ENV=production debe activar el build estricto');
    assert.match(production.stderr, /Build estricto/, 'debe indicar que es el build estricto');
    assert.match(production.stderr, /SUPABASE_URL/, 'debe nombrar exactamente SUPABASE_URL');
    assert.match(production.stderr, /SUPABASE_ANON_KEY/, 'debe nombrar exactamente SUPABASE_ANON_KEY');
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(html.includes(CONFIG_MARKER), false, 'un build estricto fallido no debe escribir la config de Supabase');
  }

  // c. SUPABASE_BUILD_STRICT=true sin credenciales: también falla y nombra faltantes.
  {
    const strictFlag = runBuild({ SUPABASE_BUILD_STRICT: 'true' });
    assert.notEqual(strictFlag.status, 0, 'SUPABASE_BUILD_STRICT=true debe activar el build estricto');
    assert.match(strictFlag.stderr, /Build estricto/, 'debe indicar que es el build estricto');
    assert.match(strictFlag.stderr, /SUPABASE_URL/);
    assert.match(strictFlag.stderr, /SUPABASE_ANON_KEY/);
  }

  // d. Strict sin SUPABASE_URL: falla y nombra solo la variable realmente faltante.
  {
    const strictMissingUrl = runBuild({
      SUPABASE_BUILD_STRICT: 'true',
      SUPABASE_ANON_KEY: 'anon-key-ficticia-de-prueba'
    });
    assert.notEqual(strictMissingUrl.status, 0, 'build estricto sin SUPABASE_URL debe fallar');
    assert.match(strictMissingUrl.stderr, /SUPABASE_URL/, 'debe nombrar exactamente SUPABASE_URL');
    assert.doesNotMatch(strictMissingUrl.stderr, /SUPABASE_ANON_KEY/, 'no debe nombrar una variable que sí está presente');
  }

  // e. Strict con ambas variables (ficticias): exit 0 y config inyectada.
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

  // e'. VERCEL_ENV=production con ambas variables (ficticias): exit 0 y config inyectada.
  {
    const productionOk = runBuild({
      VERCEL_ENV: 'production',
      SUPABASE_URL: 'https://staging.invalid',
      SUPABASE_ANON_KEY: 'anon-key-ficticia-de-prueba'
    });
    assert.equal(productionOk.status, 0, 'producción con ambas variables debe terminar con exit 0');
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(html.includes(CONFIG_MARKER), true, 'producción correcta debe inyectar la config');
  }

  console.log('build-frontend-config tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

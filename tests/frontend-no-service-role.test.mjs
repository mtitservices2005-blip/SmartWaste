// SW-072 (CA1): pre-launch security gate proving a Supabase service-role credential never reaches
// the shipped frontend or the built dist/ artifact.
//
// ---------------------------------------------------------------------------------------------
// SCAN POLICY (what is — and is not — a finding)
// ---------------------------------------------------------------------------------------------
// Scope: text files (see TEXT_EXTENSIONS) discovered recursively under frontend/, dist/ and
// mobile/ (sources), plus the artifact the mobile build actually packages into mobile/www/. Files
// with any other extension (images, fonts, wasm, ...) are skipped as binary. node_modules/.git
// subtrees are skipped. Only these trees are scanned: comments/prose OUTSIDE them (docs,
// specs, shared/, tests) are deliberately out of scope and never reported.
//
// Inside the scanned trees the current sources legitimately contain the LITERAL string
// "service_role" in defensive comments — e.g. frontend/auth-gate.js ("never a service_role key
// here") and frontend/app.js ("never touches service_role"). A test that flagged mere mentions
// would fail on today's clean code, so the policy detects dangerous VALUES/USES, not words:
//
//   R1 — SERVICE-ROLE KEY BOUND TO A VALUE (in code, comments stripped first):
//        * the unambiguous identifier SUPABASE_SERVICE_ROLE_KEY (or any *SERVICE_ROLE_KEY
//          identifier) appearing in code, or
//        * a service-role name (service_role / service-role / serviceRole, optionally with a
//          _key/-key/Key suffix, optionally quoted as a JSON/JS property) immediately followed by
//          an assignment `=` or property separator `:` and a value.
//        Line / block / HTML comments are removed before R1 runs, so the defensive prose above is
//        not a finding; a real `SUPABASE_SERVICE_ROLE_KEY = '...'` or `"service_role": "..."` is.
//
//   R2 — JWT SHAPED LIKE A REAL SUPABASE TOKEN (raw text, comments INCLUDED):
//        any `eyJ...` three-segment base64url JWT. Supabase anon/service keys are JWTs; this repo
//        keeps the anon key out of source and injects it only at build time. A leaked token is a
//        leaked token even inside a comment, so R2 is intentionally not comment-stripped — the
//        safe default for a pre-launch gate. (No eyJ literal exists in the tree today.)
//
// The scanner is proven to actually reject poison: fictional safe + malicious fixtures are
// written to an isolated OS temp dir (never inside frontend/ or dist/) and the malicious ones must
// be reported. All fixtures are deleted in finally.
//
// The current frontend/, a freshly built dist/, mobile/ sources, and the freshly built mobile/www/
// bundle must yield ZERO findings; the test prints a clear summary and exits 0.
// ---------------------------------------------------------------------------------------------
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND_DIR = join(ROOT, 'frontend');
const DIST_DIR = join(ROOT, 'dist');
const MOBILE_DIR = join(ROOT, 'mobile');
const MOBILE_WWW_DIR = join(MOBILE_DIR, 'www');
const BUILD_SCRIPT = fileURLToPath(new URL('../scripts/build-frontend-config.mjs', import.meta.url));
const MOBILE_BUILD_SCRIPT = fileURLToPath(new URL('../mobile/scripts/build-web.mjs', import.meta.url));
const INDEX_HTML = join(DIST_DIR, 'index.html');
const MOBILE_INDEX_HTML = join(MOBILE_WWW_DIR, 'index.html');

// Only these extensions are treated as scannable text. Everything else (png/svg binary content,
// woff, wasm, ...) is skipped so we never read a binary blob as utf8.
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.json', '.txt', '.md',
  '.svg', '.map', '.webmanifest', '.xml', '.yml', '.yaml'
]);
const SKIP_DIRS = new Set(['node_modules', '.git']);

// A Supabase JWT: header starts with eyJ (base64url of '{"'), three dot-separated base64url
// segments. Requires real segment lengths so a stray "eyJ." isn't flagged.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;

// R1a: an identifier that can only be a service-role key name.
const SERVICE_ROLE_KEY_IDENTIFIER_RE = /\b[A-Z0-9_]*SERVICE_ROLE_KEY\b/i;
// R1b: a service-role name bound to a value via `=` or `:` (quoted property names included).
const SERVICE_ROLE_ASSIGNMENT_RE =
  /(?:service[_-]?role(?:[_-]?key)?|serviceRole(?:Key)?)["']?\s*[:=]\s*["'`A-Za-z0-9_$]/i;

/**
 * Removes // line comments, /* block comments *\/ and <!-- HTML comments -->, while preserving
 * string/template-literal contents (so `https://...` inside a string is not mistaken for a
 * comment). Comment characters are replaced with spaces to keep offsets roughly aligned.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { out += source[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '<' && source.startsWith('<!--', i)) {
      while (i < n && !source.startsWith('-->', i)) { out += source[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '   '; i += 3; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const s = source[i];
        if (s === '\\') { out += s; if (i + 1 < n) { out += source[i + 1]; i += 2; continue; } i++; continue; }
        out += s; i++;
        if (s === quote) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * Scans one file's text and returns an array of findings. `filePath` is only used for messages.
 */
export function scanContent(content, filePath = '<mem>') {
  const findings = [];
  const code = stripComments(content);

  // R2 on RAW content (comments included) — a leaked token is a leaked token.
  const jwt = content.match(JWT_RE);
  if (jwt) findings.push({ file: filePath, rule: 'R2-jwt', detail: `JWT-shaped value ${jwt[0].slice(0, 12)}…` });

  // R1 on comment-stripped CODE.
  const keyIdentifier = code.match(SERVICE_ROLE_KEY_IDENTIFIER_RE);
  if (keyIdentifier) findings.push({ file: filePath, rule: 'R1-service-role-key', detail: `identifier ${keyIdentifier[0]}` });
  const assignment = code.match(SERVICE_ROLE_ASSIGNMENT_RE);
  if (assignment) findings.push({ file: filePath, rule: 'R1-service-role-assignment', detail: assignment[0].trim() });

  return findings;
}

/**
 * Recursively scans `rootDir` for text files and returns every finding.
 */
export function scanTree(rootDir, skipDirs = SKIP_DIRS) {
  const findings = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        const full = join(dir, entry.name);
        // Guard against reading anything unexpectedly large/binary as text.
        if (statSync(full).size > 5 * 1024 * 1024) continue;
        findings.push(...scanContent(readFileSync(full, 'utf8'), full));
      }
    }
  };
  if (existsSync(rootDir)) walk(rootDir);
  return findings;
}

// ---------------------------------------------------------------------------------------------
// Build dist/ reproducibly: run the real build script as an isolated child process with an
// explicit, fictional env. The test process' own environment is deliberately NOT inherited, so a
// stray real SUPABASE_* var on the machine can never leak into (or mask) the artifact.
// ---------------------------------------------------------------------------------------------
const BASE_ENV = {};
for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP']) {
  if (process.env[key]) BASE_ENV[key] = process.env[key];
}
// Fictional, explicitly non-service-role values. Plain anon strings, NOT eyJ JWTs, so the config
// block the build injects into dist/index.html is representative yet obviously not a secret.
const BUILD_ENV = {
  ...BASE_ENV,
  SUPABASE_URL: 'https://frontend-scan.invalid',
  SUPABASE_ANON_KEY: 'anon-key-ficticia-de-prueba-sw072'
};

// SW-074 (CA5): the mobile bundle must be proven clean too — Claude's review flagged that the test
// scanned mobile/ SOURCES but never the artifact actually packaged by Capacitor into mobile/www/.
// Mirror the dist/ control exactly: run the real mobile build (mobile/scripts/build-web.mjs) in an
// isolated child process with an explicit, fictional env, then scan the generated bundle.
//
// The mobile build needs esbuild + @capacitor/core from mobile/node_modules (see mobile/package.json).
// tests.yml's dependency-free unit job does NOT install them; the Android APK workflow
// (.github/workflows/android-test-apk.yml) runs `npm ci` inside mobile/ before this very test. So the
// packaged-bundle pass runs wherever the mobile toolchain is present (Android workflow, local dev
// after `cd mobile && npm ci`) and is reported — never silently claimed — when it is not.
const MOBILE_BUILD_ENV = {
  ...BASE_ENV,
  SUPABASE_URL: 'https://mobile-scan.invalid',
  SUPABASE_ANON_KEY: 'anon-key-ficticia-mobile-sw074'
};

function mobileToolchainAvailable() {
  const require = createRequire(import.meta.url);
  try {
    require.resolve('esbuild', { paths: [MOBILE_DIR] });
    require.resolve('@capacitor/core', { paths: [MOBILE_DIR] });
    return true;
  } catch {
    return false;
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'sw072-scan-'));

try {
  const build = spawnSync(process.execPath, [BUILD_SCRIPT], { env: BUILD_ENV, encoding: 'utf8' });
  assert.equal(build.status, 0, `el build de frontend debe terminar con exit 0 (stderr: ${build.stderr})`);
  assert.ok(existsSync(DIST_DIR), 'el build debe producir dist/');
  assert.ok(existsSync(INDEX_HTML), 'el build debe producir dist/index.html');

  // a. El estado actual del repo no debe tener hallazgos: frontend/ (fuentes), dist/ (recién
  // construido con env ficticio) y mobile/ (fuentes). scanTree() trata un directorio ausente como
  // vacío, así que la puerta sigue activa sin depender de que exista mobile/.
  const sourceTargets = [
    ['frontend/', FRONTEND_DIR, SKIP_DIRS],
    ['dist/', DIST_DIR, SKIP_DIRS],
    // mobile/ sources, excluding the generated www/ bundle which is scanned separately below.
    ['mobile/', MOBILE_DIR, new Set([...SKIP_DIRS, 'www'])]
  ];
  for (const [label, dir, skipDirs] of sourceTargets) {
    const findings = scanTree(dir, skipDirs);
    assert.equal(
      findings.length,
      0,
      `${label} no debe contener service_role ni JWT: ${JSON.stringify(findings, null, 2)}`
    );
  }

  // a'. SW-074 (CA5): build the real mobile bundle and scan the packaged artifact itself. The build
  // runs as an isolated child with an explicit, fictional env (never the test process' full
  // environment), exactly like the dist/ control above.
  const mobileBundleBuilt = mobileToolchainAvailable();
  if (mobileBundleBuilt) {
    const mobileBuild = spawnSync(process.execPath, [MOBILE_BUILD_SCRIPT], {
      env: MOBILE_BUILD_ENV,
      cwd: MOBILE_DIR,
      encoding: 'utf8'
    });
    assert.equal(
      mobileBuild.status,
      0,
      `el build del bundle móvil debe terminar con exit 0 (stderr: ${mobileBuild.stderr})`
    );
    assert.ok(existsSync(MOBILE_INDEX_HTML), 'el build móvil debe producir mobile/www/index.html');
    assert.ok(
      existsSync(join(MOBILE_WWW_DIR, 'native-background-geolocation.js')),
      'el build móvil debe producir el bundle nativo de geolocalización en mobile/www/'
    );

    // Prove the scanned artifact is the real, config-injected bundle (fictional anon key), not a
    // stale or empty directory — and that no secret was injected instead.
    const mobileIndex = readFileSync(MOBILE_INDEX_HTML, 'utf8');
    assert.match(
      mobileIndex,
      /SMARTWASTE_SUPABASE_CONFIG/,
      'el bundle móvil debe incluir el bloque de config inyectado en build time'
    );
    assert.match(
      mobileIndex,
      /anon-key-ficticia-mobile-sw074/,
      'el bundle móvil debe llevar la anon key ficticia inyectada, no un secreto real'
    );

    const bundleFindings = scanTree(MOBILE_WWW_DIR);
    assert.equal(
      bundleFindings.length,
      0,
      `mobile/www/ (bundle empaquetado) no debe contener service_role ni JWT: ${JSON.stringify(bundleFindings, null, 2)}`
    );
  }

  // b. Fixture SAFE: la mención defensiva en un comentario NO es un hallazgo.
  const safeDir = join(tempDir, 'safe');
  mkdirSync(safeDir, { recursive: true });
  writeFileSync(
    join(safeDir, 'config.js'),
    [
      '// Defensive note only: never ship a service_role key from the frontend.',
      'export const anonKey = "anon-key-ficticia-de-prueba";',
      'const cfg = { url: "https://example.invalid" }; // service_role is not used here',
      ''
    ].join('\n')
  );
  assert.deepEqual(scanTree(safeDir), [], 'una mención defensiva en comentario no debe reportarse');

  // c. Fixture MALICIOSO 1 (R1): SUPABASE_SERVICE_ROLE_KEY con valor ficticio (no real).
  const poisonKey = join(tempDir, 'poison-key');
  mkdirSync(poisonKey, { recursive: true });
  writeFileSync(
    join(poisonKey, 'leak.js'),
    'window.SMARTWASTE_SUPABASE_CONFIG.SUPABASE_SERVICE_ROLE_KEY = "sin-valor-real-fixture";\n'
  );
  const keyFindings = scanTree(poisonKey);
  assert.ok(keyFindings.length > 0, 'R1 debe rechazar una SUPABASE_SERVICE_ROLE_KEY con valor');

  // c'. Fixture MALICIOSO 2 (R1): service_role como propiedad JSON/JS con valor.
  const poisonProp = join(tempDir, 'poison-prop');
  mkdirSync(poisonProp, { recursive: true });
  writeFileSync(join(poisonProp, 'config.json'), '{ "service_role": "fixture-no-real" }\n');
  assert.ok(scanTree(poisonProp).length > 0, 'R1 debe rechazar una propiedad service_role con valor');

  // d. Fixture MALICIOSO 3 (R2): JWT con forma eyJ... (segmentos ficticios, no un token real).
  const poisonJwt = join(tempDir, 'poison-jwt');
  mkdirSync(poisonJwt, { recursive: true });
  const fakeJwt = 'eyJmaWN0aWNpbyI6dHJ1ZX0.ZmFrZS1wYXlsb2FkLW5vLXJlYWw.ZmFrZS1zaWc';
  writeFileSync(join(poisonJwt, 'token.js'), `const leaked = "${fakeJwt}";\n`);
  const jwtFindings = scanTree(poisonJwt);
  assert.ok(jwtFindings.some((f) => f.rule === 'R2-jwt'), 'R2 debe rechazar un JWT con forma eyJ...');

  console.log('frontend-no-service-role ok');
  console.log(`  · built dist/ (env ficticio explícito) y escaneado frontend/ + dist/ + mobile/ (fuentes): 0 hallazgos`);
  if (mobileBundleBuilt) {
    console.log(`  · built mobile/www/ (env ficticio explícito) y escaneado el bundle empaquetado mobile/www/: 0 hallazgos`);
  } else {
    console.warn(
      `  · mobile/www/: bundle empaquetado NO escaneado en este entorno — falta la toolchain móvil ` +
      `(esbuild + @capacitor/core en mobile/node_modules).`
    );
    console.warn(
      `    Instala las dependencias con \`cd mobile && npm ci\` o ejecuta el workflow Android para cubrir CA5.`
    );
  }
  console.log(`  · política: R1 service_role con valor / identificador *_SERVICE_ROLE_KEY (código, comentarios excluidos); R2 JWT eyJ... (cualquier parte)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

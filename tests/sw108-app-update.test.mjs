// SW-108: descarga directa del APK (fuera de Play) y aviso de nueva versión en la app del conductor.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseManifest, isNewerBuild, resolveApkUrl, createUpdateChecker, UPDATE_CHECK_INTERVAL_MS } from '../shared/app-update.js';
import { createDriverController } from '../frontend/driver-app.js';
import { renderUpdateBanner, renderDriverToday } from '../frontend/components/driver-screens.js';
import { resolveUpdateManifestUrl } from '../mobile/scripts/backend-config.mjs';
import { buildManifest, parseArgs, APK_NAME } from '../scripts/publish-apk.mjs';

const r = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const HASH = 'a'.repeat(64);

// --- parseManifest ---
assert.equal(parseManifest(null).ok, false);
assert.equal(parseManifest({ versionName: '1.0.1' }).ok, false, 'sin versionCode');
assert.equal(parseManifest({ versionCode: 1.5, versionName: '1' }).ok, false, 'versionCode no entero');
assert.equal(parseManifest({ versionCode: 5, versionName: '  ' }).ok, false, 'versionName vacío');
const ok = parseManifest({ versionCode: '2026103102', versionName: '1.0.1', sha256: HASH.toUpperCase(), notes: 'x'.repeat(500), sizeBytes: 1000, publishedAt: '2026-10-31T10:00:00Z' });
assert.ok(ok.ok); assert.equal(ok.manifest.versionCode, 2026103102); assert.equal(ok.manifest.apkUrl, APK_NAME, 'apkUrl por defecto');
assert.equal(ok.manifest.sha256, HASH, 'sha256 en minúsculas'); assert.equal(ok.manifest.notes.length, 200, 'notas recortadas');
assert.equal(parseManifest({ versionCode: 1, versionName: '1', sha256: 'zz' }).manifest.sha256, null, 'sha256 mal formado se ignora');

// --- isNewerBuild / resolveApkUrl ---
assert.equal(isNewerBuild(2026103101, 2026103102), true);
assert.equal(isNewerBuild(2026103102, 2026103102), false, 'igual no avisa');
assert.equal(isNewerBuild(2026103103, 2026103102), false, 'instalada más nueva no avisa');
assert.equal(isNewerBuild(NaN, 5), false); assert.equal(isNewerBuild(5, undefined), false);
const base = 'https://sitio.example/downloads/version.json';
assert.equal(resolveApkUrl({ apkUrl: APK_NAME }, base), 'https://sitio.example/downloads/SmartWaste-Conductor.apk');
assert.equal(resolveApkUrl({ apkUrl: 'http://evil.example/a.apk' }, base), null, 'solo https');
assert.equal(resolveApkUrl({ apkUrl: 'https://cdn.example/a.apk' }, base), 'https://cdn.example/a.apk');

// --- createUpdateChecker ---
function checkerWith({ build = 100, manifest = { versionCode: 101, versionName: '1.0.1', notes: 'Mejoras de GPS' }, fail = false } = {}) {
  let t = 1_000_000; const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (fail) throw new Error('offline'); return { ok: true, json: async () => manifest }; };
  const checker = createUpdateChecker({ manifestUrl: base, fetchImpl, getCurrentBuild: async () => build, now: () => t });
  return { checker, calls, advance: (ms) => { t += ms; } };
}
let k = checkerWith();
const found = await k.checker.check();
assert.deepEqual(found, { versionCode: 101, versionName: '1.0.1', notes: 'Mejoras de GPS', apkUrl: 'https://sitio.example/downloads/SmartWaste-Conductor.apk' });
assert.match(k.calls[0], /version\.json\?t=\d+$/, 'evita la caché con un parámetro');
await k.checker.check(); assert.equal(k.calls.length, 1, 'no vuelve a consultar antes de 6 horas');
k.advance(UPDATE_CHECK_INTERVAL_MS + 1); await k.checker.check(); assert.equal(k.calls.length, 2, 'consulta de nuevo pasadas 6 horas');
assert.equal(await checkerWith({ build: 101 }).checker.check(), null, 'misma versión: sin aviso');
assert.equal(await checkerWith({ build: 102 }).checker.check(), null, 'instalada más nueva: sin aviso');
assert.equal(await checkerWith({ fail: true }).checker.check(), null, 'sin internet: silencio');
assert.equal(await checkerWith({ manifest: { versionName: 'x' } }).checker.check(), null, 'manifiesto roto: silencio');
assert.equal(await createUpdateChecker({ manifestUrl: '', fetchImpl: async () => { throw new Error('no debe llamarse'); }, getCurrentBuild: async () => 1 }).check(), null, 'sin URL: no hace nada');
assert.equal(await createUpdateChecker({ manifestUrl: 'http://x/v.json', fetchImpl: async () => { throw new Error('no'); }, getCurrentBuild: async () => 1 }).check(), null, 'solo https');
k = checkerWith(); await k.checker.check(); k.checker.dismiss(101);
assert.equal(await k.checker.check({ force: true }), null, '"Después" oculta esa versión hasta la próxima apertura');

// --- banner y pantalla Hoy ---
const banner = renderUpdateBanner({ versionName: '1.0.1<b>', notes: 'Mejoras' });
assert.ok(banner.includes('data-driver-update-open') && banner.includes('data-driver-update-dismiss'));
assert.ok(banner.includes('1.0.1&lt;b&gt;') && !banner.includes('<b>'), 'versión escapada');
assert.ok(!renderDriverToday({ routes: [] }).includes('data-driver-update-open'), 'sin actualización: sin banner');
assert.ok(renderDriverToday({ routes: [], update: { versionName: '1.0.1' } }).includes('data-driver-update-open'));

// --- controlador: el aviso nunca interrumpe una ruta ---
const NOW = new Date('2026-10-31T12:00:00Z');
const run = { id: 'run1', routeId: 'r1', vehicleId: 'v1', status: 'assigned', createdAt: '2026-10-30T10:00:00Z', scheduledStartAt: '2026-10-31T12:30:00Z', startedAt: null, routeName: 'Ruta Centro', stopsCount: 1, stops: [{ sequence: 1, label: 'Duarte 10', latitude: 19, longitude: -71 }], distanceText: '389 m', estimatedMinutes: null };
function driver({ updateResult = { versionCode: 101, versionName: '1.0.1', notes: '', apkUrl: 'https://sitio.example/downloads/SmartWaste-Conductor.apk' }, runs = [run] } = {}) {
  const log = []; const draws = []; const gps = { active: false, start: async () => { gps.active = true; }, stop: async () => { gps.active = false; }, isActive: () => gps.active };
  const adapter = { startRoute: async () => ({ ok: true, data: { started_at: NOW.toISOString() } }), completeRoute: async () => ({ ok: true }), findOwnVehicleAssignment: async () => ({ ok: true, data: null }), logFuel: async () => ({ ok: true }) };
  const update = { check: async () => { log.push('check'); return updateResult; }, dismiss: (c) => log.push(['dismiss', c]), open: async (u) => log.push(['open', u]) };
  const c = createDriverController({ load: async () => ({ ok: true, driver: { id: 'd1', display_name: 'Carlos Peña' }, unit: 'C-01', runs }), adapter, gps, update, municipalityId: 'm1', userId: 'u1', draw: (screen, html) => draws.push({ screen, html }), now: () => NOW });
  return { c, log, draws, gps };
}
let d = driver(); await d.c.refresh(); await d.c.checkUpdate();
assert.ok(d.draws.at(-1).html.includes('data-driver-update-open'), 'Hoy muestra el aviso');
await d.c.action('update-open'); assert.deepEqual(d.log.at(-1), ['open', 'https://sitio.example/downloads/SmartWaste-Conductor.apk']);
await d.c.action('update-dismiss'); assert.deepEqual(d.log.at(-1), ['dismiss', 101]); assert.ok(!d.draws.at(-1).html.includes('data-driver-update-open'), '"Después" oculta el aviso');
d = driver(); await d.c.refresh(); await d.c.action('start', 'run1'); d.log.length = 0;
await d.c.checkUpdate(); assert.deepEqual(d.log, [], 'con ruta en curso ni siquiera consulta');
assert.ok(!d.draws.at(-1).html.includes('data-driver-update-open'), 'En ruta nunca muestra el aviso');
d = driver({ updateResult: null }); await d.c.refresh(); await d.c.checkUpdate(); assert.ok(!d.draws.at(-1).html.includes('data-driver-update-open'), 'sin versión nueva: sin banner');
const failing = createDriverController({ load: async () => ({ ok: true, driver: { id: 'd1', display_name: 'C' }, unit: 'C-01', runs: [] }), adapter: {}, gps: { isActive: () => false }, update: { check: async () => { throw new Error('boom'); } }, draw: () => {}, now: () => NOW });
await failing.refresh(); await assert.doesNotReject(() => failing.checkUpdate());

// --- build móvil: URL del manifiesto ---
assert.equal(resolveUpdateManifestUrl({}), null, 'sin variable: sin aviso');
assert.equal(resolveUpdateManifestUrl({ SMARTWASTE_UPDATE_BASE_URL: ' https://sitio.example/ ' }), 'https://sitio.example/downloads/version.json');
assert.throws(() => resolveUpdateManifestUrl({ SMARTWASTE_UPDATE_BASE_URL: 'http://sitio.example' }), /https/);
assert.match(r('mobile/scripts/build-web.mjs'), /SMARTWASTE_APP_UPDATE_URL/);
const wf = r('.github/workflows/android-release-apk.yml');
assert.match(wf, /SMARTWASTE_UPDATE_BASE_URL: \$\{\{ vars\.SMARTWASTE_UPDATE_BASE_URL \}\}/, 'el workflow pasa la URL pública');
assert.match(wf, /tests\/sw108-app-update\.test\.mjs/, 'el workflow corre esta prueba');

// --- sitio: ruta, cabeceras y copia de downloads/ ---
const vercel = JSON.parse(r('vercel.json'));
assert.ok(vercel.rewrites.some((x) => x.source === '/descargar' && x.destination === '/descargar.html'));
const hdr = (src) => vercel.headers.find((h) => h.source === src)?.headers ?? [];
assert.ok(hdr('/downloads/version.json').some((h) => h.key === 'Access-Control-Allow-Origin' && h.value === '*'), 'CORS para que la app lea el manifiesto');
assert.ok(vercel.headers.some((h) => h.source.includes('.apk') && h.headers.some((x) => x.value === 'application/vnd.android.package-archive')), 'tipo MIME del APK');
assert.match(r('scripts/build-frontend-config.mjs'), /downloads/, 'el build copia downloads/ a dist/');
const page = r('frontend/descargar.html');
assert.ok(page.includes('downloads/version.json') && page.includes('downloads/SmartWaste-Conductor.apk') && page.includes('Play Protect'));
assert.ok(!/<script[^>]+src=/.test(page), 'la página no carga scripts externos');

// --- publish-apk ---
assert.deepEqual(parseArgs(['--apk', 'a.apk', '--version-name', '1.0.1']), { apk: 'a.apk', 'version-name': '1.0.1' });
assert.throws(() => parseArgs(['--apk']), /Falta el valor/); assert.throws(() => parseArgs(['x']), /inesperado/);
const m = buildManifest({ versionName: '1.0.1', versionCode: '2026103102', notes: 'Hola', sha256: HASH, sizeBytes: 10, now: new Date('2026-10-31T10:00:00Z') });
assert.deepEqual(m, { versionName: '1.0.1', versionCode: 2026103102, apkUrl: APK_NAME, sha256: HASH, sizeBytes: 10, notes: 'Hola', publishedAt: '2026-10-31T10:00:00.000Z' });
assert.ok(parseManifest(m).ok, 'lo que escribe el script lo entiende la app');
assert.throws(() => buildManifest({ versionName: '', versionCode: 5, sha256: HASH, sizeBytes: 1 }), /version-name/);
assert.throws(() => buildManifest({ versionName: '1', versionCode: 'abc', sha256: HASH, sizeBytes: 1 }), /version-code/);
assert.throws(() => buildManifest({ versionName: '1', versionCode: 2200000000, sha256: HASH, sizeBytes: 1 }), /version-code/);
const tmp = mkdtempSync(join(tmpdir(), 'sw108-'));
try {
  const aab = join(tmp, 'app.aab'); writeFileSync(aab, 'x');
  assert.throws(() => execFileSync('node', ['scripts/publish-apk.mjs', '--apk', aab, '--version-name', '1', '--version-code', '5'], { stdio: 'pipe' }), /Command failed/, 'rechaza archivos que no son .apk');
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log('sw108-app-update OK');

// SW-083 Task 10: APK de lanzamiento. El build falla claro si faltan las variables de Supabase, la firma
// sale de secretos (nunca del repositorio) y el APK se escanea en busca de service_role.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolveBackendConfig } from '../mobile/scripts/backend-config.mjs';

// --- Variables de Supabase en el build ---
assert.equal(resolveBackendConfig({}), null, 'sin variables y sin modo estricto: demo (como antes)');
assert.deepEqual(
  resolveBackendConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_HIDE_DEMO: 'true', SUPABASE_MUNICIPALITY_ID: 'm1' }),
  { url: 'https://x.supabase.co', anonKey: 'anon', municipality_id: 'm1', hideDemo: true }
);
assert.throws(() => resolveBackendConfig({ SUPABASE_URL: 'https://x.supabase.co' }), /SUPABASE_URL.*SUPABASE_ANON_KEY.*juntas/i);
assert.throws(() => resolveBackendConfig({ SMARTWASTE_REQUIRE_BACKEND: 'true' }), /SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias/);
assert.throws(() => resolveBackendConfig({ SMARTWASTE_REQUIRE_BACKEND: 'true', SUPABASE_URL: 'https://x.supabase.co' }), /SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias/);
assert.throws(() => resolveBackendConfig({ SMARTWASTE_REQUIRE_BACKEND: 'true', SUPABASE_URL: '   ', SUPABASE_ANON_KEY: 'k' }), /obligatorias/);
assert.ok(resolveBackendConfig({ SMARTWASTE_REQUIRE_BACKEND: 'true', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' }));
assert.throws(() => resolveBackendConfig({ SUPABASE_URL: 'http://x.supabase.co', SUPABASE_ANON_KEY: 'k', SMARTWASTE_REQUIRE_BACKEND: 'true' }), /https/, 'en lanzamiento la URL debe ser https');

// --- Firma desde secretos ---
const gradle = readFileSync('mobile/android/app/build.gradle', 'utf8');
assert.match(gradle, /signingConfigs\s*\{/);
assert.match(gradle, /System\.getenv\('ANDROID_KEYSTORE_PATH'\)/);
for (const name of ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.match(gradle, new RegExp(`System\\.getenv\\('${name}'\\)`), name);
assert.match(gradle, /release\s*\{[\s\S]*signingConfig\s+signingConfigs\.release/, 'el tipo release usa la firma de lanzamiento');
assert.doesNotMatch(gradle, /storePassword\s+['"][^'"]+['"]/, 'ninguna contraseña escrita en el repositorio');

// Regresión (CI del PR de SW-083): en Groovy `versionCode (x).toInteger()` se lee como `versionCode(x).toInteger()`
// y falla con "Value is null". La conversión debe quedar DENTRO del argumento, sin paréntesis tras el nombre.
assert.doesNotMatch(gradle, /version(Code|Name)\s*\(/, 'no usar versionCode (...)/versionName (...) con paréntesis separados');
assert.match(gradle, /versionCode\s+Integer\.parseInt\(System\.getenv\('ANDROID_VERSION_CODE'\) \?: '1'\)/);
assert.match(gradle, /versionName\s+System\.getenv\('ANDROID_VERSION_NAME'\) \?: '1\.0'/);

// --- Flujo de CI ---
const wfPath = '.github/workflows/android-release-apk.yml';
assert.ok(existsSync(wfPath), 'falta el flujo de APK de lanzamiento');
const wf = readFileSync(wfPath, 'utf8');
assert.match(wf, /workflow_dispatch:/);
assert.doesNotMatch(wf, /pull_request:|push:/, 'el APK firmado solo se genera a pedido, nunca en PR (los PR no ven secretos)');
for (const secret of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  assert.match(wf, new RegExp(`secrets\\.${secret}`), `usa el secreto ${secret}`);
}
assert.match(wf, /SMARTWASTE_REQUIRE_BACKEND:\s*'true'/, 'modo estricto del backend');
assert.match(wf, /assembleRelease/);
assert.match(wf, /apksigner"?\s+verify/, 'verifica la firma del APK');
assert.match(wf, /service_role/, 'escanea el APK final en busca de service_role');
assert.match(wf, /SUPABASE_HIDE_DEMO:\s*'true'/, 'el APK real no muestra textos de demo');
assert.doesNotMatch(wf, /eyJ[A-Za-z0-9_-]{20,}/, 'ninguna llave pegada en el flujo');
assert.match(wf, /Falta el secreto/, 'mensaje claro si falta un secreto');
console.log('mobile-release ok');

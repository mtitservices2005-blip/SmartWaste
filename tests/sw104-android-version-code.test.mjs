// SW-104: versionCode ascendente por fecha (no run_number, que es menor que lo ya instalado y que Play rechazaría).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = readFileSync('.github/workflows/android-release-apk.yml', 'utf8').replace(/\r\n/g, '\n');
assert.doesNotMatch(wf, /ANDROID_VERSION_CODE:\s*\$\{\{\s*github\.run_number\s*\}\}/, 'ya no usa run_number como versionCode');
assert.match(wf, /version_code:/, 'entrada opcional version_code');
assert.match(wf, /date -u \+%Y%m%d/, 'código calculado por fecha UTC');
assert.match(wf, /GITHUB_ENV/, 'se exporta ANDROID_VERSION_CODE al resto del flujo');
assert.match(wf, /2100000000/, 'se valida el límite de Android (2100000000)');
console.log('sw104-android-version-code OK');

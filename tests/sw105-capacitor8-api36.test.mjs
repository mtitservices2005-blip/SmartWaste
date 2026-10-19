// SW-105: Play exige apuntar a API 36 (desde 2026-08-31) y publicar .aab. Capacitor 8 es el que trae SDK 36.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const vars = r('mobile/android/variables.gradle');
assert.match(vars, /compileSdkVersion = 36/); assert.match(vars, /targetSdkVersion = 36/); assert.match(vars, /minSdkVersion = 24/);
assert.match(r('mobile/android/build.gradle'), /com\.android\.tools\.build:gradle:8\.13\.0/);
assert.match(r('mobile/android/gradle/wrapper/gradle-wrapper.properties'), /gradle-8\.14\.3-all\.zip/);
assert.match(r('mobile/android/app/src/main/AndroidManifest.xml'), /configChanges="[^"]*\|density"/, 'density en configChanges (Capacitor 8)');
const pkg = JSON.parse(r('mobile/package.json'));
for (const k of ['@capacitor/core', '@capacitor/android', '@capacitor/app', '@capacitor/browser', '@capacitor/local-notifications']) assert.match(pkg.dependencies[k], /^8\./, `${k} en 8.x`);
assert.match(pkg.devDependencies['@capacitor/cli'], /^8\./);
assert.equal(pkg.dependencies['@capacitor-community/background-geolocation'], '1.2.26', 'plugin de GPS sin cambios');
for (const f of ['android-release-apk.yml', 'android-test-apk.yml']) {
  const wf = r(`.github/workflows/${f}`);
  assert.match(wf, /platforms;android-36/, `${f}: plataforma 36`);
  assert.doesNotMatch(wf, /android-35|build-tools;35/, `${f}: sin SDK 35`);
}
const rel = r('.github/workflows/android-release-apk.yml');
assert.match(rel, /bundleRelease/, 'genera el .aab para Play');
assert.match(rel, /app-release\.aab/, 'sube el .aab');
assert.match(rel, /build-tools\/36\.0\.0\/apksigner/);
console.log('sw105-capacitor8-api36 OK');

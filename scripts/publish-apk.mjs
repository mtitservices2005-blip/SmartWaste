// SW-108: publica un APK para la descarga directa. Copia el archivo a downloads/SmartWaste-Conductor.apk y
// escribe downloads/version.json (versión, fecha, tamaño y SHA-256). Uso:
//   node scripts/publish-apk.mjs --apk <ruta.apk> --version-name 1.0.1 --version-code 2026103102 [--notes "Texto corto"]
// No firma ni compila nada; el APK ya viene firmado del workflow "Android release APK (signed)".
import { copyFileSync, createReadStream, mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APK_NAME = 'SmartWaste-Conductor.apk';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento inesperado: ${a}`);
    const key = a.slice(2); const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`Falta el valor de --${key}`);
    out[key] = val; i += 1;
  }
  return out;
}

export function buildManifest({ versionName, versionCode, notes = '', sha256, sizeBytes, now = new Date() }) {
  if (!versionName || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(versionName)) throw new Error('--version-name inválido (ejemplo: 1.0.1)');
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code <= 0 || code > 2100000000) throw new Error('--version-code debe ser un entero positivo (máximo 2100000000)');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('sha256 inválido');
  return { versionName, versionCode: code, apkUrl: APK_NAME, sha256, sizeBytes, notes: String(notes).trim().slice(0, 200), publishedAt: now.toISOString() };
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apk || !existsSync(args.apk)) throw new Error('--apk debe apuntar a un archivo existente');
  if (!/\.apk$/i.test(args.apk)) throw new Error('--apk debe ser un archivo .apk (no el .aab ni el .zip del artefacto)');
  const outDir = fileURLToPath(new URL('../downloads', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const sizeBytes = statSync(args.apk).size;
  const sha256 = await sha256File(args.apk);
  const manifest = buildManifest({ versionName: args['version-name'], versionCode: args['version-code'], notes: args.notes, sha256, sizeBytes });
  copyFileSync(args.apk, join(outDir, APK_NAME));
  writeFileSync(join(outDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Publicado ${manifest.versionName} (${manifest.versionCode}) · ${(sizeBytes / 1048576).toFixed(1)} MB · sha256 ${sha256}`);
  console.log('Siguiente paso: commit de downloads/, PR y merge; Vercel lo despliega solo.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
}

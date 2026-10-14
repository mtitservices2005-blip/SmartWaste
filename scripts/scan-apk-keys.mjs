// SW-083: escaneo de secretos en un APK ya descomprimido. Busca LLAVES, no la palabra "service_role"
// (que aparece en comentarios y documentación legítimos). Nunca imprime el valor encontrado.
//  - JWT cuyo payload tiene role = "service_role" (la llave real no lleva la palabra en texto plano).
//  - Identificador *_SERVICE_ROLE_KEY o "service_role" asignado a un valor largo.
// La anon key (JWT con role = "anon") SÍ va en el APK y no es hallazgo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const KEY_IDENTIFIER_RE = /[A-Z0-9_]*SERVICE_ROLE_KEY[A-Z0-9_]*["']?\s*[:=]\s*["'`]?[A-Za-z0-9_.\-]{20,}/;
const ROLE_ASSIGNED_RE = /service_role["']?\s*[:=]\s*["'`][A-Za-z0-9_.\-]{20,}/i;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload?.role ?? null;
  } catch { return null; }
}

export function scanDirectory(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    if (statSync(file).size > 64 * 1024 * 1024) continue;
    const text = readFileSync(file).toString('latin1');
    for (const token of text.match(JWT_RE) ?? []) {
      if (jwtRole(token) === 'service_role') findings.push({ file, reason: 'JWT con role=service_role' });
    }
    if (KEY_IDENTIFIER_RE.test(text)) findings.push({ file, reason: 'identificador *_SERVICE_ROLE_KEY con valor' });
    else if (ROLE_ASSIGNED_RE.test(text)) findings.push({ file, reason: 'service_role asignado a un valor largo' });
  }
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('Uso: node scripts/scan-apk-keys.mjs <carpeta-del-apk-descomprimido>'); process.exit(2); }
  const findings = scanDirectory(dir);
  for (const f of findings) console.error(`HALLAZGO: ${f.file} — ${f.reason}`);
  if (findings.length) { console.error('El APK contiene una posible llave service_role. No se publica.'); process.exit(1); }
  console.log('APK limpio: ninguna llave service_role (la anon key es esperada).');
}

// Local-only helper: seeds tests/integration/seed.mjs's scenario against a running local Supabase
// instance (npx supabase start), prints login credentials for each of the 5 roles, and writes the
// SMARTWASTE_SUPABASE_CONFIG <script> block directly into frontend/index.html (instead of relying
// on manual copy-paste of a 200+ char JWT, which a browser extension/password manager can corrupt
// on paste). Never touches a real/hosted Supabase project — loadLocalSupabaseEnv() only ever talks
// to `npx supabase status`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLocalSupabaseEnv, createServiceClient } from '../tests/integration/local-supabase-env.mjs';
import { seedScenario } from '../tests/integration/seed.mjs';

const INDEX_HTML_PATH = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const CONFIG_START = '<!-- SMARTWASTE_SUPABASE_CONFIG:START (generado por scripts/seed-local.mjs) -->';
const CONFIG_END = '<!-- SMARTWASTE_SUPABASE_CONFIG:END -->';

function stripPreviousConfigBlock(html) {
  const startIndex = html.indexOf(CONFIG_START);
  if (startIndex === -1) return html;
  const endIndex = html.indexOf(CONFIG_END, startIndex);
  if (endIndex === -1) return html;
  const afterEnd = endIndex + CONFIG_END.length;
  return html.slice(0, startIndex) + html.slice(afterEnd).replace(/^\n/, '');
}

function writeSupabaseConfigIntoIndexHtml(env) {
  const html = readFileSync(INDEX_HTML_PATH, 'utf8');
  const configBlock = `${CONFIG_START}
  <script>
    window.SMARTWASTE_SUPABASE_CONFIG = ${JSON.stringify({ url: env.API_URL, anonKey: env.ANON_KEY })};
  </script>
  ${CONFIG_END}
`;
  const withoutOldBlock = stripPreviousConfigBlock(html);
  const updated = withoutOldBlock.includes('<script type="module" src="./app.js">')
    ? withoutOldBlock.replace('<script type="module" src="./app.js">', `${configBlock}  <script type="module" src="./app.js">`)
    : withoutOldBlock;
  writeFileSync(INDEX_HTML_PATH, updated);
}

const env = loadLocalSupabaseEnv();
const service = createServiceClient(env);
const scenario = await seedScenario(service);

console.log('\n=== Credenciales de login (misma contraseña para todos) ===\n');
console.log(`Contraseña: ${scenario.adminA.password}\n`);
console.log(`municipal_admin (municipio A): ${scenario.adminA.email}`);
console.log(`dispatcher      (municipio A): ${scenario.dispatcherA.email}`);
console.log(`driver          (municipio A): ${scenario.driverUserA.email}`);
console.log(`supervisor      (municipio A): ${scenario.supervisorA.email}`);
console.log(`municipal_admin (municipio B): ${scenario.adminB.email}`);
console.log(`mt_superadmin                : ${scenario.superadmin.email}`);

writeSupabaseConfigIntoIndexHtml(env);
console.log('\nfrontend/index.html actualizado con la config de Supabase (sin copy-paste manual).');

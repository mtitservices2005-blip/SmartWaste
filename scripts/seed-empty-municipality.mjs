// Local-only helper: creates a fresh, empty municipality (just 1 municipal_admin, zero vehicles/
// choferes/rutas) against a running local Supabase instance (npx supabase start), so logging in as
// that admin triggers the SW-037 onboarding wizard in frontend/app.js (bootstrapRealBackend())
// instead of showing seeded demo-shaped data. Writes SMARTWASTE_SUPABASE_CONFIG directly into
// frontend/index.html, same as scripts/seed-local.mjs — never touches a real/hosted Supabase
// project, loadLocalSupabaseEnv() only ever talks to `npx supabase status`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLocalSupabaseEnv, createServiceClient } from '../tests/integration/local-supabase-env.mjs';
import { seedEmptyMunicipality } from '../tests/integration/seed.mjs';

const INDEX_HTML_PATH = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const CONFIG_START = '<!-- SMARTWASTE_SUPABASE_CONFIG:START (generado por scripts/seed-empty-municipality.mjs) -->';
const CONFIG_END = '<!-- SMARTWASTE_SUPABASE_CONFIG:END -->';

function stripPreviousConfigBlock(html) {
  const startIndex = html.indexOf('<!-- SMARTWASTE_SUPABASE_CONFIG:START');
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
const { municipality, admin } = await seedEmptyMunicipality(service);

console.log('\n=== Municipio vacío creado (sin vehículos/choferes/rutas) ===\n');
console.log(`Municipio: ${municipality.name} (${municipality.id})`);
console.log(`\nUsuario:    ${admin.email}`);
console.log(`Contraseña: ${admin.password}`);
console.log('\nAl iniciar sesión con este usuario debería aparecer el wizard de configuración inicial (SW-037), no los datos demo.');

writeSupabaseConfigIntoIndexHtml(env);
console.log('\nfrontend/index.html actualizado con la config de Supabase (sin copy-paste manual).');

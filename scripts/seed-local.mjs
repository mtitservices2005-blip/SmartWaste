// Local-only helper: seeds tests/integration/seed.mjs's scenario against a running local Supabase
// instance (npx supabase start) and prints login credentials for each of the 5 roles, plus the
// frontend/index.html <script> block to point the demo at this instance. Never touches a real/
// hosted Supabase project — loadLocalSupabaseEnv() only ever talks to `npx supabase status`.
import { loadLocalSupabaseEnv, createServiceClient } from '../tests/integration/local-supabase-env.mjs';
import { seedScenario } from '../tests/integration/seed.mjs';

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

console.log('\n=== Pegar en frontend/index.html, antes de <script type="module" src="./app.js"> ===\n');
console.log(`<script>
  window.SMARTWASTE_SUPABASE_CONFIG = {
    url: '${env.API_URL}',
    anonKey: '${env.ANON_KEY}'
  };
</script>\n`);

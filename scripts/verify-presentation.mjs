// SW-063: read-only readiness gate for the persistent presentation environment.
// It never uses service_role and never creates, updates, or deletes remote data.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const MUNICIPALITY_ID = process.env.SUPABASE_MUNICIPALITY_ID;
const PRESENTATION_URL = process.env.PRESENTATION_URL?.replace(/\/$/, '');
const PRESENTATION_EMAIL = process.env.PRESENTATION_EMAIL;
const PRESENTATION_PASSWORD = process.env.PRESENTATION_PASSWORD;

const missing = [
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'SUPABASE_ANON_KEY',
  !MUNICIPALITY_ID && 'SUPABASE_MUNICIPALITY_ID',
  !PRESENTATION_URL && 'PRESENTATION_URL',
  !PRESENTATION_EMAIL && 'PRESENTATION_EMAIL',
  !PRESENTATION_PASSWORD && 'PRESENTATION_PASSWORD'
].filter(Boolean);
if (missing.length) throw new Error(`Faltan variables requeridas: ${missing.join(', ')}.`);

for (const [name, value] of [['SUPABASE_URL', SUPABASE_URL], ['PRESENTATION_URL', PRESENTATION_URL]]) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} no es una URL valida.`); }
  if (parsed.protocol !== 'https:') throw new Error(`${name} debe usar https:// para la presentacion.`);
}

const anonHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
};

async function expectOk(label, url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), ...options });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${label}: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
  }
  console.log(`OK  ${label}`);
  return response;
}

await expectOk('Supabase Auth', `${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY } });
await expectOk(
  'Esquema SW-062 (metricas GPS)',
  `${SUPABASE_URL}/rest/v1/route_runs?select=id,gps_points_count,gps_started_at,gps_ended_at&limit=0`,
  { headers: anonHeaders }
);
await expectOk(
  'Tabla de puntos GPS',
  `${SUPABASE_URL}/rest/v1/vehicle_positions?select=id,municipality_id,vehicle_id,route_run_id,captured_at&limit=0`,
  { headers: anonHeaders }
);
const sectorsResponse = await expectOk(
  'Dataset publico del municipio',
  `${SUPABASE_URL}/rest/v1/sectors?select=id&municipality_id=eq.${encodeURIComponent(MUNICIPALITY_ID)}&status=eq.active&limit=1`,
  { headers: anonHeaders }
);
const sectors = await sectorsResponse.json();
if (!Array.isArray(sectors) || sectors.length === 0) {
  throw new Error('Dataset publico del municipio: no existe ningun sector activo visible para el portal ciudadano.');
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const login = await client.auth.signInWithPassword({ email: PRESENTATION_EMAIL, password: PRESENTATION_PASSWORD });
if (login.error) throw new Error(`Login de ensayo: ${login.error.message}`);
console.log('OK  Login de ensayo');

const membership = await client.from('memberships').select('role,status')
  .eq('profile_id', login.data.user.id).eq('municipality_id', MUNICIPALITY_ID).eq('status', 'active').maybeSingle();
if (membership.error) throw new Error(`Membresia de ensayo: ${membership.error.message}`);
if (!membership.data || !['municipal_admin', 'dispatcher', 'supervisor'].includes(membership.data.role)) {
  throw new Error('Membresia de ensayo: la cuenta no tiene un rol operativo activo en el municipio configurado.');
}
console.log(`OK  Membresia de ensayo (${membership.data.role})`);

for (const [label, table] of [['vehiculo', 'vehicles'], ['chofer', 'drivers'], ['ruta', 'routes']]) {
  const result = await client.from(table).select('id', { count: 'exact', head: true }).eq('municipality_id', MUNICIPALITY_ID);
  if (result.error) throw new Error(`Dataset ${label}: ${result.error.message}`);
  if (!result.count) throw new Error(`Dataset ${label}: no existe ningun registro para la presentacion.`);
  console.log(`OK  Dataset ${label} (${result.count})`);
}

await client.auth.signOut();

const deployment = await expectOk('URL publica', PRESENTATION_URL);
const html = await deployment.text();
if (!html.includes('SMARTWASTE_SUPABASE_CONFIG')) {
  throw new Error('URL publica: el HTML no contiene configuracion Supabase; parece un build demo-only.');
}
if (!html.includes(SUPABASE_URL)) {
  throw new Error('URL publica: apunta a un proyecto Supabase diferente al verificado.');
}
if (!html.includes('"hideDemo":true')) {
  throw new Error('URL publica: SUPABASE_HIDE_DEMO=true no esta activo.');
}

console.log('\nREADY  El entorno paso las verificaciones tecnicas de SW-063.');
console.log('PENDIENTE  Ejecutar el ensayo funcional con login y GPS real desde el telefono.');

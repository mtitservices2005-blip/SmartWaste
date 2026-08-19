// SW-044 (verificación en staging): creates a fresh, EMPTY municipality (just 1 municipal_admin,
// zero vehicles/choferes/rutas) against a REMOTE Supabase project — the remote counterpart to
// scripts/seed-empty-municipality.mjs (which only ever talks to local Docker), same relationship
// scripts/seed-remote.mjs already has to scripts/seed-local.mjs.
//
// Logging in as this admin triggers bootstrapRealBackend()'s SW-037 onboarding wizard
// (frontend/app.js) — it hydrates 0 real vehicles/drivers/routes, so demo data is cleared entirely
// instead of being merged alongside it (frontend/app.js's "vacío real" branch, rule 5: never touch
// this behavior for a municipality that already has real data — only a genuinely empty one gets
// wiped). Existing municipalities seeded via scripts/seed-remote.mjs are untouched by this script.
//
// Reads SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY from this shell's environment — run it directly in
// your own terminal so the service_role key never gets typed into a chat with anyone, including an
// AI assistant helping you run this (CLAUDE.md rule 8).
import { createServiceClient } from '../tests/integration/local-supabase-env.mjs';
import { seedEmptyMunicipality } from '../tests/integration/seed.mjs';

const API_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!API_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. Ejecutá este script en tu propia terminal con esas variables seteadas — nunca le pases la service_role key a un asistente/chat.');
}

const service = createServiceClient({ API_URL, SERVICE_ROLE_KEY });
const { municipality, admin } = await seedEmptyMunicipality(service);

console.log('\n=== Municipio vacío creado en staging (sin vehículos/choferes/rutas) ===\n');
console.log(`Municipio: ${municipality.name} (${municipality.id})`);
console.log(`\nUsuario:    ${admin.email}`);
console.log(`Contraseña: ${admin.password}`);
console.log('\nAl iniciar sesión con este usuario en https://smartwaste-staging.vercel.app debería aparecer el asistente de configuración inicial, sin ningún dato demo mezclado.');

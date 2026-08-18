// SW-040: seeds tests/integration/seed.mjs's scenario against a REMOTE Supabase project (staging),
// not local Docker — the remote counterpart to scripts/seed-local.mjs. Deliberately does not touch
// frontend/index.html: a staging/production deployment's SMARTWASTE_SUPABASE_CONFIG is injected at
// build time by scripts/build-frontend-config.mjs from the hosting provider's own environment
// variables, never written into a committed file.
//
// Reads SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY from this shell's environment — run it directly in
// your own terminal (`$env:SUPABASE_SERVICE_ROLE_KEY = "..."` in PowerShell, or inline on Linux/
// macOS) so the service_role key never gets typed into a chat with anyone, including an AI
// assistant helping you run this (CLAUDE.md rule 8 — service_role must never leave a server-side
// context, and "pasted into a conversation" counts as leaving it).
import { createServiceClient } from '../tests/integration/local-supabase-env.mjs';
import { seedScenario } from '../tests/integration/seed.mjs';

const API_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!API_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. Ejecutá este script en tu propia terminal con esas variables seteadas — nunca le pases la service_role key a un asistente/chat.');
}

const service = createServiceClient({ API_URL, SERVICE_ROLE_KEY });
const scenario = await seedScenario(service);

// Same as scripts/seed-local.mjs: seedScenario() creates vehicleA/driverRowA but never links them.
const assignment = await service.from('vehicle_assignments').insert({
  municipality_id: scenario.municipalityA.id,
  vehicle_id: scenario.vehicleA.id,
  driver_id: scenario.driverRowA.id,
  status: 'assigned'
}).select('*').single();
if (assignment.error) throw new Error(`vehicle_assignments insert failed: ${assignment.error.message}`);

console.log('\n=== Credenciales de login en staging (misma contraseña para todos) ===\n');
console.log(`Contraseña: ${scenario.adminA.password}\n`);
console.log(`municipal_admin (municipio A): ${scenario.adminA.email}`);
console.log(`dispatcher      (municipio A): ${scenario.dispatcherA.email}`);
console.log(`driver          (municipio A): ${scenario.driverUserA.email}`);
console.log(`supervisor      (municipio A): ${scenario.supervisorA.email}`);
console.log(`municipal_admin (municipio B): ${scenario.adminB.email}`);
console.log(`mt_superadmin                : ${scenario.superadmin.email}`);
console.log(`\nmunicipality_id (municipio A, para SUPABASE_MUNICIPALITY_ID en Vercel si querés probar el portal ciudadano): ${scenario.municipalityA.id}`);

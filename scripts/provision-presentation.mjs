// SW-063: idempotent provisioning for the controlled presentation tenant.
// Run only from the owner's terminal. The service_role key and account passwords must remain in
// shell environment variables; this script never prints or writes them to a file.
import { createClient } from '@supabase/supabase-js';
import { readPresentationProvisioningConfig } from '../shared/presentation-provisioning.js';

const config = readPresentationProvisioningConfig(process.env);
const service = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function one(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function findAuthUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error(`Auth listUsers: ${result.error.message}`);
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (result.data.users.length < 100) return null;
  }
  throw new Error('Auth listUsers: se alcanzo el limite de busqueda.');
}

async function ensureUser({ email, password }, displayName) {
  let user = await findAuthUser(email);
  if (!user) {
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { requires_password_change: false, presentation_account: true }
    });
    if (created.error) throw new Error(`Auth createUser(${email}): ${created.error.message}`);
    user = created.data.user;
  } else if (config.rotatePasswords) {
    const updated = await service.auth.admin.updateUserById(user.id, { password });
    if (updated.error) throw new Error(`Auth updateUser(${email}): ${updated.error.message}`);
    user = updated.data.user;
  }
  await one('profiles upsert', service.from('profiles').upsert({
    id: user.id,
    display_name: displayName,
    email
  }, { onConflict: 'id' }).select('*').single());
  return user;
}

async function findOrCreate(table, filters, payload) {
  let query = service.from(table).select('*');
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const existing = await one(`${table} select`, query.limit(1).maybeSingle());
  if (existing) return existing;
  return one(`${table} insert`, service.from(table).insert(payload).select('*').single());
}

const municipality = await one('municipality upsert', service.from('municipalities').upsert({
  slug: 'laguna-salada-demo',
  name: 'Ayuntamiento de Laguna Salada — Presentacion',
  country: 'República Dominicana',
  status: 'onboarding'
}, { onConflict: 'slug' }).select('*').single());

const adminUser = await ensureUser(config.admin, 'Administrador de presentacion');
const driverUser = await ensureUser(config.driver, 'Chofer de presentacion');

await one('admin membership', service.from('memberships').upsert({
  municipality_id: municipality.id,
  profile_id: adminUser.id,
  role: 'municipal_admin',
  status: 'active'
}, { onConflict: 'municipality_id,profile_id' }).select('*').single());
await one('driver membership', service.from('memberships').upsert({
  municipality_id: municipality.id,
  profile_id: driverUser.id,
  role: 'driver',
  status: 'active'
}, { onConflict: 'municipality_id,profile_id' }).select('*').single());

const driver = await findOrCreate('drivers', {
  municipality_id: municipality.id,
  profile_id: driverUser.id
}, {
  municipality_id: municipality.id,
  profile_id: driverUser.id,
  display_name: 'Chofer de presentacion',
  status: 'available'
});
const vehicle = await one('vehicle upsert', service.from('vehicles').upsert({
  municipality_id: municipality.id,
  code: 'CAM-PRES-01',
  plate: 'ENSAYO',
  state: 'active',
  created_by: adminUser.id
}, { onConflict: 'municipality_id,code' }).select('*').single());
await findOrCreate('vehicle_assignments', {
  municipality_id: municipality.id,
  vehicle_id: vehicle.id,
  driver_id: driver.id,
  status: 'assigned'
}, {
  municipality_id: municipality.id,
  vehicle_id: vehicle.id,
  driver_id: driver.id,
  status: 'assigned',
  created_by: adminUser.id
});
await findOrCreate('sectors', {
  municipality_id: municipality.id,
  name: 'Pueblo Nuevo — datos de ensayo'
}, {
  municipality_id: municipality.id,
  name: 'Pueblo Nuevo — datos de ensayo',
  status: 'active'
});
const route = await findOrCreate('routes', {
  municipality_id: municipality.id,
  name: 'Ruta de presentacion — datos de ensayo'
}, {
  municipality_id: municipality.id,
  name: 'Ruta de presentacion — datos de ensayo',
  status: 'planned',
  created_by: adminUser.id
});
const stops = await one('route_stops count', service.from('route_stops').select('id').eq('route_id', route.id));
if (stops.length === 0) {
  await one('route_stops insert', service.from('route_stops').insert([
    { municipality_id: municipality.id, route_id: route.id, sequence: 1, label: 'Parada ensayo 1', latitude: 19.6489, longitude: -71.0956 },
    { municipality_id: municipality.id, route_id: route.id, sequence: 2, label: 'Parada ensayo 2', latitude: 19.6500, longitude: -71.0938 },
    { municipality_id: municipality.id, route_id: route.id, sequence: 3, label: 'Parada ensayo 3', latitude: 19.6512, longitude: -71.0920 }
  ]));
}

console.log('\nPRESENTATION TENANT READY');
console.log(`Project ref: ${config.projectRef}`);
console.log(`Municipality: ${municipality.name}`);
console.log(`SUPABASE_MUNICIPALITY_ID=${municipality.id}`);
console.log(`Admin account: ${config.admin.email}`);
console.log(`Driver account: ${config.driver.email}`);
console.log('Passwords were not printed. Store them in an approved password manager.');

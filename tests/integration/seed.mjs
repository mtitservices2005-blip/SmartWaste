// Seeds the minimum data set SW-020 needs against a local Supabase instance: two municipalities
// (so cross-tenant RLS denial can be exercised for real), one profile per role including 'driver',
// a vehicle, a driver row, and a route. Uses the service_role client, which bypasses RLS by design
// (see docs/CURRENT_STATE_AUDIT.md) — this is a local-only seeding script, never shipped to a client.

const PASSWORD = 'sw020-local-test-pass-1234';

async function createUserWithProfile(serviceClient, { email, displayName }) {
  const { data, error } = await serviceClient.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  const profile = await serviceClient.from('profiles').insert({ id: data.user.id, display_name: displayName, email }).select('*').single();
  if (profile.error) throw new Error(`profiles insert(${email}) failed: ${profile.error.message}`);
  return { id: data.user.id, email, password: PASSWORD };
}

async function membership(serviceClient, { municipality_id, profile_id, role }) {
  const result = await serviceClient.from('memberships').insert({ municipality_id, profile_id, role, status: 'active' }).select('*').single();
  if (result.error) throw new Error(`membership insert(${role}) failed: ${result.error.message}`);
  return result.data;
}

export async function seedScenario(serviceClient) {
  const suffix = Date.now().toString(36);

  const munA = await serviceClient.from('municipalities').insert({ slug: `sw020-a-${suffix}`, name: 'SW-020 Municipio A' }).select('*').single();
  if (munA.error) throw new Error(`municipality A insert failed: ${munA.error.message}`);
  const munB = await serviceClient.from('municipalities').insert({ slug: `sw020-b-${suffix}`, name: 'SW-020 Municipio B' }).select('*').single();
  if (munB.error) throw new Error(`municipality B insert failed: ${munB.error.message}`);

  const adminA = await createUserWithProfile(serviceClient, { email: `admin-a-${suffix}@sw020.test`, displayName: 'Admin A' });
  const dispatcherA = await createUserWithProfile(serviceClient, { email: `dispatcher-a-${suffix}@sw020.test`, displayName: 'Dispatcher A' });
  const driverUserA = await createUserWithProfile(serviceClient, { email: `driver-a-${suffix}@sw020.test`, displayName: 'Driver A' });
  const adminB = await createUserWithProfile(serviceClient, { email: `admin-b-${suffix}@sw020.test`, displayName: 'Admin B' });

  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: adminA.id, role: 'municipal_admin' });
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: dispatcherA.id, role: 'dispatcher' });
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: driverUserA.id, role: 'driver' });
  await membership(serviceClient, { municipality_id: munB.data.id, profile_id: adminB.id, role: 'municipal_admin' });

  const driverRowA = await serviceClient.from('drivers').insert({ municipality_id: munA.data.id, profile_id: driverUserA.id, display_name: 'Driver A' }).select('*').single();
  if (driverRowA.error) throw new Error(`drivers insert failed: ${driverRowA.error.message}`);

  const vehicleA = await serviceClient.from('vehicles').insert({ municipality_id: munA.data.id, code: `SW020-${suffix}` }).select('*').single();
  if (vehicleA.error) throw new Error(`vehicles insert failed: ${vehicleA.error.message}`);

  const routeA = await serviceClient.from('routes').insert({ municipality_id: munA.data.id, name: `Ruta SW-020 ${suffix}` }).select('*').single();
  if (routeA.error) throw new Error(`routes insert failed: ${routeA.error.message}`);

  const vehicleB = await serviceClient.from('vehicles').insert({ municipality_id: munB.data.id, code: `SW020-B-${suffix}` }).select('*').single();
  if (vehicleB.error) throw new Error(`vehicles B insert failed: ${vehicleB.error.message}`);

  return {
    municipalityA: munA.data,
    municipalityB: munB.data,
    adminA, dispatcherA, driverUserA, adminB,
    driverRowA: driverRowA.data,
    vehicleA: vehicleA.data,
    vehicleB: vehicleB.data,
    routeA: routeA.data
  };
}

// Seeds the minimum data set SW-020 (and the frontend login-gating verification, see
// docs/LOGIN_GATING_VERIFICATION_BRIEF.md) needs against a local Supabase instance: two
// municipalities (so cross-tenant RLS denial can be exercised for real), one profile per role in
// shared/auth-context.js ROLES (municipal_admin, dispatcher, driver, supervisor, mt_superadmin), a
// vehicle, a driver row, and a route. Uses the service_role client, which bypasses RLS by design
// (see docs/CURRENT_STATE_AUDIT.md) — this is a local-only seeding script, never shipped to a client.
//
// Also seeds route-centro/route-maestros/INC-003 using the EXACT realId uuids from
// shared/demo-data.js (docs/TECHNICAL_DEBT_REGISTER.md #14) — that's what lets
// frontend/app.js's real writes (conductor route transitions, supervisor verify/resolve) find a
// matching row when exercised interactively against this seeded instance, instead of failing with
// ROUTE_RUN_NOT_FOUND.

import { routes as demoRoutes, incidents as demoIncidents } from '../../shared/demo-data.js';

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
  // supervisorA/superadmin: added for the frontend login-gating verification
  // (docs/LOGIN_GATING_VERIFICATION_BRIEF.md) — SECTION_ROLES in frontend/auth-gate.js covers all
  // 5 roles in shared/auth-context.js ROLES, but this seed previously only created 3 of them.
  const supervisorA = await createUserWithProfile(serviceClient, { email: `supervisor-a-${suffix}@sw020.test`, displayName: 'Supervisor A' });
  const superadmin = await createUserWithProfile(serviceClient, { email: `superadmin-${suffix}@sw020.test`, displayName: 'Superadmin' });

  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: adminA.id, role: 'municipal_admin' });
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: dispatcherA.id, role: 'dispatcher' });
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: driverUserA.id, role: 'driver' });
  await membership(serviceClient, { municipality_id: munB.data.id, profile_id: adminB.id, role: 'municipal_admin' });
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: supervisorA.id, role: 'supervisor' });
  // memberships.municipality_id is NOT NULL in the schema (supabase/migrations/202607150001_sw007_
  // foundation.sql), so mt_superadmin still needs a row scoped to *some* municipality even though
  // shared/auth-context.js's createSessionContext() only requires municipality_id for non-superadmin
  // roles. has_platform_role() (202607150004_sw014_auth_rls_policies.sql) checks role existence only,
  // not this municipality_id, so which municipality it points to doesn't matter for platform checks.
  await membership(serviceClient, { municipality_id: munA.data.id, profile_id: superadmin.id, role: 'mt_superadmin' });

  const driverRowA = await serviceClient.from('drivers').insert({ municipality_id: munA.data.id, profile_id: driverUserA.id, display_name: 'Driver A' }).select('*').single();
  if (driverRowA.error) throw new Error(`drivers insert failed: ${driverRowA.error.message}`);

  const vehicleA = await serviceClient.from('vehicles').insert({ municipality_id: munA.data.id, code: `SW020-${suffix}` }).select('*').single();
  if (vehicleA.error) throw new Error(`vehicles insert failed: ${vehicleA.error.message}`);

  const routeA = await serviceClient.from('routes').insert({ municipality_id: munA.data.id, name: `Ruta SW-020 ${suffix}` }).select('*').single();
  if (routeA.error) throw new Error(`routes insert failed: ${routeA.error.message}`);

  const vehicleB = await serviceClient.from('vehicles').insert({ municipality_id: munB.data.id, code: `SW020-B-${suffix}` }).select('*').single();
  if (vehicleB.error) throw new Error(`vehicles B insert failed: ${vehicleB.error.message}`);

  // route-centro / route-maestros / INC-003: seeded with the exact demo-data.js .realId uuids so
  // frontend/app.js's real writes (conductor transitions, supervisor verify/resolve) find a match
  // when someone logs in as driverUserA/supervisorA against this instance and clicks those buttons.
  const demoRouteCentro = demoRoutes.find((r) => r.id === 'route-centro');
  const demoRouteMaestros = demoRoutes.find((r) => r.id === 'route-maestros');
  const demoIncident003 = demoIncidents.find((i) => i.code === 'INC-003');

  const routeCentro = await serviceClient.from('routes').insert({ id: demoRouteCentro.realId, municipality_id: munA.data.id, name: demoRouteCentro.name, status: demoRouteCentro.status }).select('*').single();
  if (routeCentro.error) throw new Error(`route-centro insert failed: ${routeCentro.error.message}`);
  // status: 'in_progress' matches the demo's own route.status for route-centro — driverAllowedTransitions('in_progress')
  // offers 'delayed'/'completed' in the UI, both valid next steps for driver_update_own_route_run.
  const routeRunCentro = await serviceClient.from('route_runs').insert({ municipality_id: munA.data.id, route_id: routeCentro.data.id, vehicle_id: vehicleA.data.id, driver_id: driverRowA.data.id, status: 'in_progress' }).select('*').single();
  if (routeRunCentro.error) throw new Error(`route_run for route-centro failed: ${routeRunCentro.error.message}`);

  const routeMaestros = await serviceClient.from('routes').insert({ id: demoRouteMaestros.realId, municipality_id: munA.data.id, name: demoRouteMaestros.name, status: demoRouteMaestros.status }).select('*').single();
  if (routeMaestros.error) throw new Error(`route-maestros insert failed: ${routeMaestros.error.message}`);
  // status: 'completed' so supervisorA can exercise the real verifyRoute() transition (completed -> verified).
  const routeRunMaestros = await serviceClient.from('route_runs').insert({ municipality_id: munA.data.id, route_id: routeMaestros.data.id, vehicle_id: vehicleA.data.id, status: 'completed' }).select('*').single();
  if (routeRunMaestros.error) throw new Error(`route_run for route-maestros failed: ${routeRunMaestros.error.message}`);

  // status/priority translated from the demo's Spanish labels ('Abierta'/'Media') to the real
  // schema's English values — see the comment above shared/demo-data.js's incidents export.
  const incidentCentro = await serviceClient.from('incidents').insert({ id: demoIncident003.realId, municipality_id: munA.data.id, route_run_id: routeRunCentro.data.id, type: demoIncident003.type, status: 'open', priority: 'medium' }).select('*').single();
  if (incidentCentro.error) throw new Error(`INC-003 insert failed: ${incidentCentro.error.message}`);

  return {
    municipalityA: munA.data,
    municipalityB: munB.data,
    adminA, dispatcherA, driverUserA, adminB, supervisorA, superadmin,
    driverRowA: driverRowA.data,
    vehicleA: vehicleA.data,
    vehicleB: vehicleB.data,
    routeA: routeA.data,
    routeCentro: routeCentro.data,
    routeRunCentro: routeRunCentro.data,
    routeMaestros: routeMaestros.data,
    routeRunMaestros: routeRunMaestros.data,
    incidentCentro: incidentCentro.data
  };
}

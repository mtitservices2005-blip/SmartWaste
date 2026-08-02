// SW-032: provisions a real login account for an existing `drivers` row.
//
// Why this has to be an Edge Function and not a frontend insert: creating an auth user requires
// `auth.admin.createUser()`, which only works with the `service_role` key. That key must never
// reach the browser (CLAUDE.md rule 8) - this function holds it as a server-side secret and the
// frontend only ever calls this endpoint with its normal anon-key session (see
// frontend/auth-gate.js / docs/FRONTEND_LOGIN_SETUP.md for that established opt-in pattern).
//
// Authorization model: the caller's own JWT (forwarded via the Authorization header) is used to
// build a throwaway client scoped to their session, and `auth.getUser()` on THAT client is what
// identifies who is calling - never anything the request body claims. Only once that identity is
// confirmed to hold an active `municipal_admin`/`dispatcher` membership in the driver's own
// municipality (queried with the service-role client, which bypasses RLS by design - this function
// IS the trusted checkpoint) does it proceed. This mirrors has_municipality_role() from
// supabase/migrations/202607150004_sw014_auth_rls_policies.sql, just re-implemented here because
// Postgres RPCs aren't reachable directly from average anon-key writes to auth.users.
//
// Note: this only does anything useful once a `drivers` row actually exists in real Supabase for
// the given driver_id - until SW-034 connects frontend/app.js to createSupabaseOperationsAdapter,
// drivers registered through the SW-031 "Flota y personal" UI only exist in the in-memory demo
// adapter, so calling this against one of those ids will correctly (and safely) 404 with "Driver
// not found" rather than doing anything destructive.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STAFF_ROLES = ['municipal_admin', 'dispatcher'];

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Function is missing required environment configuration' }, 500);

  const body = await req.json().catch(() => null);
  const driverId = body?.driver_id;
  const email = body?.email;
  if (!driverId || !email) return json({ error: 'driver_id and email are required' }, 400);

  // Scoped to the caller's own session (anon key + their JWT) - RLS applies normally here, and it
  // is used ONLY to establish who is calling, never to read or write driver/membership data.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Invalid or expired session' }, 401);

  // service_role from here on - this function is the trusted checkpoint precisely because the
  // caller's identity was already established above through their own session, not the body.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const driverLookup = await serviceClient.from('drivers').select('id, municipality_id, profile_id, display_name').eq('id', driverId).maybeSingle();
  if (driverLookup.error) return json({ error: driverLookup.error.message }, 500);
  const driver = driverLookup.data;
  if (!driver) return json({ error: 'Driver not found' }, 404);
  if (driver.profile_id) return json({ error: 'Driver already has an access account' }, 409);

  const membershipLookup = await serviceClient.from('memberships').select('role').eq('profile_id', userData.user.id).eq('municipality_id', driver.municipality_id).eq('status', 'active').in('role', STAFF_ROLES).maybeSingle();
  if (membershipLookup.error) return json({ error: membershipLookup.error.message }, 500);
  if (!membershipLookup.data) return json({ error: 'Caller is not authorized to provision accounts for this municipality' }, 403);

  const createdUser = await serviceClient.auth.admin.createUser({ email, email_confirm: false, user_metadata: { display_name: driver.display_name } });
  if (createdUser.error) return json({ error: createdUser.error.message }, 500);
  const newUserId = createdUser.data.user.id;

  // Best-effort rollback below: auth.admin.createUser() already happened and can't be part of the
  // same Postgres transaction as these inserts, so a failure partway through is cleaned up
  // manually, in reverse order, rather than left as an orphaned half-provisioned account.
  const profileInsert = await serviceClient.from('profiles').insert({ id: newUserId, display_name: driver.display_name, email }).select('*').single();
  if (profileInsert.error) {
    await serviceClient.auth.admin.deleteUser(newUserId);
    return json({ error: profileInsert.error.message }, 500);
  }

  const membershipInsert = await serviceClient.from('memberships').insert({ municipality_id: driver.municipality_id, profile_id: newUserId, role: 'driver', status: 'active' }).select('*').single();
  if (membershipInsert.error) {
    await serviceClient.from('profiles').delete().eq('id', newUserId);
    await serviceClient.auth.admin.deleteUser(newUserId);
    return json({ error: membershipInsert.error.message }, 500);
  }

  const driverUpdate = await serviceClient.from('drivers').update({ profile_id: newUserId }).eq('id', driverId).select('*').single();
  if (driverUpdate.error) {
    await serviceClient.from('memberships').delete().eq('profile_id', newUserId);
    await serviceClient.from('profiles').delete().eq('id', newUserId);
    await serviceClient.auth.admin.deleteUser(newUserId);
    return json({ error: driverUpdate.error.message }, 500);
  }

  // No password was set (email_confirm:false, no password passed to createUser), so an invite
  // link is how the driver actually gets in - generateLink() doesn't send anything itself, it just
  // returns a URL for the admin to hand off (SMS, WhatsApp, in person), avoiding any dependency on
  // SMTP being configured for this local/demo stack.
  const inviteLink = await serviceClient.auth.admin.generateLink({ type: 'invite', email }).catch(() => null);

  return json({ ok: true, profile_id: newUserId, invite_action_link: inviteLink?.data?.properties?.action_link ?? null }, 200);
});

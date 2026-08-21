// SW-050: regenerates a fresh access link for a driver who already has an account
// (drivers.profile_id set) but lost the one-time invite link create-driver-account returned —
// that link is only ever shown once in the UI and nothing persists it, so before this there was no
// way to recover access short of the Project Owner going into the Supabase dashboard by hand.
//
// Same authorization model as create-driver-account: the caller's own JWT identifies them, and
// only a municipal_admin/dispatcher with an active membership in the driver's own municipality may
// call this. service_role stays server-side only (CLAUDE.md rule 8).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STAFF_ROLES = ['municipal_admin', 'dispatcher'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Function is missing required environment configuration' }, 500);

  const body = await req.json().catch(() => null);
  const driverId = body?.driver_id;
  if (!driverId) return json({ error: 'driver_id is required' }, 400);

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Invalid or expired session' }, 401);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const driverLookup = await serviceClient.from('drivers').select('id, municipality_id, profile_id').eq('id', driverId).maybeSingle();
  if (driverLookup.error) return json({ error: driverLookup.error.message }, 500);
  const driver = driverLookup.data;
  if (!driver) return json({ error: 'Driver not found' }, 404);
  if (!driver.profile_id) return json({ error: 'This driver has no access account yet — use create-driver-account first' }, 409);

  const membershipLookup = await serviceClient.from('memberships').select('role').eq('profile_id', userData.user.id).eq('municipality_id', driver.municipality_id).eq('status', 'active').in('role', STAFF_ROLES).maybeSingle();
  if (membershipLookup.error) return json({ error: membershipLookup.error.message }, 500);
  if (!membershipLookup.data) return json({ error: 'Caller is not authorized to manage accounts for this municipality' }, 403);

  // The email lives on auth.users (the source of truth), not on the drivers row — reading it back
  // via admin.getUserById() rather than profiles.email so this still works even for an account
  // whose profile row was somehow never written.
  const authUser = await serviceClient.auth.admin.getUserById(driver.profile_id);
  if (authUser.error || !authUser.data?.user?.email) return json({ error: 'Could not resolve this account\'s email' }, 500);
  const email = authUser.data.user.email;

  // 'recovery' works whether the driver ever completed their original invite or not — unlike
  // 'invite', which Supabase rejects once an account is already confirmed. Either way the result is
  // a working link that lets the driver in.
  const link = await serviceClient.auth.admin.generateLink({ type: 'recovery', email }).catch(() => null);
  if (!link?.data?.properties?.action_link) return json({ error: 'Could not generate a new access link' }, 500);

  return json({ ok: true, invite_action_link: link.data.properties.action_link }, 200);
});

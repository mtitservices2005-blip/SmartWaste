// SW-050 (revisión): resets the password for a driver who already has an account
// (drivers.profile_id set), so a dispatcher can hand them working credentials anytime without
// depending on the Project Owner going into the Supabase dashboard by hand.
//
// This used to generate an invite/recovery link (auth.admin.generateLink) — found unreliable in
// staging: the link came back "invalid or expired" instantly for an account that never completed
// its original invite, and getting the redirect right needed provider-side config (Site URL,
// Redirect URLs, hash vs. PKCE format) this deployment doesn't fully control. A direct password
// reset sidesteps all of that: the driver logs in with the existing, already-working
// email+password form (frontend/auth-gate.js), no link or redirect involved.
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

// Same generator as create-driver-account — kept in sync there rather than shared via an import,
// since Edge Functions each deploy independently and this is a 3-line pure helper, not worth the
// cross-function import complexity for.
function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
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

  const temporaryPassword = generateTemporaryPassword();
  const updateResult = await serviceClient.auth.admin.updateUserById(driver.profile_id, { password: temporaryPassword });
  if (updateResult.error) return json({ error: updateResult.error.message }, 500);

  return json({ ok: true, temporary_password: temporaryPassword }, 200);
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
}

export function municipalitySlug(name) {
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'municipio';
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  return `${base}-${suffix}`;
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

async function rollback(serviceClient, steps) {
  for (const step of [...steps].reverse()) {
    try { await step(); } catch { /* best effort: preserve the original provisioning error */ }
  }
}

export function createMunicipalityAccountHandler({ createClient, env }) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = env.get('SUPABASE_URL');
    const serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: 'Function is missing required environment configuration' }, 500);
    }

    const body = await req.json().catch(() => null);
    const rawName = body?.municipality_name ?? body?.name;
    const rawEmail = body?.admin_email ?? body?.email;
    const municipalityName = typeof rawName === 'string' ? rawName.trim() : '';
    const adminEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!municipalityName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return json({ error: 'municipality_name and admin_email are required' }, 400);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Invalid or expired session' }, 401);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const membershipLookup = await serviceClient.from('memberships').select('role')
      .eq('profile_id', userData.user.id).eq('role', 'mt_superadmin').eq('status', 'active')
      .limit(1).maybeSingle();
    if (membershipLookup.error) return json({ error: membershipLookup.error.message }, 500);
    if (!membershipLookup.data) return json({ error: 'Caller is not authorized to create municipalities' }, 403);

    const completed = [];
    const municipalityInsert = await serviceClient.from('municipalities').insert({
      name: municipalityName,
      slug: municipalitySlug(municipalityName),
      status: 'onboarding'
    }).select('*').single();
    if (municipalityInsert.error) return json({ error: municipalityInsert.error.message }, 500);
    const municipality = municipalityInsert.data;
    completed.push(() => serviceClient.from('municipalities').delete().eq('id', municipality.id));

    const temporaryPassword = generateTemporaryPassword();
    const displayName = adminEmail.split('@')[0] || 'Administrador municipal';
    const createdUser = await serviceClient.auth.admin.createUser({
      email: adminEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName, requires_password_change: true }
    });
    if (createdUser.error) {
      await rollback(serviceClient, completed);
      return json({ error: createdUser.error.message }, 500);
    }
    const newUserId = createdUser.data.user.id;
    completed.push(() => serviceClient.auth.admin.deleteUser(newUserId));

    const profileInsert = await serviceClient.from('profiles').insert({
      id: newUserId,
      display_name: displayName,
      email: adminEmail
    }).select('*').single();
    if (profileInsert.error) {
      await rollback(serviceClient, completed);
      return json({ error: profileInsert.error.message }, 500);
    }
    completed.push(() => serviceClient.from('profiles').delete().eq('id', newUserId));

    const membershipInsert = await serviceClient.from('memberships').insert({
      municipality_id: municipality.id,
      profile_id: newUserId,
      role: 'municipal_admin',
      status: 'active'
    }).select('*').single();
    if (membershipInsert.error) {
      await rollback(serviceClient, completed);
      return json({ error: membershipInsert.error.message }, 500);
    }
    completed.push(() => serviceClient.from('memberships').delete().eq('id', membershipInsert.data.id));

    // SW-120: el ayuntamiento nace con su licencia de prueba (sin precio, sin cobro) para que quede dentro del control de camiones.
    const trucks = boundedInt(body?.trucks, 5, 1, 50);
    const trialDays = boundedInt(body?.trial_days, 60, 1, 180);
    const validUntil = new Date(Date.now() + trialDays * 86400000).toISOString().slice(0, 10);
    const licenseInsert = await serviceClient.from('municipality_licenses').insert({
      municipality_id: municipality.id, is_trial: true, valid_until: validUntil, contracted_trucks: trucks,
      price_per_truck_year: 0, currency: 'USD', billing_mode: 'manual', grace_days: 15, suspended: false
    }).select('*').single();
    if (licenseInsert.error) {
      await rollback(serviceClient, completed);
      return json({ error: licenseInsert.error.message }, 500);
    }
    completed.push(() => serviceClient.from('municipality_licenses').delete().eq('municipality_id', municipality.id));
    const eventInsert = await serviceClient.from('license_events').insert({
      municipality_id: municipality.id, type: 'alta', trucks_delta: trucks, billed: true, created_by: userData.user.id,
      detail: `Alta en periodo de prueba de ${trialDays} días con ${trucks} camiones`
    }).select('*').single();
    if (eventInsert.error) {
      await rollback(serviceClient, completed);
      return json({ error: eventInsert.error.message }, 500);
    }

    return json({
      ok: true,
      municipality,
      profile_id: newUserId,
      license: licenseInsert.data,
      temporary_password: temporaryPassword
    }, 200);
  };
}

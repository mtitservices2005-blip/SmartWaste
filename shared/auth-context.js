export const ROLES = ['mt_superadmin','municipal_admin','supervisor','dispatcher','driver'];
export const PERMISSIONS = {
  mt_superadmin: ['platform.read','municipality.onboard','municipality.support','health.read'],
  municipal_admin: ['municipality.manage','vehicles.manage','routes.manage','users.manage','settings.manage','reports.read'],
  supervisor: ['operations.read','routes.verify','incidents.manage','reports.read'],
  dispatcher: ['operations.read','routes.assign','vehicles.assign','drivers.assign','incidents.create'],
  driver: ['driver.operation.read','routes.start','routes.progress','incidents.create']
};
export function createSessionContext({ user_id, role, municipality_id = null }) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  if (role !== 'mt_superadmin' && !municipality_id) throw new Error('municipality_id required for municipal roles');
  return { user_id, role, municipality_id, permissions: PERMISSIONS[role] };
}
export function can(ctx, permission) { return Boolean(ctx?.permissions?.includes(permission)); }
export function assertSameMunicipality(ctx, record) {
  if (ctx.role === 'mt_superadmin') return true;
  if (!record?.municipality_id || record.municipality_id !== ctx.municipality_id) throw new Error('Cross-municipality access denied');
  return true;
}
export const demoSession = createSessionContext({ user_id:'demo-user', role:'municipal_admin', municipality_id:'laguna-salada-rd' });


export async function resolveSupabaseAuthContext(client, { municipality_id = null } = {}) {
  if (!client?.auth?.getUser || !client?.from) throw new Error('Supabase client with auth and from is required');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData?.user;
  if (!user?.id) throw new Error('Authenticated user is required');
  const profileResult = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);
  let membershipQuery = client.from('memberships').select('*').eq('profile_id', user.id).eq('status', 'active');
  if (municipality_id) membershipQuery = membershipQuery.eq('municipality_id', municipality_id);
  const membershipResult = await membershipQuery.limit(1).maybeSingle();
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (!membershipResult.data) throw new Error('Active membership is required');
  return { ...createSessionContext({ user_id:user.id, role:membershipResult.data.role, municipality_id:membershipResult.data.municipality_id }), profile: profileResult.data, membership: membershipResult.data };
}

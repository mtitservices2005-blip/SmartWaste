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

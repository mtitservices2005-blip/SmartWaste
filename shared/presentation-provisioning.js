export function readPresentationProvisioningConfig(env = {}) {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_EXPECTED_PROJECT_REF',
    'PRESENTATION_ADMIN_EMAIL',
    'PRESENTATION_ADMIN_PASSWORD',
    'PRESENTATION_DRIVER_EMAIL',
    'PRESENTATION_DRIVER_PASSWORD'
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Faltan variables requeridas: ${missing.join(', ')}.`);

  let url;
  try { url = new URL(env.SUPABASE_URL); }
  catch { throw new Error('SUPABASE_URL no es una URL valida.'); }
  if (url.protocol !== 'https:') throw new Error('SUPABASE_URL debe usar https://.');

  const projectRef = url.hostname.split('.')[0];
  if (!projectRef || projectRef !== env.SUPABASE_EXPECTED_PROJECT_REF) {
    throw new Error('SUPABASE_EXPECTED_PROJECT_REF no coincide con el proyecto de SUPABASE_URL.');
  }
  if (env.SMARTWASTE_PRESENTATION_CONFIRM !== `PROVISION_${projectRef}_LAGUNA_SALADA`) {
    throw new Error(`Confirmacion requerida: SMARTWASTE_PRESENTATION_CONFIRM=PROVISION_${projectRef}_LAGUNA_SALADA`);
  }
  for (const name of ['PRESENTATION_ADMIN_PASSWORD', 'PRESENTATION_DRIVER_PASSWORD']) {
    if (env[name].length < 12) throw new Error(`${name} debe tener al menos 12 caracteres.`);
  }
  if (env.PRESENTATION_ADMIN_EMAIL === env.PRESENTATION_DRIVER_EMAIL) {
    throw new Error('Las cuentas de administrador y chofer deben usar correos diferentes.');
  }

  return {
    url: url.toString().replace(/\/$/, ''),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    projectRef,
    admin: { email: env.PRESENTATION_ADMIN_EMAIL, password: env.PRESENTATION_ADMIN_PASSWORD },
    driver: { email: env.PRESENTATION_DRIVER_EMAIL, password: env.PRESENTATION_DRIVER_PASSWORD },
    rotatePasswords: env.PRESENTATION_ROTATE_PASSWORDS === 'true'
  };
}

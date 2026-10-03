// SW-070: resumable, invitation-only provisioning for a pilot municipality.
// This script is intentionally run only from a protected operator terminal. It never accepts,
// creates, prints, or returns passwords, service-role keys, invitation links, or tokens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

async function createRemoteServiceClient(apiUrl, serviceRoleKey) {
  // Dynamic import keeps --dry-run and simulated-client tests dependency-free, matching CI's
  // unit-test job; the real protected execution path requires the pinned package from npm ci.
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Kept in sync with docs/ROLE_PERMISSION_MATRIX.md. Platform ownership is intentionally excluded:
// mt_superadmin is Miguel's existing account and must not be created by this script.
export const PROVISIONABLE_ROLES = new Set(['municipal_admin', 'supervisor', 'dispatcher', 'driver']);

function normalizedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Se requiere un correo válido.');
  return email;
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Se requiere ${label}.`);
  return text;
}

export function validateRole(role) {
  if (role === 'mt_superadmin') {
    throw new Error('mt_superadmin no puede crearse con este script; el runbook documenta la cuenta existente de Miguel.');
  }
  if (!PROVISIONABLE_ROLES.has(role)) {
    throw new Error(`Rol no permitido: ${String(role)}. Consulte docs/ROLE_PERMISSION_MATRIX.md.`);
  }
  return role;
}

function resultError(result, step) {
  if (result?.error) throw new Error(step);
  return result?.data;
}

async function findAuthUserByEmail(client, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    resultError({ data, error }, 'No se pudo consultar Supabase Auth.');
    const user = (data?.users ?? []).find((candidate) => candidate.email?.trim().toLowerCase() === email);
    if (user) return user;
    if (!data?.nextPage) return null;
  }
  throw new Error('La búsqueda de usuario excedió el límite de páginas.');
}

function logProgress(logger, steps) {
  const parts = [
    `municipio=${steps.municipality}`,
    `auth=${steps.authUser}`,
    `perfil=${steps.profile}`,
    `membresía=${steps.membership}`
  ];
  if (steps.driverRecord !== undefined) parts.push(`driver=${steps.driverRecord}`);
  logger.log(`Pasos: ${parts.join('; ')}.`);
}

async function ensureMunicipality(client, municipality) {
  const existing = await client.from('municipalities').select('*').eq('slug', municipality.slug).maybeSingle();
  const found = resultError(existing, 'No se pudo consultar el municipio.');
  if (found) {
    if (found.name !== municipality.name) throw new Error('El slug ya pertenece a un municipio con otro nombre; no se modificó ningún dato.');
    return { municipality: found, outcome: 'reused' };
  }

  const created = await client.from('municipalities').insert({
    slug: municipality.slug,
    name: municipality.name,
    status: 'onboarding'
  }).select('*').single();
  return { municipality: resultError(created, 'No se pudo crear el municipio.'), outcome: 'created' };
}

async function ensureUser(client, user, { resendInvite }) {
  const existing = await findAuthUserByEmail(client, user.email);
  if (existing && !resendInvite) return { user: existing, outcome: 'reused' };

  const invited = await client.auth.admin.inviteUserByEmail(user.email, { data: { display_name: user.name } });
  if (invited?.error) {
    // Resend path: the Auth user already exists, so a failed re-invite (typically because the user
    // already confirmed the original invitation and set a password) is not a transient crash that
    // a plain retry fixes — and, per CLAUDE.md rule 8, it must never surface a generated link or
    // token. Report a distinct, link-free status so the operator knows to use "olvidé mi
    // contraseña" on the login form, or the resend-driver-invite Edge Function for drivers.
    if (existing) {
      return {
        user: existing,
        outcome: 'resend_failed',
        error: 'No se pudo reenviar la invitación: la cuenta ya podría estar confirmada o tener contraseña establecida; no hay enlace de invitación que reenviar. Use "olvidé mi contraseña" en el login o, para drivers, la Edge Function resend-driver-invite.'
      };
    }
    throw new Error('No se pudo enviar la invitación de Supabase Auth.');
  }
  const invitedUser = invited?.data;
  if (!invitedUser?.user?.id) throw new Error('Supabase Auth no devolvió un usuario para la invitación.');
  return { user: invitedUser.user, outcome: existing ? 'resent' : 'invited' };
}

async function ensureProfile(client, municipality, user) {
  const profile = await client.from('profiles').upsert({
    id: user.id,
    display_name: municipality.user.name,
    email: municipality.user.email
  }, { onConflict: 'id' }).select('*').single();
  return resultError(profile, 'No se pudo upsertar el perfil.');
}

async function ensureMembership(client, municipality, user, { changeRole = false } = {}) {
  // A pre-existing membership for the same (municipality_id, profile_id) must never be silently
  // overwritten with a different role: a mistargeted alta or a retry could otherwise demote a
  // supervisor to driver without anyone asking. Only an explicit --change-role allows it.
  const existing = await client.from('memberships').select('*')
    .eq('municipality_id', municipality.id)
    .eq('profile_id', user.id)
    .maybeSingle();
  const found = resultError(existing, 'No se pudo consultar la membresía.');
  if (found && found.role !== municipality.user.role && !changeRole) {
    throw new Error(`La membresía de este usuario ya existe con el rol ${found.role}; use --change-role para cambiarla a ${municipality.user.role} explícitamente.`);
  }

  const membership = await client.from('memberships').upsert({
    municipality_id: municipality.id,
    profile_id: user.id,
    role: municipality.user.role,
    status: 'active'
  }, { onConflict: 'municipality_id,profile_id' }).select('*').single();
  return resultError(membership, 'No se pudo upsertar la membresía.');
}

// SW-070 (revisión): provisioning a `driver` role must also leave a `drivers` row bound to that
// user, exactly like supabase/functions/create-driver-account/index.ts does for the historical
// "Flota y personal" UI. Idempotent: reuse an existing row (looked up by the strong profile_id
// relation first, then by municipality_id + display_name for rows created by another path before
// profile_id was set) and never insert a duplicate.
async function ensureDriverRecord(client, municipality, resolvedUser) {
  const byProfile = await client.from('drivers').select('*').eq('profile_id', resolvedUser.id).maybeSingle();
  const foundByProfile = resultError(byProfile, 'No se pudo consultar la tabla drivers.');
  if (foundByProfile) return { driver: foundByProfile, outcome: 'reused' };

  const byName = await client.from('drivers').select('*')
    .eq('municipality_id', municipality.id)
    .eq('display_name', municipality.user.name)
    .maybeSingle();
  const foundByName = resultError(byName, 'No se pudo consultar la tabla drivers.');
  if (foundByName) {
    if (!foundByName.profile_id) {
      const linked = await client.from('drivers').update({ profile_id: resolvedUser.id }).eq('id', foundByName.id).select('*').single();
      resultError(linked, 'No se pudo vincular el driver existente.');
    }
    return { driver: foundByName, outcome: 'reused' };
  }

  const created = await client.from('drivers').insert({
    municipality_id: municipality.id,
    display_name: municipality.user.name,
    profile_id: resolvedUser.id
  }).select('*').single();
  return { driver: resultError(created, 'No se pudo crear la fila de driver.'), outcome: 'created' };
}

export async function provisionMunicipality({ client, municipality, user, resendInvite = false, changeRole = false, logger = console }) {
  const requestedMunicipality = {
    slug: requiredText(municipality?.slug, 'un slug de municipio'),
    name: requiredText(municipality?.name, 'un nombre de municipio')
  };
  const requestedUser = {
    email: normalizedEmail(user?.email),
    name: requiredText(user?.name, 'un nombre de usuario'),
    role: validateRole(user?.role)
  };
  const steps = { municipality: 'pending', authUser: 'pending', profile: 'pending', membership: 'pending' };
  if (requestedUser.role === 'driver') steps.driverRecord = 'pending';
  let resolvedMunicipality;
  let resolvedUser;

  try {
    const result = await ensureMunicipality(client, requestedMunicipality);
    resolvedMunicipality = result.municipality;
    steps.municipality = result.outcome;
  } catch (error) {
    steps.municipality = 'failed';
    logProgress(logger, steps);
    return { ok: false, steps, error: error.message };
  }

  try {
    const result = await ensureUser(client, requestedUser, { resendInvite });
    resolvedUser = result.user;
    steps.authUser = result.outcome;
    if (result.outcome === 'resend_failed') {
      logProgress(logger, steps);
      return { ok: false, steps, municipality: resolvedMunicipality, user: resolvedUser, error: result.error };
    }
  } catch (error) {
    steps.authUser = 'failed';
    logProgress(logger, steps);
    return { ok: false, steps, municipality: resolvedMunicipality, error: error.message };
  }

  const context = { ...resolvedMunicipality, user: requestedUser };
  try {
    await ensureProfile(client, context, resolvedUser);
    steps.profile = 'upserted';
  } catch (error) {
    steps.profile = 'failed';
    logProgress(logger, steps);
    return { ok: false, steps, municipality: resolvedMunicipality, user: resolvedUser, error: error.message };
  }

  try {
    await ensureMembership(client, context, resolvedUser, { changeRole });
    steps.membership = 'upserted';
  } catch (error) {
    steps.membership = 'failed';
    logProgress(logger, steps);
    return { ok: false, steps, municipality: resolvedMunicipality, user: resolvedUser, error: error.message };
  }

  if (requestedUser.role === 'driver') {
    try {
      const result = await ensureDriverRecord(client, context, resolvedUser);
      steps.driverRecord = result.outcome;
    } catch (error) {
      steps.driverRecord = 'failed';
      logProgress(logger, steps);
      return { ok: false, steps, municipality: resolvedMunicipality, user: resolvedUser, error: error.message };
    }
  }

  logProgress(logger, steps);
  return { ok: true, steps, municipality: resolvedMunicipality, user: resolvedUser };
}

export async function addMunicipalityUsers({ client, municipalitySlug, users, resendInvite = false, changeRole = false, logger = console }) {
  const slug = requiredText(municipalitySlug, 'el slug del municipio');
  const lookup = await client.from('municipalities').select('*').eq('slug', slug).maybeSingle();
  const municipality = resultError(lookup, 'No se pudo consultar el municipio.');
  if (!municipality) throw new Error(`No existe un municipio con slug ${slug}.`);

  const results = [];
  for (const rawUser of users) {
    const result = await provisionMunicipality({
      client,
      municipality: { slug: municipality.slug, name: municipality.name },
      user: rawUser,
      resendInvite,
      changeRole,
      logger
    });
    results.push(result);
  }
  return { ok: results.every((result) => result.ok), results };
}

export function loadBulkUsers(path) {
  const contents = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!contents) throw new Error('El archivo de altas está vacío.');
  if (path.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(contents);
    const users = Array.isArray(parsed) ? parsed : parsed.users;
    if (!Array.isArray(users)) throw new Error('El JSON debe ser un arreglo o un objeto con una propiedad users.');
    return users;
  }
  if (path.toLowerCase().endsWith('.csv')) {
    const [header, ...lines] = contents.split(/\r?\n/).filter(Boolean);
    if (header !== 'email,role,name') throw new Error('El CSV debe usar exactamente el encabezado email,role,name.');
    return lines.map((line, index) => {
      const values = line.split(',').map((value) => value.trim());
      if (values.length !== 3 || values.some((value) => !value)) throw new Error(`Fila CSV inválida: ${index + 2}.`);
      return { email: values[0], role: values[1], name: values[2] };
    });
  }
  throw new Error('El archivo de altas debe terminar en .json o .csv.');
}

export function parseArguments(args) {
  const [command, ...rest] = args;
  if (!['municipality', 'add-user'].includes(command)) throw new Error('Use municipality o add-user.');
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--dry-run' || token === '--resend-invite' || token === '--change-role') options[token.slice(2)] = true;
    else if (token.startsWith('--')) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${token}.`);
      options[token.slice(2)] = value;
      index += 1;
    } else throw new Error(`Argumento no admitido: ${token}.`);
  }
  return { command, options };
}

function printDryRun(command, options, users, logger) {
  logger.log(`Simulación SW-070: ${command}; no se creará cliente ni se escribirá en Supabase.`);
  logger.log(`Se validarían ${users.length} alta(s), se reutilizaría el municipio por slug y se crearían/reutilizarían Auth, perfil y membresía.`);
  if (options['resend-invite']) logger.log('Se solicitaría el reenvío explícito de invitaciones para usuarios Auth existentes.');
  else logger.log('No se reenviará ninguna invitación existente sin --resend-invite.');
  if (options['change-role']) logger.log('Se permitiría explícitamente cambiar el rol de una membresía existente (--change-role).');
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const municipality = { slug: options['municipality-slug'], name: options['municipality-name'] };
  let users = options['from-file']
    ? loadBulkUsers(options['from-file'])
    : [{ email: options.email, role: command === 'municipality' ? 'municipal_admin' : options.role, name: options.name }];
  // Normalize in place so the validated/normalized array is what the rest of main() actually uses
  // (the previous forEach built throwaway objects and discarded the normalized values).
  users = users.map((user) => ({
    ...user,
    email: normalizedEmail(user.email),
    name: requiredText(user.name, 'un nombre de usuario'),
    role: validateRole(user.role)
  }));
  if (command === 'municipality') {
    requiredText(municipality.slug, 'un slug de municipio');
    requiredText(municipality.name, 'un nombre de municipio');
    if (users.length !== 1 || users[0].role !== 'municipal_admin') throw new Error('municipality requiere exactamente un municipal_admin.');
  } else {
    requiredText(municipality.slug, 'el slug del municipio');
  }

  if (options['dry-run']) {
    printDryRun(command, options, users, console);
    return;
  }
  const apiUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno protegido.');
  const client = await createRemoteServiceClient(apiUrl, serviceRoleKey);
  const result = command === 'municipality'
    ? await provisionMunicipality({ client, municipality, user: users[0], resendInvite: Boolean(options['resend-invite']), changeRole: Boolean(options['change-role']) })
    : await addMunicipalityUsers({ client, municipalitySlug: municipality.slug, users, resendInvite: Boolean(options['resend-invite']), changeRole: Boolean(options['change-role']) });
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

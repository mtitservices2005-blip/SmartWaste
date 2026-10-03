import assert from 'node:assert/strict';
import { provisionMunicipality, addMunicipalityUsers } from '../scripts/seed-empty-municipality-remote.mjs';

const logSentinel = 'must-not-appear-in-progress-output';

function createSimulatedClient({ failProfileUpsertOnce = false, failInviteOnce = false } = {}) {
  const state = {
    municipalities: [],
    users: [],
    profiles: [],
    memberships: [],
    drivers: [],
    inviteCalls: 0,
    failProfileUpsertOnce,
    failInviteOnce
  };

  function result(data, error = null) {
    return Promise.resolve({ data, error });
  }

  function table(name) {
    const rows = state[name];
    return {
      select() {
        const filters = [];
        const matches = () => rows.filter((row) => filters.every(([column, value]) => row[column] === value));
        return {
          eq(column, value) { filters.push([column, value]); return this; },
          async maybeSingle() {
            return result(matches()[0] ?? null);
          },
          // Collection resolution: awaiting the builder returns every matching row as {data, error},
          // exactly like supabase-js. `then` makes the chain a thenable so
          // `await ...select('*').eq().eq()` works — needed by ensureDriverRecord's homonym fallback,
          // which must tolerate 2+ rows (maybeSingle would error on that).
          then(resolve) {
            resolve({ data: matches(), error: null });
          }
        };
      },
      insert(payload) {
        return {
          select() {
            return {
              async single() {
                if (name !== 'municipalities' && name !== 'drivers') throw new Error(`unexpected insert into ${name}`);
                const idPrefix = name === 'drivers' ? 'driver' : 'municipality';
                const row = { id: `${idPrefix}-${rows.length + 1}`, ...payload };
                rows.push(row);
                return result(row);
              }
            };
          }
        };
      },
      update(payload) {
        return {
          eq(column, value) {
            return {
              select() {
                return {
                  async single() {
                    const match = rows.find((row) => row[column] === value);
                    if (match) Object.assign(match, payload);
                    return result(match ?? null);
                  }
                };
              }
            };
          }
        };
      },
      upsert(payload) {
        return {
          select() {
            return {
              async single() {
                if (name === 'profiles' && state.failProfileUpsertOnce) {
                  state.failProfileUpsertOnce = false;
                  return result(null, { message: 'simulated profile failure' });
                }
                const match = name === 'profiles'
                  ? rows.find((row) => row.id === payload.id)
                  : rows.find((row) => row.municipality_id === payload.municipality_id && row.profile_id === payload.profile_id);
                if (match) Object.assign(match, payload);
                else rows.push({ id: `${name}-${rows.length + 1}`, ...payload });
                return result(match ?? rows.at(-1));
              }
            };
          }
        };
      }
    };
  }

  return {
    state,
    auth: {
      admin: {
        async listUsers() { return result({ users: state.users, nextPage: null }); },
        async inviteUserByEmail(email) {
          state.inviteCalls += 1;
          if (state.failInviteOnce) {
            state.failInviteOnce = false;
            return result(null, { message: 'simulated invitation failure' });
          }
          const user = { id: `user-${state.users.length + 1}`, email };
          state.users.push(user);
          return result({ user });
        }
      }
    },
    from: table
  };
}

async function capture(action) {
  const lines = [];
  const value = await action({ log: (line) => lines.push(line), error: (line) => lines.push(line) });
  return { value, output: lines.join('\n') };
}

try {
  {
    const client = createSimulatedClient({ failInviteOnce: true });
    const first = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'pilot-town', name: 'Pilot Town' },
      user: { email: 'admin@example.test', name: 'Pilot Admin', role: 'municipal_admin' },
      logger
    }));
    assert.equal(first.value.ok, false);
    assert.deepEqual(first.value.steps, { municipality: 'created', authUser: 'failed', profile: 'pending', membership: 'pending' });
    assert.equal(client.state.municipalities.length, 1);
    assert.equal(client.state.users.length, 0);

    const retry = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'pilot-town', name: 'Pilot Town' },
      user: { email: 'admin@example.test', name: 'Pilot Admin', role: 'municipal_admin' },
      logger
    }));
    assert.equal(retry.value.ok, true);
    assert.deepEqual(retry.value.steps, { municipality: 'reused', authUser: 'invited', profile: 'upserted', membership: 'upserted' });
    assert.equal(client.state.municipalities.length, 1, 'retry must reuse the municipality');
    assert.equal(client.state.users.length, 1);
    assert.equal(client.state.memberships.length, 1);
    assert.equal(`${first.output}\n${retry.output}`.includes(logSentinel), false, 'output must not expose a secret/token sentinel');
  }

  {
    const client = createSimulatedClient({ failProfileUpsertOnce: true });
    const first = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'retry-town', name: 'Retry Town' },
      user: { email: 'dispatcher@example.test', name: 'Pilot Dispatcher', role: 'dispatcher' },
      logger
    }));
    assert.equal(first.value.ok, false);
    assert.deepEqual(first.value.steps, { municipality: 'created', authUser: 'invited', profile: 'failed', membership: 'pending' });
    assert.equal(client.state.inviteCalls, 1);

    const retry = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'retry-town', name: 'Retry Town' },
      user: { email: 'dispatcher@example.test', name: 'Pilot Dispatcher', role: 'dispatcher' },
      logger
    }));
    assert.equal(retry.value.ok, true);
    assert.equal(retry.value.steps.authUser, 'reused');
    assert.equal(client.state.inviteCalls, 1, 'an existing Auth user must never be reinvited on retry');
    assert.equal(client.state.profiles.length, 1);
    assert.equal(client.state.memberships.length, 1);
  }

  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-existing', slug: 'existing-town', name: 'Existing Town' });
    const summary = await addMunicipalityUsers({
      client,
      municipalitySlug: 'existing-town',
      users: [
        { email: 'supervisor@example.test', name: 'Pilot Supervisor', role: 'supervisor' },
        { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' }
      ],
      logger: { log() {}, error() {} }
    });
    assert.equal(summary.ok, true);
    assert.equal(client.state.inviteCalls, 2);
    await assert.rejects(
      () => addMunicipalityUsers({ client, municipalitySlug: 'existing-town', users: [{ email: 'owner@example.test', name: 'Owner', role: 'mt_superadmin' }] }),
      /mt_superadmin/
    );
  }

  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-resend', slug: 'resend-town', name: 'Resend Town' });
    client.state.users.push({ id: 'user-existing', email: 'existing@example.test' });
    const withoutResend = await provisionMunicipality({
      client,
      municipality: { slug: 'resend-town', name: 'Resend Town' },
      user: { email: 'existing@example.test', name: 'Existing Member', role: 'dispatcher' },
      logger: { log() {}, error() {} }
    });
    assert.equal(withoutResend.steps.authUser, 'reused');
    assert.equal(client.state.inviteCalls, 0, 'existing users must not be reinvited by default');

    const withResend = await provisionMunicipality({
      client,
      municipality: { slug: 'resend-town', name: 'Resend Town' },
      user: { email: 'existing@example.test', name: 'Existing Member', role: 'dispatcher' },
      resendInvite: true,
      logger: { log() {}, error() {} }
    });
    assert.equal(withResend.steps.authUser, 'resent');
    assert.equal(client.state.inviteCalls, 1, 'resend requires an explicit flag');
  }

  // Hallazgo 1: el rol driver también crea/reutiliza idempotentemente la fila en `drivers`.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-driver', slug: 'driver-town', name: 'Driver Town' });
    const first = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'driver-town', name: 'Driver Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(first.value.ok, true);
    assert.deepEqual(first.value.steps, { municipality: 'reused', authUser: 'invited', profile: 'upserted', membership: 'upserted', driverRecord: 'created' });
    assert.equal(client.state.drivers.length, 1, 'provisioning a driver must create exactly one drivers row');
    assert.equal(client.state.drivers[0].municipality_id, 'municipality-driver');
    assert.equal(client.state.drivers[0].profile_id, first.value.user.id);
    assert.equal(client.state.drivers[0].display_name, 'Pilot Driver');

    const retry = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'driver-town', name: 'Driver Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(retry.value.ok, true);
    assert.equal(retry.value.steps.driverRecord, 'reused');
    assert.equal(client.state.drivers.length, 1, 'retrying must reuse the drivers row, never duplicate it');
  }

  // Hallazgo 1: un rol distinto de driver no crea ninguna fila en `drivers`.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-sup', slug: 'sup-town', name: 'Sup Town' });
    const result = await provisionMunicipality({
      client,
      municipality: { slug: 'sup-town', name: 'Sup Town' },
      user: { email: 'supervisor@example.test', name: 'Pilot Supervisor', role: 'supervisor' },
      logger: { log() {}, error() {} }
    });
    assert.equal(result.ok, true);
    assert.equal('driverRecord' in result.steps, false, 'non-driver roles must not track a drivers step');
    assert.equal(client.state.drivers.length, 0, 'non-driver roles must not create a drivers row');
  }

  // Hallazgo 1 (revisión 3): ensureDriverRecord debe vincularse a (municipality_id, profile_id).
  // (a) mismo profile + municipio reutiliza — cubierto arriba: el retry en 'driver-town' devuelve
  //     driverRecord 'reused' y no duplica la fila.

  // (b) otro perfil con el MISMO display_name en el mismo municipio: NO se reutiliza, se crea una
  //     segunda fila para el perfil solicitado y la ajena queda intacta.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-dupname', slug: 'dup-name-town', name: 'Dup Name Town' });
    client.state.drivers.push({ id: 'driver-other', municipality_id: 'municipality-dupname', display_name: 'Pilot Driver', profile_id: 'other-profile' });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'dup-name-town', name: 'Dup Name Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(result.value.ok, true);
    assert.equal(result.value.steps.driverRecord, 'created', 'una fila homónima de otro profile_id no debe reutilizarse');
    assert.equal(client.state.drivers.length, 2, 'debe crearse una segunda fila para el perfil solicitado');
    const created = client.state.drivers.find((row) => row.profile_id === result.value.user.id);
    assert.ok(created, 'debe existir una fila ligada al profile_id solicitado');
    assert.equal(created.municipality_id, 'municipality-dupname');
    assert.equal(client.state.drivers[0].profile_id, 'other-profile', 'la fila del otro perfil no debe modificarse');
  }

  // (c) fila del MISMO profile en OTRO municipio: NO se toma como reusable; se crea la fila del
  //     municipio solicitado y la del otro municipio queda intacta.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-target', slug: 'target-town', name: 'Target Town' });
    client.state.users.push({ id: 'user-cross', email: 'cross@example.test' });
    client.state.drivers.push({ id: 'driver-cross', municipality_id: 'municipality-other', display_name: 'Cross Driver', profile_id: 'user-cross' });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'target-town', name: 'Target Town' },
      user: { email: 'cross@example.test', name: 'Cross Driver', role: 'driver' },
      logger
    }));
    assert.equal(result.value.ok, true);
    assert.equal(result.value.steps.driverRecord, 'created', 'una fila del mismo profile en otro municipio no debe reutilizarse');
    assert.equal(client.state.drivers.length, 2, 'debe crearse la fila del municipio solicitado');
    const created = client.state.drivers.find((row) => row.municipality_id === 'municipality-target');
    assert.ok(created, 'debe existir la fila del municipio solicitado');
    assert.equal(created.profile_id, 'user-cross');
    assert.equal(client.state.drivers[0].municipality_id, 'municipality-other', 'la fila del otro municipio no debe modificarse');
  }

  // (d) fila homónima sin profile_id en el municipio solicitado: se vincula de forma idempotente.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-legacy', slug: 'legacy-town', name: 'Legacy Town' });
    client.state.drivers.push({ id: 'driver-legacy', municipality_id: 'municipality-legacy', display_name: 'Pilot Driver', profile_id: null });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'legacy-town', name: 'Legacy Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(result.value.ok, true);
    assert.equal(result.value.steps.driverRecord, 'reused', 'una fila sin profile_id debe vincularse, no duplicarse');
    assert.equal(client.state.drivers.length, 1);
    assert.equal(client.state.drivers[0].profile_id, result.value.user.id, 'la fila heredada debe quedar vinculada al perfil');
  }

  // (e) DOS filas homónimas preexistentes (mismo municipio + display_name) ya ligadas a OTROS
  //     profile_id: la tabla no garantiza unicidad de esa combinación y el fallback debe tolerar
  //     múltiples resultados. Provisionar un TERCER homónimo debe salir ok, crear una fila nueva y
  //     dejar intactas las dos originales (antes, un maybeSingle() habría fallado con 2+ filas).
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-multi', slug: 'multi-town', name: 'Multi Town' });
    client.state.drivers.push({ id: 'driver-a', municipality_id: 'municipality-multi', display_name: 'Pilot Driver', profile_id: 'other-profile-a' });
    client.state.drivers.push({ id: 'driver-b', municipality_id: 'municipality-multi', display_name: 'Pilot Driver', profile_id: 'other-profile-b' });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'multi-town', name: 'Multi Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(result.value.ok, true, 'provisionar un tercer homónimo debe salir ok');
    assert.equal(result.value.steps.driverRecord, 'created', 'ninguna fila homónima ajena debe reutilizarse');
    assert.equal(client.state.drivers.length, 3, 'deben quedar tres filas: las dos originales más la nueva');
    assert.equal(client.state.drivers[0].profile_id, 'other-profile-a', 'la primera fila ajena no debe modificarse');
    assert.equal(client.state.drivers[1].profile_id, 'other-profile-b', 'la segunda fila ajena no debe modificarse');
    const created = client.state.drivers.find((row) => row.profile_id === result.value.user.id);
    assert.ok(created, 'debe existir una fila ligada al profile_id solicitado');
    assert.equal(created.municipality_id, 'municipality-multi');
  }

  // (f) Varios homónimos en el municipio y SOLO UNA fila sin profile_id: se vincula esa única fila
  //     y NO se crea ninguna otra (idempotente), dejando intactas las filas ajenas.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-mix', slug: 'mix-town', name: 'Mix Town' });
    client.state.drivers.push({ id: 'driver-owned', municipality_id: 'municipality-mix', display_name: 'Pilot Driver', profile_id: 'other-profile-x' });
    client.state.drivers.push({ id: 'driver-legacy-mix', municipality_id: 'municipality-mix', display_name: 'Pilot Driver', profile_id: null });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'mix-town', name: 'Mix Town' },
      user: { email: 'driver@example.test', name: 'Pilot Driver', role: 'driver' },
      logger
    }));
    assert.equal(result.value.ok, true);
    assert.equal(result.value.steps.driverRecord, 'reused', 'debe vincular la fila sin profile_id, no crear otra');
    assert.equal(client.state.drivers.length, 2, 'no debe crearse una fila adicional');
    const legacy = client.state.drivers.find((row) => row.id === 'driver-legacy-mix');
    assert.equal(legacy.profile_id, result.value.user.id, 'la fila sin owner debe quedar ligada al perfil');
    assert.equal(client.state.drivers.find((row) => row.id === 'driver-owned').profile_id, 'other-profile-x', 'la fila ajena debe quedar intacta');
  }

  // Hallazgo 2: no se cambia el rol de una membresía existente sin --change-role explícito.
  {
    const client = createSimulatedClient();
    client.state.municipalities.push({ id: 'municipality-role', slug: 'role-town', name: 'Role Town' });
    client.state.users.push({ id: 'user-role', email: 'member@example.test' });
    client.state.profiles.push({ id: 'user-role', display_name: 'Member', email: 'member@example.test' });
    client.state.memberships.push({ id: 'membership-role', municipality_id: 'municipality-role', profile_id: 'user-role', role: 'supervisor', status: 'active' });

    const blocked = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'role-town', name: 'Role Town' },
      user: { email: 'member@example.test', name: 'Member', role: 'driver' },
      logger
    }));
    assert.equal(blocked.value.ok, false, 'a role change without --change-role must fail');
    assert.equal(blocked.value.steps.membership, 'failed');
    assert.match(String(blocked.value.error), /--change-role/, 'the failure must name --change-role explicitly');
    assert.equal(client.state.memberships[0].role, 'supervisor', 'a role change without --change-role must not modify the membership');

    const changed = await provisionMunicipality({
      client,
      municipality: { slug: 'role-town', name: 'Role Town' },
      user: { email: 'member@example.test', name: 'Member', role: 'driver' },
      changeRole: true,
      logger: { log() {}, error() {} }
    });
    assert.equal(changed.ok, true);
    assert.equal(changed.steps.membership, 'upserted');
    assert.equal(client.state.memberships[0].role, 'driver', 'changeRole:true must update the membership role');
  }

  // Hallazgo 3: reenviar una invitación a una cuenta ya confirmada falla de forma clara y sin
  // exponer ningún enlace/token; nunca se lanza una excepción genérica que oculte el contexto.
  {
    const client = createSimulatedClient({ failInviteOnce: true });
    client.state.municipalities.push({ id: 'municipality-resendfail', slug: 'resend-fail-town', name: 'Resend Fail Town' });
    client.state.users.push({ id: 'user-confirmed', email: 'confirmed@example.test' });
    const result = await capture((logger) => provisionMunicipality({
      client,
      municipality: { slug: 'resend-fail-town', name: 'Resend Fail Town' },
      user: { email: 'confirmed@example.test', name: 'Confirmed Member', role: 'dispatcher' },
      resendInvite: true,
      logger
    }));
    assert.equal(result.value.ok, false);
    assert.equal(result.value.steps.authUser, 'resend_failed', 'a failed resend must be reported distinctly');
    assert.equal(typeof result.value.error, 'string');
    assert.equal(/http/i.test(result.value.error), false, 'the resend failure message must not contain any link/token');
    assert.equal(result.output.includes('http'), false, 'progress output must not expose a link');
  }

  console.log('SW-070 resumable provisioning tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

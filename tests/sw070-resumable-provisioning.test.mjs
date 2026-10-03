import assert from 'node:assert/strict';
import { provisionMunicipality, addMunicipalityUsers } from '../scripts/seed-empty-municipality-remote.mjs';

const logSentinel = 'must-not-appear-in-progress-output';

function createSimulatedClient({ failProfileUpsertOnce = false, failInviteOnce = false } = {}) {
  const state = {
    municipalities: [],
    users: [],
    profiles: [],
    memberships: [],
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
        return {
          eq(column, value) { filters.push([column, value]); return this; },
          async maybeSingle() {
            const matches = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
            return result(matches[0] ?? null);
          }
        };
      },
      insert(payload) {
        return {
          select() {
            return {
              async single() {
                if (name !== 'municipalities') throw new Error(`unexpected insert into ${name}`);
                const row = { id: `municipality-${rows.length + 1}`, ...payload };
                rows.push(row);
                return result(row);
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

  console.log('SW-070 resumable provisioning tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

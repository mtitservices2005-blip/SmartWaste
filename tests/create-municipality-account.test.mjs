import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMunicipalityAccountHandler,
  generateTemporaryPassword,
  municipalitySlug
} from '../supabase/functions/create-municipality-account/handler.js';

const env = { get(name) {
  return { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }[name];
} };

function request(body = {}, options = {}) {
  return new Request('http://local/functions/v1/create-municipality-account', {
    method: options.method ?? 'POST',
    headers: options.auth === false ? {} : { Authorization: 'Bearer caller-jwt' },
    body: (options.method ?? 'POST') === 'POST' ? JSON.stringify(body) : undefined
  });
}

function fakeClients({ authorized = true, failAt = null } = {}) {
  const events = [];
  const caller = { auth: { async getUser() {
    return { data: { user: { id: 'superadmin-1' } }, error: null };
  } } };
  const terminal = (value) => ({ select() { return { async single() { return value; } }; } });
  const deletion = (table) => ({ eq(column, value) {
    events.push(`delete:${table}:${column}:${value}`);
    return Promise.resolve({ error: null });
  } });
  const service = {
    auth: { admin: {
      async createUser(payload) {
        events.push(['createUser', payload]);
        return failAt === 'user' ? { error: { message: 'user failed' } } : { data: { user: { id: 'admin-1' } }, error: null };
      },
      async deleteUser(id) { events.push(`deleteUser:${id}`); return { error: null }; }
    } },
    from(table) {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            limit() { return chain; },
            async maybeSingle() {
              return { data: authorized ? { role: 'mt_superadmin' } : null, error: null };
            }
          };
          return chain;
        },
        insert(payload) {
          events.push([`insert:${table}`, payload]);
          if (table === 'municipalities') return terminal(failAt === 'municipality'
            ? { data: null, error: { message: 'municipality failed' } }
            : { data: { id: 'municipality-1', ...payload }, error: null });
          if (table === 'profiles') return terminal(failAt === 'profile'
            ? { data: null, error: { message: 'profile failed' } }
            : { data: payload, error: null });
          return terminal(failAt === 'membership'
            ? { data: null, error: { message: 'membership failed' } }
            : { data: { id: 'membership-1', ...payload }, error: null });
        },
        delete() { return deletion(table); }
      };
    }
  };
  return { createClient(_url, key) { return key === 'anon' ? caller : service; }, events };
}

test('temporary password and municipality slug are generated without shared credentials', () => {
  const password = generateTemporaryPassword();
  assert.ok(password.length > 0 && password.length <= 12);
  assert.match(password, /^[A-Za-z0-9]+$/);
  assert.match(municipalitySlug('San José de Ocoa'), /^san-jose-de-ocoa-[a-f0-9]{8}$/);
});

test('only an authenticated active mt_superadmin can provision', async () => {
  const missingAuth = fakeClients();
  const handler = createMunicipalityAccountHandler({ createClient: missingAuth.createClient, env });
  assert.equal((await handler(request({}, { auth: false }))).status, 401);

  const denied = fakeClients({ authorized: false });
  const deniedResponse = await createMunicipalityAccountHandler({ createClient: denied.createClient, env })(
    request({ municipality_name: 'Municipio Nuevo', admin_email: 'admin@example.com' })
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.events.length, 0);
});

test('creates municipality, temporary admin account, profile, and municipal_admin membership', async () => {
  const fake = fakeClients();
  const response = await createMunicipalityAccountHandler({ createClient: fake.createClient, env })(
    request({ municipality_name: 'Municipio Nuevo', admin_email: 'ADMIN@Example.com' })
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.municipality.id, 'municipality-1');
  assert.equal(body.profile_id, 'admin-1');
  assert.ok(body.temporary_password.length > 0 && body.temporary_password.length <= 12);
  const userPayload = fake.events.find((event) => Array.isArray(event) && event[0] === 'createUser')[1];
  assert.equal(userPayload.email, 'admin@example.com');
  assert.equal(userPayload.user_metadata.requires_password_change, true);
  const membership = fake.events.find((event) => Array.isArray(event) && event[0] === 'insert:memberships')[1];
  assert.deepEqual(membership, {
    municipality_id: 'municipality-1', profile_id: 'admin-1', role: 'municipal_admin', status: 'active'
  });
});

test('rolls back completed steps in reverse order when membership creation fails', async () => {
  const fake = fakeClients({ failAt: 'membership' });
  const response = await createMunicipalityAccountHandler({ createClient: fake.createClient, env })(
    request({ municipality_name: 'Municipio Nuevo', admin_email: 'admin@example.com' })
  );
  assert.equal(response.status, 500);
  assert.deepEqual(fake.events.slice(-3), [
    'delete:profiles:id:admin-1',
    'deleteUser:admin-1',
    'delete:municipalities:id:municipality-1'
  ]);
});

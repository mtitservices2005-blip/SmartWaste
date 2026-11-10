// SW-120: alta de un ayuntamiento nuevo desde Master Admin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateNewMunicipality, onboardingErrorMessage, createMunicipalityAccount, credentialsMessage } from '../shared/municipality-onboarding.js';
import { renderNewMunicipality } from '../frontend/components/municipality-onboarding-screen.js';

// validar
assert.equal(validateNewMunicipality({}).valid, false);
assert.equal(validateNewMunicipality({ name: 'Laguna Salada', email: 'a@b.do' }).valid, true);
assert.equal(validateNewMunicipality({ name: 'Laguna Salada', email: 'A@B.DO ' }).value.email, 'a@b.do');
assert.equal(validateNewMunicipality({ name: 'ab', email: 'a@b.do' }).valid, false);
assert.equal(validateNewMunicipality({ name: 'x'.repeat(121), email: 'a@b.do' }).valid, false);
assert.equal(validateNewMunicipality({ name: 'Laguna', email: 'sin-arroba' }).valid, false);
for (const t of [0, 51, 2.5, 'x', -1]) assert.equal(validateNewMunicipality({ name: 'Laguna', email: 'a@b.do', trucks: t }).valid, false, `camiones ${t}`);
assert.equal(validateNewMunicipality({ name: 'Laguna', email: 'a@b.do', trucks: '12' }).value.trucks, 12);

// errores traducidos
assert.match(onboardingErrorMessage('A user with this email address has already been registered'), /ya tiene una cuenta/);
assert.match(onboardingErrorMessage('Caller is not authorized to create municipalities'), /Solo Master Admin/);
assert.match(onboardingErrorMessage('Invalid or expired session'), /sesión venció/);
assert.match(onboardingErrorMessage('Edge Function returned a non-2xx status code'), /contactar/);
assert.equal(onboardingErrorMessage('algo raro'), null);

// llamada
const calls = [];
const okClient = { functions: { invoke: async (name, opts) => { calls.push([name, opts]); return { data: { ok: true, municipality: { id: 'm1', name: 'Laguna Salada' }, temporary_password: 'Abc123xyz789', license: { valid_until: '2026-12-31', contracted_trucks: 5 } }, error: null }; } } };
const r = await createMunicipalityAccount(okClient, { name: ' Laguna  Salada ', email: 'ADMIN@lagunasalada.gob.do' });
assert.equal(r.ok, true); assert.equal(r.temporaryPassword, 'Abc123xyz789'); assert.equal(r.municipalityId, 'm1');
assert.equal(calls[0][0], 'create-municipality-account');
assert.deepEqual(calls[0][1].body, { municipality_name: 'Laguna Salada', admin_email: 'admin@lagunasalada.gob.do', trucks: 5, trial_days: 60 });
assert.equal((await createMunicipalityAccount(null, { name: 'Laguna', email: 'a@b.do' })).ok, false);
const invalid = await createMunicipalityAccount(okClient, { name: '', email: '' });
assert.equal(invalid.ok, false); assert.equal(calls.length, 1, 'con datos inválidos no se llama a la función');
const httpErr = { functions: { invoke: async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'A user with this email address has already been registered' }) } } }) } };
assert.match((await createMunicipalityAccount(httpErr, { name: 'Laguna', email: 'a@b.do' })).message, /ya tiene una cuenta/);
const noBody = { functions: { invoke: async () => ({ data: null, error: { message: 'boom', context: { json: async () => { throw new Error('x'); } } } }) } };
assert.match((await createMunicipalityAccount(noBody, { name: 'Laguna', email: 'a@b.do' })).message, /boom/);
const odd = { functions: { invoke: async () => ({ data: { ok: false }, error: null }) } };
assert.match((await createMunicipalityAccount(odd, { name: 'Laguna', email: 'a@b.do' })).message, /sin crear/);

// mensaje para el administrador
const msg = credentialsMessage({ name: 'Laguna Salada', email: 'a@b.do', temporaryPassword: 'Abc123', appUrl: 'https://app.test' });
for (const w of ['Laguna Salada', 'a@b.do', 'Abc123', 'https://app.test', 'crear tu propia contraseña']) assert.ok(msg.includes(w), w);

// pantalla
assert.ok(renderNewMunicipality({}).includes('data-onboard-open'));
const form = renderNewMunicipality({ open: true, values: { name: '"><script>x</script>' }, error: '<b>mal</b>' });
assert.ok(!form.includes('<script>') && !form.includes('<b>mal</b>'), 'se escapa lo escrito');
for (const w of ['data-onboard-form', 'name="email"', 'name="trucks"', 'role="alert"', 'data-onboard-create']) assert.ok(form.includes(w), w);
assert.ok(renderNewMunicipality({ open: true, busy: true }).includes('data-onboard-create disabled'));
const done = renderNewMunicipality({ created: { name: 'Laguna <b>', email: 'a@b.do', temporaryPassword: 'Abc123', trucks: 5, validUntil: '2026-12-31' } });
assert.ok(done.includes('Abc123') && done.includes('solo se muestra ahora') && done.includes('data-onboard-copy') && !done.includes('Laguna <b>'));

// cableado
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
for (const w of ['renderMasterNewMunicipality()', 'createMunicipalityAccount(getAuthClient()', 'data-onboard-form', 'reloadMasterMunicipalities()']) assert.ok(app.includes(w), w);
const master = app.slice(app.indexOf('function renderMaster()'));
assert.ok(master.indexOf('masterNewMunicipality') > 0 && master.indexOf('masterNewMunicipality') < master.indexOf('id="masterMunicipalities"'), 'el formulario va arriba de la lista');
console.log('sw120-alta-ayuntamiento ok');

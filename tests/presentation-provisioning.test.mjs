import assert from 'node:assert/strict';
import { readPresentationProvisioningConfig } from '../shared/presentation-provisioning.js';

const valid = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
  SUPABASE_EXPECTED_PROJECT_REF: 'project-ref',
  SMARTWASTE_PRESENTATION_CONFIRM: 'PROVISION_project-ref_LAGUNA_SALADA',
  PRESENTATION_ADMIN_EMAIL: 'admin@example.test',
  PRESENTATION_ADMIN_PASSWORD: 'admin-password-123',
  PRESENTATION_DRIVER_EMAIL: 'driver@example.test',
  PRESENTATION_DRIVER_PASSWORD: 'driver-password-123'
};

const parsed = readPresentationProvisioningConfig(valid);
assert.equal(parsed.projectRef, 'project-ref');
assert.equal(parsed.rotatePasswords, false);
assert.equal(parsed.serviceRoleKey, 'server-only-key');

assert.throws(() => readPresentationProvisioningConfig({}), /Faltan variables requeridas/);
assert.throws(() => readPresentationProvisioningConfig({ ...valid, SUPABASE_EXPECTED_PROJECT_REF: 'other' }), /no coincide/);
assert.throws(() => readPresentationProvisioningConfig({ ...valid, SMARTWASTE_PRESENTATION_CONFIRM: 'wrong' }), /Confirmacion requerida/);
assert.throws(() => readPresentationProvisioningConfig({ ...valid, PRESENTATION_DRIVER_PASSWORD: 'short' }), /12 caracteres/);
assert.throws(() => readPresentationProvisioningConfig({ ...valid, PRESENTATION_DRIVER_EMAIL: valid.PRESENTATION_ADMIN_EMAIL }), /correos diferentes/);

console.log('presentation-provisioning ok');

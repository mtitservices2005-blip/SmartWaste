import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = new URL('../scripts/build-frontend-config.mjs', import.meta.url);
const baseEnv = { ...process.env, SMARTWASTE_REQUIRE_BACKEND: 'true' };

const missing = spawnSync(process.execPath, [script.pathname], {
  encoding: 'utf8',
  env: baseEnv
});
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_MUNICIPALITY_ID/);

const insecure = spawnSync(process.execPath, [script.pathname], {
  encoding: 'utf8',
  env: {
    ...baseEnv,
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_ANON_KEY: 'public-anon-key',
    SUPABASE_MUNICIPALITY_ID: 'municipality-demo'
  }
});
assert.notEqual(insecure.status, 0);
assert.match(insecure.stderr, /exige una SUPABASE_URL con https:\/\//);

const configured = spawnSync(process.execPath, [script.pathname], {
  encoding: 'utf8',
  env: {
    ...baseEnv,
    SUPABASE_URL: 'https://presentation.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-key',
    SUPABASE_MUNICIPALITY_ID: 'municipality-demo',
    SUPABASE_HIDE_DEMO: 'true'
  }
});
assert.equal(configured.status, 0, configured.stderr);
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.match(html, /https:\/\/presentation\.supabase\.co/);
assert.match(html, /"municipality_id":"municipality-demo"/);
assert.match(html, /"hideDemo":true/);

console.log('presentation-readiness ok');

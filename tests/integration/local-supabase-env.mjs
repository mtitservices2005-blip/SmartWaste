import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// Reads connection info from the running local Supabase CLI instance instead of hardcoding keys
// in the repo. Requires `supabase start` (see supabase/README.md and docs/SW020_CLAUDE_CODE_TASK_BRIEF.md).
export function loadLocalSupabaseEnv() {
  let raw;
  try {
    // Windows resolves npx via npx.cmd, which requires shell:true to spawn; the args here are
    // fixed literals (never user input), so this is not a shell-injection risk.
    raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: process.cwd(), encoding: 'utf8', shell: true });
  } catch (error) {
    throw new Error(`Local Supabase is not running (npx supabase status failed). Run "npx supabase start" first. Original error: ${error.message}`);
  }
  const jsonStart = raw.indexOf('{');
  const env = JSON.parse(raw.slice(jsonStart));
  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) throw new Error('Local Supabase status did not return API_URL/ANON_KEY/SERVICE_ROLE_KEY');
  return env;
}

export function createServiceClient(env) {
  return createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function createAnonClient(env) {
  return createClient(env.API_URL, env.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function createSignedInClient(env, email, password) {
  const client = createAnonClient(env);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

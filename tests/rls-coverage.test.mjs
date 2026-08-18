// SW-038 (docs/TECHNICAL_DEBT_REGISTER.md item #3): sw008_rls_draft.sql enables RLS on 7 tables
// with zero policies of their own — that's only safe if sw014_auth_rls_policies.sql (the migration
// that actually adds policies to those tables) finishes applying in the same deploy. Each migration
// file runs in its own transaction, so a deploy interrupted between the two leaves those tables
// RLS-enabled-but-policy-less: not a data leak (RLS with no policies fails closed, denies
// everything), but a silent outage — every read/write against them just returns nothing/fails,
// with no error pointing at the real cause. This test makes that state loud and gating instead of
// silent: it asserts, against a real running Postgres, that no table in `public` has RLS enabled
// without at least one policy. It has nothing to fix by itself — recovery is simply re-running
// `npx supabase start`/`db push`, since the Supabase CLI tracks applied migrations per file and
// only re-runs pending ones (see the recovery note added to supabase/README.md). What this test
// guards against is a FUTURE migration repeating the same gap (enabling RLS in one file, adding
// policies only in a later one) without anyone noticing until data goes missing in production.
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadLocalSupabaseEnv } from './integration/local-supabase-env.mjs';

const env = loadLocalSupabaseEnv();
if (!env.DB_URL) throw new Error('npx supabase status -o json did not return DB_URL — cannot connect directly to Postgres.');

const db = new pg.Client({ connectionString: env.DB_URL });
await db.connect();
try {
  const result = await db.query(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
      and not exists (
        select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
      )
    order by c.relname;
  `);
  assert.deepEqual(
    result.rows.map((row) => row.table_name),
    [],
    'Tabla(s) con RLS habilitado y sin ninguna política — deploy interrumpido entre sw008_rls_draft y sw014_auth_rls_policies, o una migración nueva repitió el mismo hueco. Recuperación: volver a correr las migraciones pendientes (ver supabase/README.md).'
  );
  console.log('rls-coverage ok — ninguna tabla con RLS habilitado sin políticas');
} finally {
  await db.end();
}

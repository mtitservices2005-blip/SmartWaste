// SW-022: diagnostic-only script for docs/TECHNICAL_DEBT_REGISTER.md item #14 (Supabase Realtime
// postgres_changes never delivers vehicle_positions INSERT events, despite the channel reaching
// SUBSCRIBED). Previous attempts (PR #17) fixed real bugs along the way but never found the root
// cause, because everything visible from the client side (subscribe status, PostgREST responses,
// the Realtime container's own stdout logs) looked correct or gave no error. This script bypasses
// all of that and inspects Postgres directly — the publication, the replication slots, and
// Realtime's internal `realtime.subscription` bookkeeping table — right after a real
// postgres_changes subscribe() call, to see what the server actually did (or didn't do) to fulfill
// it. Requires `npx supabase start`; not part of the pass/fail CI gate (see .github/workflows/
// tests.yml) — it prints evidence and always exits 0, because it's meant to be read, not asserted.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadLocalSupabaseEnv, createServiceClient, createSignedInClient } from './integration/local-supabase-env.mjs';
import { seedScenario } from './integration/seed.mjs';
import { createSupabaseOperationsAdapter } from '../shared/operations-adapter.js';
import { createTelemetryIngestionAdapter } from '../shared/telemetry-simulator.js';

const env = loadLocalSupabaseEnv();
if (!env.DB_URL) throw new Error('npx supabase status -o json did not return DB_URL — cannot connect directly to Postgres.');

const service = createServiceClient(env);
const scenario = await seedScenario(service);

const dispatcherClient = await createSignedInClient(env, scenario.dispatcherA.email, scenario.dispatcherA.password);
const driverClient = await createSignedInClient(env, scenario.driverUserA.email, scenario.driverUserA.password);
const dispatcherAdapter = createSupabaseOperationsAdapter(dispatcherClient, { municipality_id: scenario.municipalityA.id });

await dispatcherAdapter.assignVehicle(scenario.routeA.id, scenario.vehicleA.id);
await dispatcherAdapter.assignDriver(scenario.routeA.id, scenario.driverRowA.id);

const telemetry = createTelemetryIngestionAdapter(driverClient, { municipality_id: scenario.municipalityA.id });

console.log('=== Subscribing via postgres_changes ===');
const subscribed = await new Promise((resolve) => {
  const timeout = setTimeout(() => resolve({ status: 'TIMED_OUT_WAITING_FOR_SUBSCRIBED' }), 15000);
  telemetry.subscribe(scenario.vehicleA.id, () => {}, {
    onStatus: (status, err) => {
      console.log(`channel status: ${status}${err ? ` (${err.message ?? err})` : ''}`);
      if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve({ status }); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(timeout); resolve({ status, err }); }
    }
  });
});
console.log('subscribe() settled with:', JSON.stringify(subscribed));

// Give the server a moment to do whatever bookkeeping it does after a join, before we inspect it.
await new Promise((resolve) => setTimeout(resolve, 3000));

console.log('\n=== Direct Postgres inspection (bypassing PostgREST/Realtime API entirely) ===');
const db = new pg.Client({ connectionString: env.DB_URL });
await db.connect();

async function show(title, sql) {
  console.log(`\n--- ${title} ---`);
  console.log(`SQL: ${sql}`);
  try {
    const result = await db.query(sql);
    console.log(`rows: ${result.rowCount}`);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.log(`ERROR: ${error.message}`);
  }
}

await show('Is vehicle_positions in the supabase_realtime publication?', `
  select p.pubname, pt.schemaname, pt.tablename
  from pg_publication p
  join pg_publication_tables pt on pt.pubname = p.pubname
  where p.pubname = 'supabase_realtime'
  order by pt.tablename;
`);

await show('All publications on this database (any others realtime might be using)', `
  select pubname, puballtables from pg_publication order by pubname;
`);

await show('Active replication slots', `
  select slot_name, plugin, slot_type, active, active_pid, wal_status
  from pg_replication_slots
  order by slot_name;
`);

await show('Does realtime.subscription exist, and what is in it? (this is the table Realtime is supposed to write a row into when a client subscribes to postgres_changes for a table+filter)', `
  select table_name from information_schema.tables where table_schema = 'realtime' order by table_name;
`);

await show('Contents of realtime.subscription (if it exists)', `
  select * from realtime.subscription order by created_at desc limit 20;
`);

await show('grants on vehicle_positions for realtime-related roles', `
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_name = 'vehicle_positions'
  order by grantee, privilege_type;
`);

await db.end();
console.log('\n=== End of diagnostic. This script always exits 0 — read the output above. ===');
process.exit(0);

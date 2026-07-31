// SCOPE (docs/TECHNICAL_DEBT_REGISTER.md #5): this is a static text/regex check over the migration
// SQL, not a real RLS test — it does not run against Postgres and cannot prove isolation actually
// works. For that, see tests/rls-adversarial.test.mjs (runs against a real local Supabase instance,
// PARTIAL/VERIFIED_REAL status tracked in shared/integration/status.json). This file only guards
// against the SQL text losing the expected policy shape.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('supabase/migrations/202607150004_sw014_auth_rls_policies.sql','utf8');
for (const table of ['vehicles','drivers','routes','route_runs','vehicle_positions','incidents','citizen_reports']) assert.match(sql, new RegExp(`'[^']*tenant_read on %I[^']*'|${table}`));
assert.match(sql, /has_municipality_role\(municipality_id/);
assert.match(sql, /auth\.uid\(\)/);
console.log('rls-static ok');

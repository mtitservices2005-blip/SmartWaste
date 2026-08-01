// SCOPE: static text/regex check on migration SQL — does NOT connect to a database and does NOT
// verify that RLS actually denies cross-tenant access. Real coverage for that lives in
// tests/rls-adversarial.test.mjs (runs against a live Supabase/Postgres instance, see SW-020).
// This file only guards against the migration file losing the policy/table names below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('supabase/migrations/202607150004_sw014_auth_rls_policies.sql','utf8');
for (const table of ['vehicles','drivers','routes','route_runs','vehicle_positions','incidents','citizen_reports']) assert.match(sql, new RegExp(`'[^']*tenant_read on %I[^']*'|${table}`));
assert.match(sql, /has_municipality_role\(municipality_id/);
assert.match(sql, /auth\.uid\(\)/);
console.log('rls-static ok');

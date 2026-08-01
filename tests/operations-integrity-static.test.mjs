// SCOPE: static text/regex check on migration SQL — does NOT connect to a database and does NOT
// verify the triggers actually reject cross-municipality writes. Real coverage for that lives in
// tests/operational-cycle.test.mjs and tests/rls-adversarial.test.mjs (run against a live
// Supabase/Postgres instance, see SW-020). This file only guards against the migration file
// losing the trigger/function names below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('supabase/migrations/202607150005_sw015_operations_integrity.sql','utf8');
for (const name of ['guard_route_run_tenant','guard_vehicle_assignment_tenant','guard_vehicle_position_tenant','guard_incident_tenant']) assert.match(sql, new RegExp(name));
assert.match(sql, /Cross-municipality reference rejected/);
console.log('operations-integrity-static ok');

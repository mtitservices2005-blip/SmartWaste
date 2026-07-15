import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('supabase/migrations/202607150005_sw015_operations_integrity.sql','utf8');
for (const name of ['guard_route_run_tenant','guard_vehicle_assignment_tenant','guard_vehicle_position_tenant','guard_incident_tenant']) assert.match(sql, new RegExp(name));
assert.match(sql, /Cross-municipality reference rejected/);
console.log('operations-integrity-static ok');

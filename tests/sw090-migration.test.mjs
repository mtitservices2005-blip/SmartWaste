// SW-090: migración aditiva (columnas nuevas + función con control de rol); no relaja RLS.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes('sw090'));
assert.deepEqual(files, ['202610160001_sw090_run_metrics.sql']);
const code = readFileSync(new URL(files[0], dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

assert.match(code, /alter table vehicles add column if not exists fuel_efficiency_km_per_l numeric/);
assert.match(code, /alter table vehicles add column if not exists fuel_type text/);
assert.match(code, /fuel_efficiency_km_per_l > 0/);
assert.match(code, /fuel_type in \('diesel', 'gasolina'\)/);
assert.match(code, /alter table route_runs add column if not exists is_test boolean not null default false/);
assert.match(code, /create or replace function set_route_run_test_flag\(p_run_id uuid, p_is_test boolean\)/);
assert.match(code, /security definer/);
assert.match(code, /set search_path = public/);
assert.match(code, /auth\.uid\(\) is null or not has_municipality_role\(v_municipality, array\['municipal_admin','supervisor','dispatcher'\]\)/, 'conductor y otro municipio rechazados');
assert.match(code, /revoke all on function set_route_run_test_flag\(uuid, boolean\) from public, anon;/);
assert.match(code, /grant execute on function set_route_run_test_flag\(uuid, boolean\) to authenticated;/);
for (const word of ['alter policy', 'create policy', 'drop policy', 'disable row level security', 'truncate', 'drop table', 'drop column', 'delete from', 'to anon', 'to public', 'service_role']) {
  assert.ok(!code.includes(word), `no debe contener "${word}"`);
}
console.log('sw090-migration: ok');

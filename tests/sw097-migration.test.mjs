// SW-097: la RPC pública public_live_fleet solo lee, solo expone datos mínimos y no abre tablas a anon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/202610170001_sw097_public_live_fleet.sql', 'utf8');
const lower = sql.toLowerCase();
const start = lower.indexOf('create or replace function public.public_live_fleet');
assert.ok(start > -1, 'define public.public_live_fleet');
const end = lower.indexOf('$$;', lower.indexOf('$$', start) + 2);
const body = lower.slice(start, end);

assert.match(lower, /security definer/);
assert.match(lower, /set search_path = public/);
assert.match(lower, /revoke all on function public\.public_live_fleet\(text\) from public/);
assert.match(lower, /grant execute on function public\.public_live_fleet\(text\) to anon, authenticated/);
assert.match(body, /status in \('started', ?'in_progress', ?'delayed'\)/, 'solo corridas activas');
assert.match(body, /coalesce\(rr\.is_test, ?false\) = false/, 'sin corridas de prueba');
assert.match(body, /limit 50/);
for (const word of ['plate', 'battery_pct', 'display_name', 'phone', 'liters', 'speed', 'driver']) {
  assert.equal(body.includes(word), false, `el cuerpo no debe mencionar ${word}`);
}
assert.equal(/create policy|create table|alter table/.test(lower), false, 'sin tablas ni policies nuevas');
assert.match(body, /= p_municipality_slug/, 'el slug solo se compara');
assert.equal(/execute\s+format|format\(|\bexecute\b/.test(body), false, 'sin SQL dinámico');
assert.match(body, /'vehicles', '\[\]'::jsonb/, 'slug inexistente devuelve lista vacía');
console.log('sw097-migration ok');

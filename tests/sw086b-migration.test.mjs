// SW-086b: la función que reemplaza trazo y paradas es atómica, comprueba permisos por dentro y no relaja RLS.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes('sw086b'));
assert.equal(files.length, 1, 'una sola migración SW-086b');
assert.equal(files[0], '202610140004_sw086b_replace_route_geometry.sql');
const code = readFileSync(new URL(files[0], dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

assert.match(code, /create or replace function replace_route_geometry\(p_route_id uuid, p_points jsonb, p_stops jsonb\)/);
assert.match(code, /security definer/);
assert.match(code, /set search_path = public/, 'search_path fijo en una función security definer');
assert.match(code, /auth\.uid\(\) is null or not has_municipality_role\(v_municipality, array\['municipal_admin','supervisor','dispatcher'\]\)/, 'solo personal del municipio de la ruta');
assert.match(code, /r\.status in \('started','in_progress','delayed'\)/, 'no edita una ruta en marcha');
assert.match(code, /jsonb_array_length\(p_points\) < 2/, 'mínimo 2 puntos');
assert.match(code, /delete from route_paths where route_id = p_route_id;/);
assert.match(code, /delete from route_stops where route_id = p_route_id;/);
assert.match(code, /insert into route_paths/); assert.match(code, /insert into route_stops/);
assert.match(code, /revoke all on function replace_route_geometry\(uuid, jsonb, jsonb\) from public, anon;/);
assert.match(code, /grant execute on function replace_route_geometry\(uuid, jsonb, jsonb\) to authenticated;/);
for (const word of ['alter policy', 'create policy', 'drop policy', 'disable row level security', 'truncate', 'drop table', 'drop function', 'to anon', 'to public', 'service_role']) {
  assert.ok(!code.includes(word), `no debe contener "${word}"`);
}
// Los únicos borrados son los del trazo y las paradas de la ruta indicada.
assert.equal((code.match(/delete from/g) || []).length, 2);
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
assert.ok(all.indexOf(files[0]) > all.indexOf('202610140003_sw087_driver_phone.sql'), 'va después de SW-087');
assert.ok(all.indexOf(files[0]) === all.length - 1 || all[all.indexOf(files[0]) + 1] > files[0], 'las migraciones posteriores van después en orden');
console.log('sw086b-migration ok');

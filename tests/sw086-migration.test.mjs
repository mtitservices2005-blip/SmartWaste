// SW-086 (D6, opción A): la migración de hora, días y repetición es aditiva y no relaja ninguna regla de seguridad.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes('sw086'));
assert.equal(files.length, 1, 'una sola migración SW-086');
assert.equal(files[0], '202610140002_sw086_route_start_time_and_repeat.sql');
const sql = readFileSync(new URL(files[0], dir), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

// Columnas nuevas: opcionales, sin valores inventados.
assert.match(code, /alter table routes add column if not exists start_time time;/);
assert.match(code, /alter table routes add column if not exists days_of_week smallint\[\];/);
assert.ok(!/not null/.test(code.replace(/is not null/g, '').replace(/not null default/g, '')) , 'ninguna columna nueva es obligatoria');
assert.match(code, /days_of_week is null or days_of_week <@ array\[0,1,2,3,4,5,6\]::smallint\[\]/, 'solo días 0 a 6');

// Repetición: disparador que crea la siguiente corrida solo al completarse (nunca al verificar) y sin duplicar.
assert.match(code, /create or replace function repeat_route_run_after_completion\(\)/);
assert.match(code, /security definer/);
assert.match(code, /set search_path = public/, 'search_path fijo en una función security definer');
assert.match(code, /new\.status = 'completed'/);
assert.match(code, /old\.status is distinct from 'completed'/);
assert.ok(!/new\.status = 'verified'/.test(code), 'verificar no crea otra corrida');
assert.match(code, /new\.vehicle_id is not null/, 'sin camión no se repite');
assert.match(code, /not exists \(select 1 from route_runs r where r\.route_id = new\.route_id and r\.id <> new\.id and r\.status in \('planned','assigned','started','in_progress','delayed'\)\)/, 'nunca dos corridas abiertas');
assert.match(code, /insert into route_runs \(municipality_id, route_id, vehicle_id, driver_id, status\) values \(new\.municipality_id, new\.route_id, new\.vehicle_id, new\.driver_id, 'assigned'\)/);
assert.match(code, /after update of status on route_runs/);
assert.match(code, /revoke all on function repeat_route_run_after_completion\(\) from public, anon, authenticated;/, 'nadie puede llamar la función directamente');

// Nada de relajar seguridad ni borrar.
for (const word of ['drop ', 'delete ', 'truncate', 'alter policy', 'create policy', 'disable row level security', 'grant ']) {
  assert.ok(!code.includes(word), `no debe contener "${word.trim()}"`);
}
// Orden de migraciones: es posterior a la de SW-085 y a todas las demás.
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
assert.ok(all.indexOf(files[0]) > all.indexOf('202610140001_sw085_route_run_scheduled_start_at.sql'), 'va después de SW-085');
assert.ok(all.indexOf(files[0]) > all.indexOf('202610140001_sw085_route_run_scheduled_start_at.sql'), 'va después de SW-085');
console.log('sw086-migration ok');

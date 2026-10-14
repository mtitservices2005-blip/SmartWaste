// SW-085 (CA9): la migración de la hora de inicio es aditiva y no toca reglas de seguridad.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes('sw085'));
assert.equal(files.length, 1, 'una sola migración SW-085');
assert.equal(files[0], '202610140001_sw085_route_run_scheduled_start_at.sql');
const sql = readFileSync(new URL(files[0], dir), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

assert.match(code, /alter table route_runs add column if not exists scheduled_start_at timestamptz/);
assert.ok(!/not null/.test(code), 'la columna es opcional: las corridas existentes no tienen hora');
assert.ok(!/default/.test(code), 'sin valor por defecto inventado');
for (const word of ['drop ', 'delete ', 'truncate', 'alter policy', 'create policy', 'disable row level security', 'update ']) {
  assert.ok(!code.includes(word), `no debe contener "${word.trim()}"`);
}
// Orden de migraciones: es posterior a la última existente.
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
assert.equal(all[all.length - 1], files[0], 'es la última migración');
console.log('sw085-migration ok');

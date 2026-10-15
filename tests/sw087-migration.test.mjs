// SW-087 (D1): la migración del teléfono es aditiva y no relaja ninguna regla de seguridad.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes('sw087'));
assert.equal(files.length, 1, 'una sola migración SW-087');
assert.equal(files[0], '202610140003_sw087_driver_phone.sql');
const sql = readFileSync(new URL(files[0], dir), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
assert.match(code, /alter table drivers add column if not exists phone text;/);
assert.ok(!/not null/.test(code), 'la columna es opcional');
for (const word of ['drop ', 'delete ', 'truncate', 'alter policy', 'create policy', 'disable row level security', 'grant ', 'update ']) {
  assert.ok(!code.includes(word), `no debe contener "${word.trim()}"`);
}
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
assert.ok(all.indexOf(files[0]) > all.indexOf('202610140002_sw086_route_start_time_and_repeat.sql'), 'va después de SW-086');
assert.equal(all[all.length - 1], files[0], 'es la última migración');
console.log('sw087-migration ok');

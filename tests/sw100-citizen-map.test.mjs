// SW-100: el mapa en vivo es lo primero del Portal ciudadano y funciona sin ?m= (usa el municipio del despliegue).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderCitizenLiveMap } from '../frontend/components/live-map.js';

// componente
const on = renderCitizenLiveMap({ enabled: true });
assert.match(on, /<iframe[^>]+src="\.\/en-vivo\.html\?embed=1"/);
assert.match(on, /title="[^"]+"/);
assert.match(on, /loading="lazy"/);
const off = renderCitizenLiveMap({ enabled: false });
assert.ok(!/<iframe/.test(off));
assert.match(off, /demo/i);

// el portal lo pone primero
const app = readFileSync('frontend/app.js', 'utf8');
const m = app.match(/function renderCitizen\(\) \{ return `([\s\S]*?)`; \}\n/);
assert.ok(m, 'renderCitizen existe');
const body = m[1];
assert.ok(body.indexOf('renderCitizenLiveMap(') > -1, 'el portal usa el mapa');
assert.ok(body.indexOf('renderCitizenLiveMap(') < body.indexOf('Consulta de recogida'), 'el mapa va antes de la consulta de recogida');
assert.match(app, /renderCitizenLiveMap\(\{ enabled: Boolean\(readSupabaseConfig\(\)\?\.municipality_id\) \}\)/);

// migración: una función por uuid que reutiliza la de slug; sin tablas nuevas
const file = readdirSync('supabase/migrations').find((f) => /sw100.*live_fleet_by_id/.test(f));
assert.ok(file, 'migración SW-100');
const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
assert.match(sql, /create or replace function public\.public_live_fleet\(p_municipality_id uuid\)/);
assert.match(sql, /security definer/);
assert.match(sql, /set search_path = public/);
assert.match(sql, /public\.public_live_fleet\(\s*\(select m\.slug/);
assert.match(sql, /m\.status in \('active', 'onboarding'\)/);
assert.match(sql, /revoke all on function public\.public_live_fleet\(uuid\) from public/);
assert.match(sql, /grant execute on function public\.public_live_fleet\(uuid\) to anon, authenticated/);
assert.doesNotMatch(sql, /create table|create policy|alter table/i);
assert.doesNotMatch(sql, /plate|battery|display_name|phone/i);

// en-vivo.js: sin slug usa el uuid de la config
const js = readFileSync('frontend/en-vivo.js', 'utf8');
assert.match(js, /p_municipality_id/);
assert.match(js, /embed/);
console.log('sw100-citizen-map ok');

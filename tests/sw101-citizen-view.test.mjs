// SW-101: Ciudadanía = mapa en vivo a pantalla completa + calendario; el reporte ciudadano vive en Incidencias;
// menú con Ciudadanía arriba e Incidencias en «⋯».
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderCitizenLiveDemo, renderCitizenHead } from '../frontend/components/live-map.js';
import * as live from '../frontend/components/live-map.js';

assert.ok(!('renderCitizenLiveMap' in live), 'el marco incrustado de SW-100 ya no existe');
assert.match(renderCitizenLiveDemo(), /modo demo/);
assert.match(renderCitizenHead({ municipalityName: 'Laguna <Salada>', updatedAgoText: 'hace 6 s' }), /<h2>Camiones en vivo · Laguna &lt;Salada&gt;<\/h2>[\s\S]*hace 6 s/);

const app = readFileSync('frontend/app.js', 'utf8');
const citizen = app.match(/function renderCitizen\(\) \{ return `([\s\S]*?)`; \}\n/)[1];
assert.match(citizen, /id="citizenLiveRoot"/);
assert.match(citizen, /Consulta de recogida/);
assert.match(citizen, /Avisos municipales/);
for (const gone of ['incidentForm', 'Reportar incidencia', 'folioSearch', 'checkFolio', 'Consultar estado']) assert.ok(!citizen.includes(gone), `Ciudadanía ya no trae ${gone}`);
const block = app.match(/function renderCitizenReportBlock\(\) \{\s*return `([\s\S]*?)`;\n\}/)[1];
for (const need of ['id="incidentForm"', 'id="incidentSector"', 'id="useGeo"', 'id="evidence"', 'id="folioSearch"', 'id="checkFolio"', 'Reportar incidencia']) assert.ok(block.includes(need), `Incidencias trae ${need}`);
const panel = app.match(/function renderIncidenciasPanel\(\) \{([\s\S]*?)\n\}/)[1];
assert.match(panel, /renderCitizenReportBlock\(\)/);
// el panel de Incidencias se repinta tras el login real: los manejadores no pueden colgar de nodos que se reemplazan
assert.match(app, /document\.addEventListener\('submit', async \(event\) => \{\s*if \(!event\.target\.matches\?\.\('#incidentForm'\)\)/);
assert.match(app, /document\.addEventListener\('change', \(event\) => \{\s*if \(event\.target\.id !== 'evidence'\) return;/);
assert.doesNotMatch(app, /\$\('#incidentForm'\)\.addEventListener/);
assert.doesNotMatch(app, /\$\('#evidence'\)\.addEventListener/);
assert.match(app, /function incidentSectorOptions\(\)/);
// el mapa solo corre con Ciudadanía visible
assert.match(app, /function showSection\(id\) \{[\s\S]*syncCitizenLive\(id\);/);
assert.match(app, /variant: 'section', municipalityId: cfg\.municipality_id/);
assert.match(app, /citizenLive\?\.stop\(\)/);

// migración SW-100 (municipio por uuid)
const dir = 'supabase/migrations';
const f100 = readdirSync(dir).find((f) => /sw100.*live_fleet_by_id/.test(f));
const sql100 = readFileSync(`${dir}/${f100}`, 'utf8');
assert.match(sql100, /create or replace function public\.public_live_fleet\(p_municipality_id uuid\)/);
assert.match(sql100, /grant execute on function public\.public_live_fleet\(uuid\) to anon, authenticated/);
assert.doesNotMatch(sql100, /create table|create policy|alter table/i);

// migración SW-101 (calendario público)
const f101 = readdirSync(dir).find((f) => /sw101.*public_route_schedule/.test(f));
assert.ok(f101, 'migración SW-101');
const sql = readFileSync(`${dir}/${f101}`, 'utf8');
assert.match(sql, /function public\.public_route_schedule\(p_municipality_id uuid\)/);
assert.match(sql, /function public\.public_route_schedule\(p_municipality_slug text\)/);
assert.equal((sql.match(/security definer/g) || []).length, 2);
assert.equal((sql.match(/set search_path = public/g) || []).length, 2);
assert.match(sql, /m\.status in \('active', 'onboarding'\)/);
assert.match(sql, /revoke all on function public\.public_route_schedule\(uuid\) from public/);
assert.match(sql, /revoke all on function public\.public_route_schedule\(text\) from public/);
assert.match(sql, /grant execute on function public\.public_route_schedule\(uuid\) to anon, authenticated/);
assert.match(sql, /grant execute on function public\.public_route_schedule\(text\) to anon, authenticated/);
assert.match(sql, /limit 100/);
assert.doesNotMatch(sql, /create table|create policy|alter table|execute format|route_stops|driver|vehicle|plate|battery|display_name|phone/i);
for (const col of ['name', 'days_of_week', 'start_time']) assert.ok(sql.includes(`'${col}'`), col);

// fábrica de lectores públicos
const js = readFileSync('frontend/en-vivo.js', 'utf8');
assert.match(js, /export function createLiveFetchers/);
assert.match(js, /call\('public_live_fleet'\)/);
assert.match(js, /call\('public_route_schedule'\)/);
assert.match(js, /p_municipality_id/);
console.log('sw101-citizen-view ok');

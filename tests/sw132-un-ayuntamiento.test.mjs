// SW-132: una cuenta = un ayuntamiento y direcciones públicas propias por ayuntamiento.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidSlug, liveMapUrl, slugFromLocation, fetchMunicipalityPublicInfo } from '../shared/public-links.js';

assert.equal(isValidSlug('laguna-salada'), true); assert.equal(isValidSlug('a'), false); assert.equal(isValidSlug('Laguna Salada'), false); assert.equal(isValidSlug('../x'), false); assert.equal(isValidSlug('-x'), false);
assert.equal(liveMapUrl('https://smartwaste.test/', 'laguna-salada'), 'https://smartwaste.test/en-vivo/laguna-salada');
assert.equal(liveMapUrl('', 'laguna-salada'), ''); assert.equal(liveMapUrl('https://x.test', 'mal slug'), '');

assert.equal(slugFromLocation({ pathname: '/en-vivo/laguna-salada', search: '' }), 'laguna-salada');
assert.equal(slugFromLocation({ pathname: '/en-vivo/Laguna-Salada/', search: '' }), 'laguna-salada', 'minúsculas');
assert.equal(slugFromLocation({ pathname: '/en-vivo', search: '?m=laguna-salada' }), 'laguna-salada', 'enlaces anteriores con ?m=');
assert.equal(slugFromLocation({ pathname: '/en-vivo/otro', search: '?m=laguna-salada' }), 'otro', 'manda el de la ruta');
assert.equal(slugFromLocation({ pathname: '/en-vivo', search: '' }), '');
assert.equal(slugFromLocation({ pathname: '/en-vivo/%E0%A4%A', search: '' }), '', 'ruta mal codificada no rompe');
assert.equal(slugFromLocation({ pathname: '/en-vivo/<script>', search: '' }), '');
assert.equal(slugFromLocation({}), '');

const client = (data, error = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) });
assert.deepEqual(await fetchMunicipalityPublicInfo(client({ slug: 'laguna-salada', name: 'Laguna Salada' }), 'm1'), { ok: true, slug: 'laguna-salada', name: 'Laguna Salada' });
assert.equal((await fetchMunicipalityPublicInfo(client(null), 'm1')).ok, false);
assert.equal((await fetchMunicipalityPublicInfo(client(null, { message: 'x' }), 'm1')).ok, false);
assert.equal((await fetchMunicipalityPublicInfo({}, 'm1')).ok, false);

// migración
const sql = readFileSync(new URL('../supabase/migrations/202611130001_sw132_una_cuenta_un_ayuntamiento.sql', import.meta.url), 'utf8');
assert.match(sql, /create unique index if not exists memberships_one_active_per_profile_idx on memberships \(profile_id\) where status = 'active'/);

// ruta pública y página
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.ok(vercel.rewrites.some((r) => r.source === '/en-vivo/:slug' && r.destination === '/en-vivo.html'));
assert.ok(vercel.rewrites.some((r) => r.source === '/en-vivo' && r.destination === '/en-vivo.html'), 'sigue /en-vivo');
assert.match(readFileSync(new URL('../frontend/en-vivo.html', import.meta.url), 'utf8'), /<base href="\/">/, 'rutas relativas bajo /en-vivo/<slug>');
assert.match(readFileSync(new URL('../frontend/en-vivo.js', import.meta.url), 'utf8'), /slugFromLocation\(window\.location\)/);

// el ayuntamiento de la sesión manda sobre el del despliegue
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /function sessionMunicipalityId\(\) \{ return driverAuthContext\?\.municipality_id \?\? readSupabaseConfig\(\)\?\.municipality_id \?\? null; \}/);
assert.equal(/readSupabaseConfig\(\)\?\.municipality_id/.test(app.replace(/function sessionMunicipalityId[^\n]*\n/, '').replace(/function currentMunicipalityId[^\n]*\n/, '')), false, 'ningún otro lugar lee el ayuntamiento del despliegue directamente');
assert.equal(/config\.municipality_id/.test(app), false);
assert.match(app, /id="configPublicLinks"/); assert.match(app, /hydratePublicLinks\(\);/);
console.log('sw132 ok');

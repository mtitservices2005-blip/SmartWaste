// SW-119: datos del ayuntamiento (nombre oficial, logo, contacto, firmantes) y su uso en los reportes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProfile, validateProfile, fitLogoSize, reportIdentity, displayName, isProfileConfigured, fetchMunicipalityProfile, saveMunicipalityProfile, createDemoProfileStore, MAX_SIGNERS, LOGO_MAX_BYTES } from '../shared/municipality-profile.js';
import { resizeLogoFile } from '../shared/logo-resize.js';
import { renderProfileForm } from '../frontend/components/municipality-profile-screen.js';
import { renderImpactReport, renderMetricsReport } from '../shared/report-html.js';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

// --- normalizar: lo guardado puede venir sucio ---
assert.deepEqual(normalizeProfile(null).signers, []);
assert.equal(normalizeProfile({ officialName: '  Ayuntamiento   de  X  ' }).officialName, 'Ayuntamiento de X');
assert.equal(normalizeProfile({ officialName: 'x'.repeat(500) }).officialName.length, 120);
assert.equal(normalizeProfile({ signers: [{ name: 'A', role: 'B' }, { name: '', role: '' }, { name: 'C', role: 'D' }, { name: 'E', role: 'F' }, { name: 'G', role: 'H' }] }).signers.length, MAX_SIGNERS);
assert.equal(normalizeProfile({ logo: 'javascript:alert(1)' }).logo, '', 'un logo que no es imagen se descarta');
assert.equal(normalizeProfile({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).logo, '', 'SVG no se acepta (puede llevar scripts)');
assert.equal(normalizeProfile({ logo: 'data:image/png;base64,AAAA"onerror="x' }).logo, '');
assert.equal(normalizeProfile({ logo: LOGO }).logo, LOGO);
assert.equal(normalizeProfile({ logo: 'data:image/png;base64,' + 'A'.repeat(LOGO_MAX_BYTES) }).logo, '', 'logo demasiado pesado');
assert.equal(isProfileConfigured(null), false);
assert.equal(isProfileConfigured({ officialName: 'X' }), true);

// --- validar ---
assert.equal(validateProfile({}).valid, false);
assert.match(validateProfile({}).errors[0], /nombre oficial/i);
assert.equal(validateProfile({ officialName: 'Ayuntamiento X' }).valid, true);
assert.match(validateProfile({ officialName: 'X', email: 'no-es-correo' }).errors.join(' '), /correo/i);
assert.equal(validateProfile({ officialName: 'X', email: 'a@b.do' }).valid, true);
assert.match(validateProfile({ officialName: 'X', signers: [{ name: 'Juan', role: '' }] }).errors.join(' '), /nombre y cargo/i);
assert.match(validateProfile({ officialName: 'X', logo: 'data:text/html;base64,AAAA' }).errors.join(' '), /logo/i);
assert.match(validateProfile({ officialName: 'X', signers: Array.from({ length: 4 }, (_, i) => ({ name: `N${i}`, role: `R${i}` })) }).errors.join(' '), /Máximo 3/);

// --- tamaño del logo ---
assert.deepEqual(fitLogoSize(1280, 640), { width: 320, height: 160 });
assert.deepEqual(fitLogoSize(100, 50), { width: 100, height: 50 }, 'nunca agranda');
assert.equal(fitLogoSize(0, 10), null);

// --- identidad del reporte ---
assert.equal(reportIdentity(null, 'Laguna Salada').name, 'Ayuntamiento de Laguna Salada');
assert.equal(reportIdentity({ officialName: 'Ayuntamiento del Municipio de Laguna Salada' }, 'Otro').name, 'Ayuntamiento del Municipio de Laguna Salada');
assert.equal(reportIdentity(null, '').name, 'Ayuntamiento');
assert.deepEqual(reportIdentity({ officialName: 'X', address: 'Calle 1', email: 'a@b.do' }).contact, ['Calle 1', 'a@b.do']);
assert.equal(displayName({ officialName: 'Nombre Oficial' }, 'Corto'), 'Nombre Oficial');
assert.equal(displayName(null, 'Corto'), 'Corto');

// --- datos: cliente de Supabase de mentira ---
function fakeClient(initial = null) {
  const db = { row: initial, writes: [] };
  const q = {
    select() { return q; }, eq() { return q; },
    maybeSingle: async () => ({ data: db.row, error: null }),
    update(patch) { db.writes.push(['update', patch]); db.row = { ...db.row, ...patch }; return { eq: () => ({ select: () => ({ single: async () => ({ data: db.row, error: null }) }) }) }; },
    insert(row) { db.writes.push(['insert', row]); db.row = { id: 'r1', ...row }; return { select: () => ({ single: async () => ({ data: db.row, error: null }) }) }; }
  };
  return { db, from: () => q };
}
assert.equal((await fetchMunicipalityProfile(null, 'm')).ok, false);
assert.equal((await fetchMunicipalityProfile(fakeClient(), '')).ok, false);
const empty = await fetchMunicipalityProfile(fakeClient(null), 'm1');
assert.equal(empty.ok, true); assert.equal(empty.configured, false);

const cost = { fuelPrice: 80, operatingDays: 22 };
const c1 = fakeClient({ id: 'r1', settings: { cost_parameters: cost } });
const saved = await saveMunicipalityProfile(c1, 'm1', { officialName: ' Ayuntamiento X ', logo: LOGO, signers: [{ name: 'Ana', role: 'Alcaldesa' }] });
assert.equal(saved.ok, true);
assert.equal(saved.profile.officialName, 'Ayuntamiento X');
assert.deepEqual(c1.db.row.settings.cost_parameters, cost, 'guardar los datos no borra los parámetros de costo');
assert.equal(c1.db.writes[0][0], 'update');
const c2 = fakeClient(null);
assert.equal((await saveMunicipalityProfile(c2, 'm1', { officialName: 'X' })).ok, true);
assert.equal(c2.db.writes[0][0], 'insert');
const bad = fakeClient({ id: 'r1', settings: {} });
const rejected = await saveMunicipalityProfile(bad, 'm1', { officialName: '' });
assert.equal(rejected.ok, false); assert.equal(bad.db.writes.length, 0, 'un guardado inválido no escribe nada');
const readBack = await fetchMunicipalityProfile(c1, 'm1');
assert.equal(readBack.profile.signers[0].role, 'Alcaldesa'); assert.equal(readBack.configured, true);
// una fila de otro formato (guardada a mano) no rompe la lectura
const weird = await fetchMunicipalityProfile(fakeClient({ settings: { profile: 'texto' } }), 'm1');
assert.equal(weird.ok, true); assert.equal(weird.configured, false);

// --- demo ---
const demo = createDemoProfileStore();
assert.equal(demo.get('a').configured, false);
assert.equal(demo.save('a', { officialName: 'A' }).ok, true);
assert.equal(demo.get('a').profile.officialName, 'A');
assert.equal(demo.get('b').configured, false, 'cada ayuntamiento tiene lo suyo');
assert.equal(demo.save('a', {}).ok, false);

// --- reducir logo ---
const deps = (w, h, out) => ({
  readAsDataUrl: async () => 'data:image/png;base64,AAAA',
  loadImage: async () => ({ width: w, height: h }),
  makeCanvas: (cw, ch) => { const calls = { cw, ch }; return { getContext: () => ({ drawImage: (...a) => { calls.draw = a; } }), toDataURL: () => out, calls }; }
});
assert.equal((await resizeLogoFile({ type: 'image/gif' }, deps(10, 10, LOGO))).ok, false);
assert.equal((await resizeLogoFile(null, deps(10, 10, LOGO))).ok, false);
const r1 = await resizeLogoFile({ type: 'image/jpeg' }, deps(1280, 640, LOGO));
assert.equal(r1.ok, true); assert.equal(r1.width, 320); assert.equal(r1.height, 160); assert.equal(r1.logo, LOGO);
assert.equal((await resizeLogoFile({ type: 'image/png' }, deps(10, 10, 'data:image/png;base64,' + 'A'.repeat(LOGO_MAX_BYTES)))).ok, false);
assert.equal((await resizeLogoFile({ type: 'image/png' }, { ...deps(1, 1, LOGO), loadImage: async () => { throw new Error('x'); } })).ok, false);

// --- formulario ---
const form = renderProfileForm({ draft: normalizeProfile({ officialName: 'A"><script>alert(1)</script>', signers: [{ name: 'Ana', role: 'Alcaldesa' }] }), status: 'ok', error: '<b>x</b>' });
assert.ok(!form.includes('<script>'), 'el nombre se escapa');
assert.ok(!form.includes('<b>x</b>'));
for (const w of ['data-profile-save', 'data-profile-add-signer', 'data-profile-logo-file', 'data-profile-del-signer="0"', 'Sin logo', 'role="alert"', 'role="status"']) assert.ok(form.includes(w), w);
assert.ok(renderProfileForm({ draft: normalizeProfile({ signers: [1, 2, 3].map((n) => ({ name: `N${n}`, role: `R${n}` })) }) }).includes('data-profile-add-signer disabled'), 'con 3 firmantes no se puede agregar otro');
assert.ok(renderProfileForm({ draft: normalizeProfile({ logo: LOGO }) }).includes('data-profile-logo-clear'));
assert.ok(renderProfileForm({}).includes('Sin firmantes'));

// --- reportes ---
const emptyView = { summary: { runCount: 0, totalKm: 0, totalMinutes: 0, liters: null, co2Kg: null, loggedLiters: 0 }, series: [], byVehicle: [], byRoute: [], runRows: [], missingConfig: [], excludedTests: 0 };
const profile = normalizeProfile({ officialName: 'Ayuntamiento del Municipio de Laguna Salada', logo: LOGO, address: 'Calle Duarte #12', phone: '809-555-0142', email: 'aseo@lagunasalada.gob.do', signers: [{ name: 'Lic. Juan Pérez', role: 'Alcalde' }, { name: 'Ing. María Santos', role: 'Encargada de Aseo' }] });
const html = renderMetricsReport({ view: emptyView, municipalityName: 'Laguna Salada', profile });
for (const w of ['Ayuntamiento del Municipio de Laguna Salada', `src="${LOGO}"`, 'Lic. Juan Pérez', 'Encargada de Aseo', 'Calle Duarte #12', '809-555-0142', 'aseo@lagunasalada.gob.do']) assert.ok(html.includes(w), w);
assert.ok(!html.includes('Supervisor de operaciones'), 'con firmantes propios no salen las líneas genéricas');
assert.ok(!html.includes('class="mark"'), 'con logo no sale el cuadro SW');
const plain = renderMetricsReport({ view: emptyView, municipalityName: 'Laguna Salada' });
assert.ok(plain.includes('Ayuntamiento de Laguna Salada') && plain.includes('Supervisor de operaciones') && plain.includes('class="mark"') && !plain.includes('class="contact"'));
const evil = renderMetricsReport({ view: emptyView, profile: { officialName: '<img src=x onerror=alert(1)>', signers: [{ name: '<script>', role: 'r' }] } });
assert.ok(!evil.includes('<img src=x') && !evil.includes('<script>'), 'los datos del ayuntamiento se escapan en el PDF');
const model = { measured: { km: 0, liters: null, fuelCost: null, co2Kg: null, runs: 0, activeDays: 0, loggedLiters: 0, runsWithoutFuel: 0 }, projection: null, potential: null, fuelPrice: null, perRoute: [] };
const impact = renderImpactReport({ model, municipalityName: 'X', profile });
assert.ok(impact.includes('Lic. Juan Pérez') && !impact.includes('Director financiero'));
assert.ok(renderImpactReport({ model, municipalityName: 'X' }).includes('Director financiero'));

// --- cableado en la app ---
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.ok(!/REPORT_MUNICIPALITY/.test(app), 'ya no hay nombre de ayuntamiento escrito a mano en los reportes');
assert.ok(!/municipalityName: 'Laguna Salada'/.test(app), 'Métricas tampoco');
for (const w of ['hydrateMunicipalityProfile()', 'profile: municipalityProfile', 'renderConfigProfile()', 'data-profile-logo-file']) assert.ok(app.includes(w), w);
const html0 = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.ok(html0.includes('styles/profile.css'));
console.log('sw119-datos-ayuntamiento ok');

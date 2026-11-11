// SW-127: entrada de reportes de Saibot, bandeja de basura acumulada y ajustes de la integración.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSaibotIngestHandler, validateReportPayload, sha256Hex } from '../supabase/functions/saibot-ingest-report/handler.js';
import { sortReports, summarizeReports, filterReports, projectPins, ageText, fetchWasteReports, setWasteReportStatus, wasteErrorMessage } from '../shared/waste-reports.js';
import { validateCallbackUrl, ingestEndpoint, fetchSaibotIntegration, generateSaibotKey, saveSaibotSettings, saibotErrorMessage } from '../shared/saibot-integration.js';
import { renderWasteBoard, renderSaibotIntegration } from '../frontend/components/waste-screens.js';

const NOW = new Date('2026-11-11T18:00:00Z');
const GOOD = { external_id: 'SAIBOT-1', reported_at: '2026-11-11T14:05:00-04:00', description: 'Basura frente a la escuela', location: { lat: 19.87, lng: -71.35, reference: 'Calle Duarte' }, photos: ['https://x.test/a.jpg'] };

// --- validación del cuerpo ---
const ok = validateReportPayload(GOOD, NOW);
assert.equal(ok.ok, true);
assert.deepEqual([ok.value.latitude, ok.value.longitude, ok.value.reference, ok.value.photo_urls.length], [19.87, -71.35, 'Calle Duarte', 1]);
assert.equal(validateReportPayload({ ...GOOD, location: undefined }, NOW).ok, true, 'sin ubicación es válido');
const bad = (patch) => validateReportPayload({ ...GOOD, ...patch }, NOW);
assert.equal(bad({ external_id: '' }).ok, false);
assert.equal(bad({ external_id: 'x'.repeat(81) }).ok, false);
assert.equal(bad({ description: '' }).ok, false);
assert.equal(bad({ description: 'x'.repeat(501) }).ok, false);
assert.equal(bad({ reported_at: 'ayer' }).ok, false);
assert.equal(bad({ reported_at: '2027-01-01T00:00:00Z' }).ok, false, 'futuro');
assert.equal(bad({ location: { lat: 91, lng: 0 } }).ok, false);
assert.equal(bad({ location: { lat: 10 } }).ok, false, 'lat sin lng');
assert.equal(bad({ photos: ['http://x.test/a.jpg'] }).ok, false, 'solo https');
assert.equal(bad({ photos: Array(6).fill('https://x.test/a.jpg') }).ok, false);
assert.equal(validateReportPayload([], NOW).ok, false);
assert.equal(validateReportPayload(null, NOW).ok, false);

// --- función de entrada con base falsa ---
const KEY = `swk_${'a'.repeat(64)}`;
async function fakeEnv({ integ = true, enabled = true, existing = null, count = 0, insertErr = null } = {}) {
  const hash = await sha256Hex(KEY);
  const inserts = []; const updates = [];
  const createClient = () => ({
    from(table) {
      const q = { _t: table, _f: {} };
      q.select = () => q; q.eq = (k, v) => { q._f[k] = v; return q; }; q.gte = () => q;
      q.maybeSingle = async () => {
        if (table === 'saibot_integrations') return { data: integ && q._f.key_hash === hash ? { municipality_id: 'm1', enabled } : null, error: null };
        return { data: existing, error: null };
      };
      q.insert = (row) => { inserts.push(row); return { select: () => ({ single: async () => insertErr ? { data: null, error: insertErr } : { data: { id: 'r1', status: 'new' }, error: null } }) }; };
      q.update = (row) => { updates.push(row); return { eq: async () => ({ error: null }) }; };
      q.then = (res) => res({ count, error: null }); // consulta de límite
      return q;
    }
  });
  const env = { get: (k) => ({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' }[k]) };
  return { handler: createSaibotIngestHandler({ createClient, env, now: () => NOW }), inserts, updates };
}
const req = (body, key = KEY, method = 'POST') => new Request('https://f.test/', { method, headers: { 'X-SmartWaste-Key': key, 'Content-Type': 'application/json' }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
{
  const e = await fakeEnv();
  const res = await e.handler(req(GOOD));
  assert.equal(res.status, 201);
  assert.equal(e.inserts.length, 1);
  assert.equal(e.inserts[0].municipality_id, 'm1'); assert.equal(e.inserts[0].source, 'saibot');
  assert.equal(JSON.stringify(e.inserts[0]).includes(KEY), false, 'la clave nunca se guarda');
  assert.equal(e.updates.length, 1, 'marca last_used_at');
  assert.equal((await e.handler(req(GOOD, KEY, 'GET'))).status, 405);
  assert.equal((await e.handler(req(GOOD, 'malo'))).status, 401);
  assert.equal((await e.handler(req('no json'))).status, 400);
  assert.equal((await e.handler(req({ ...GOOD, description: '' }))).status, 400);
  assert.equal((await e.handler(req('x'.repeat(20001)))).status, 413);
}
assert.equal((await (await fakeEnv({ integ: false })).handler(req(GOOD))).status, 401, 'clave desconocida');
assert.equal((await (await fakeEnv({ enabled: false })).handler(req(GOOD))).status, 401, 'integración desactivada');
{
  const e = await fakeEnv({ existing: { id: 'r9', status: 'collected' } });
  const res = await e.handler(req(GOOD)); const body = await res.json();
  assert.equal(res.status, 200); assert.equal(body.duplicate, true); assert.equal(body.status, 'collected'); assert.equal(e.inserts.length, 0, 'no duplica');
}
assert.equal((await (await fakeEnv({ count: 60 })).handler(req(GOOD))).status, 429, 'límite por minuto');
assert.equal((await (await fakeEnv({ insertErr: { code: 'XX' } })).handler(req(GOOD))).status, 500);

// --- módulos puros ---
const R = (o) => ({ id: 'a', external_id: 'S-1', description: 'd', status: 'new', reported_at: '2026-11-10T10:00:00Z', latitude: 19.8, longitude: -71.3, ...o });
const list = [R({ id: 'c', status: 'collected', attended_at: '2026-11-11T10:00:00Z' }), R({ id: 'n2', reported_at: '2026-11-11T09:00:00Z' }), R({ id: 'n1', reported_at: '2026-11-09T09:00:00Z' }), R({ id: 'r', status: 'rejected', attended_at: '2026-11-11T12:00:00Z' })];
assert.deepEqual(sortReports(list).map((r) => r.id), ['n1', 'n2', 'r', 'c'], 'abiertos viejos primero, luego cerrados recientes');
assert.deepEqual(summarizeReports(list), { total: 4, new: 2, assigned: 0, collected: 1, rejected: 1, open: 2 });
assert.equal(filterReports(list, 'open').length, 2); assert.equal(filterReports(list, 'closed').length, 2); assert.equal(filterReports(list, 'all').length, 4);
assert.deepEqual(projectPins([R({ id: 'p' })]), [{ id: 'p', x: 50, y: 50 }]);
assert.deepEqual(projectPins([R({ latitude: null })]), []);
const pins = projectPins([R({ id: 'a', latitude: 19.0, longitude: -71.5 }), R({ id: 'b', latitude: 20.0, longitude: -71.0 })]);
assert.ok(pins.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)); assert.ok(pins[1].y < pins[0].y, 'norte arriba');
assert.equal(ageText('2026-11-11T17:59:00Z', NOW), 'hace un momento'); assert.equal(ageText('2026-11-11T15:00:00Z', NOW), 'hace 3 h'); assert.equal(ageText('2026-11-08T18:00:00Z', NOW), 'hace 3 días');

// --- datos con cliente falso ---
const rpcClient = (error = null, data = { id: 'r1', status: 'collected' }) => { const calls = []; return { calls, rpc: async (n, a) => { calls.push([n, a]); return { data, error }; }, from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: list, error }) }) }) }) }; };
assert.equal((await fetchWasteReports(rpcClient())).reports[0].id, 'n1');
assert.equal((await fetchWasteReports({})).ok, false);
{
  const c = rpcClient();
  assert.equal((await setWasteReportStatus(c, { reportId: 'r1', status: 'collected', note: '  Recogido   hoy ' })).ok, true);
  assert.deepEqual(c.calls[0], ['update_waste_report_status', { p_report_id: 'r1', p_status: 'collected', p_note: 'Recogido hoy' }]);
  assert.equal((await setWasteReportStatus(c, { reportId: 'r1', status: 'rejected', note: 'ab' })).ok, false, 'no procede exige motivo');
  assert.equal((await setWasteReportStatus(c, { reportId: 'r1', status: 'new' })).ok, false);
  assert.equal((await setWasteReportStatus(c, { reportId: 'r1', status: 'collected', note: 'x'.repeat(301) })).ok, false);
  assert.match((await setWasteReportStatus(rpcClient({ message: 'waste_transition' }), { reportId: 'r1', status: 'collected' })).message, /ya estaba cerrado/);
}
assert.match(wasteErrorMessage('waste_not_allowed'), /permiso/);

assert.equal(validateCallbackUrl('').valid, true); assert.equal(validateCallbackUrl('http://x.test').valid, false); assert.equal(validateCallbackUrl('https://x.test/hook').valid, true);
assert.equal(ingestEndpoint('https://p.supabase.co/'), 'https://p.supabase.co/functions/v1/saibot-ingest-report'); assert.equal(ingestEndpoint(''), '');
{
  const c = rpcClient(null, { configured: true, enabled: false, last4: 'abcd', callback_url: null, last_used_at: null });
  const r = await fetchSaibotIntegration(c, 'm1'); assert.deepEqual([r.configured, r.enabled, r.last4], [true, false, 'abcd']);
  const g = await generateSaibotKey(rpcClient(null, { key: KEY, last4: 'aaaa' }), 'm1'); assert.equal(g.key, KEY);
  assert.equal((await saveSaibotSettings(c, 'm1', { enabled: true, callbackUrl: 'http://x' })).ok, false);
  assert.equal((await generateSaibotKey(rpcClient({ message: 'saibot_not_allowed' }), 'm1')).message, saibotErrorMessage('saibot_not_allowed'));
}

// --- pantallas: todo texto externo se escapa ---
const evil = R({ id: 'e1', external_id: '<img src=x onerror=1>', description: '<script>alert(1)</script>', reference: '"><b>', photo_urls: ['javascript:alert(1)', 'https://x.test/ok.jpg'] });
const html = renderWasteBoard({ reports: [evil], selectedId: 'e1', pins: projectPins([evil]), now: NOW });
assert.equal(html.includes('<script>'), false); assert.equal(html.includes('<img src=x'), false); assert.equal(html.includes('javascript:'), false, 'solo fotos https');
assert.match(html, /https:\/\/x\.test\/ok\.jpg/); assert.match(html, /data-waste-act="collected"/); assert.match(html, /data-waste-act="rejected"/);
assert.match(renderWasteBoard({ reports: [], now: NOW }), /No hay reportes por atender/);
assert.match(renderWasteBoard({ loaded: false }), /Cargando/);
assert.equal(renderWasteBoard({ reports: [R({ status: 'collected' })], selectedId: 'a', filter: 'closed', now: NOW }).includes('data-waste-act'), false, 'cerrado sin botones');
const integ = renderSaibotIntegration({ configured: true, last4: '"><x', endpoint: 'https://p.supabase.co/functions/v1/saibot-ingest-report', newKey: '' });
assert.equal(integ.includes('"><x'), false); assert.match(integ, /data-saibot-gen="ask"/);
assert.match(renderSaibotIntegration({ newKey: KEY, configured: true }), new RegExp(KEY)); assert.match(renderSaibotIntegration({ configured: true, confirmRegen: true }), /dejará de funcionar/);

// --- migración: sin lectura directa de claves, sin escritura de clientes ---
const sql = readFileSync(new URL('../supabase/migrations/202611110001_sw127_basura_saibot.sql', import.meta.url), 'utf8');
assert.match(sql, /alter table[^;]*saibot_integrations[^;]*enable row level security/i);
assert.match(sql, /alter table[^;]*waste_reports[^;]*enable row level security/i);
assert.match(sql, /create policy saibot_integrations_no_client_access on saibot_integrations for all using \(false\) with check \(false\)/i, 'niega todo a los clientes');
assert.equal(/create policy[^;]*on[^;]*saibot_integrations[^;]*using \((?!false)/i.test(sql), false, 'ninguna política que permita acceso');
assert.equal(/create policy[^;]*on[^;]*waste_reports[^;]*for (insert|update|delete|all)/i.test(sql), false, 'sin escritura directa');
for (const fn of ['update_waste_report_status', 'generate_saibot_key', 'get_saibot_integration', 'set_saibot_integration']) assert.match(sql, new RegExp(`function[^(]*${fn}`, 'i'));

// --- cableado en la app ---
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /OPS_VIEWS = \['mapa', 'rutas', 'flota', 'incidencias', 'basura', 'descargas', 'estadisticas'\]/);
assert.match(app, /data-ops-view="basura"/); assert.match(app, /key: 'integraciones'/);
assert.match(app, /hydrateWasteBoard\(\); setInterval\(hydrateWasteBoard, 60000\); hydrateSaibotIntegration\(\);/);
assert.match(readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8'), /styles\/waste\.css/);
console.log('sw127 ok');

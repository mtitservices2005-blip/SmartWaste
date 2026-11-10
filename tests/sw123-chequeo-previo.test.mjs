// SW-123: chequeo mecánico del camión antes de salir (módulo puro, datos, migración, controlador y cableado).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INSPECTION_ITEMS, INSPECTION_GROUPS, summarizeInspection, validateInspection, buildSubmitItems, departureDecision, needsInspection, normalizeInspectionSettings, dayKey } from '../shared/inspection.js';
import { fetchInspectionSettings, saveInspectionSettings, fetchVehicleInspectionState, submitInspection } from '../shared/inspection-data.js';
import { renderDriverInspection, renderDriverInspectionBlocked } from '../frontend/components/driver-inspection-screen.js';
import { createDriverController } from '../frontend/driver-app.js';

const allOk = () => Object.fromEntries(INSPECTION_ITEMS.map((i) => [i.key, { status: 'ok' }]));

// --- puro ---
assert.equal(INSPECTION_ITEMS.length, 13);
assert.equal(INSPECTION_GROUPS.flatMap((g) => g.items).length, 13);
assert.deepEqual(normalizeInspectionSettings(null), { required: true, allowCritical: true });
assert.deepEqual(normalizeInspectionSettings({ required: 'no', allowCritical: false }), { required: true, allowCritical: false });
assert.equal(summarizeInspection({}).done, 0);
assert.equal(summarizeInspection(allOk()).result, 'ok');
const crit = { ...allOk(), frenos: { status: 'fail', severity: 'critical', note: 'no frena' }, luces: { status: 'fail', severity: 'minor' } };
assert.deepEqual([summarizeInspection(crit).critical, summarizeInspection(crit).minor, summarizeInspection(crit).result], [1, 1, 'critical']);
assert.equal(validateInspection({}).valid, false);
assert.equal(validateInspection({ ...allOk(), frenos: { status: 'fail' } }).valid, false, 'falla sin gravedad');
assert.equal(validateInspection({ ...allOk(), frenos: { status: 'fail', severity: 'minor', note: 'x'.repeat(301) } }).valid, false);
assert.equal(validateInspection(crit).valid, true);
const items = buildSubmitItems(crit);
assert.equal(items.length, 13);
assert.equal(items.find((i) => i.key === 'frenos').severity, 'critical');
assert.equal(items.find((i) => i.key === 'bocina').severity, null);
assert.equal(items.find((i) => i.key === 'bocina').note, null);

// salir con crítica depende del interruptor
assert.equal(departureDecision({ allowCritical: true }, summarizeInspection(crit)).canDepart, true);
assert.equal(departureDecision({ allowCritical: true }, summarizeInspection(crit)).notifyAdmin, true);
assert.equal(departureDecision({ allowCritical: false }, summarizeInspection(crit)).canDepart, false);
assert.equal(departureDecision({ allowCritical: false }, summarizeInspection(allOk())).canDepart, true);

// cuándo se pide
const NOW = new Date('2026-11-10T13:00:00Z'); // 9:00 a. m. en Santo Domingo
const ins = (o) => ({ vehicle_id: 'v1', driver_id: 'd1', departed: true, created_at: '2026-11-10T12:00:00Z', ...o });
assert.equal(needsInspection({ settings: null, inspections: [], vehicleId: 'v1', driverId: 'd1', now: NOW }), true);
assert.equal(needsInspection({ settings: { required: false }, inspections: [], vehicleId: 'v1', driverId: 'd1', now: NOW }), false);
assert.equal(needsInspection({ settings: null, inspections: [ins()], vehicleId: 'v1', driverId: 'd1', now: NOW }), false, 'ya lo hizo hoy');
assert.equal(needsInspection({ settings: null, inspections: [ins({ driver_id: 'd2' })], vehicleId: 'v1', driverId: 'd1', now: NOW }), true, 'otro chofer');
assert.equal(needsInspection({ settings: null, inspections: [ins({ created_at: '2026-11-09T12:00:00Z' })], vehicleId: 'v1', driverId: 'd1', now: NOW }), true, 'es de ayer');
assert.equal(needsInspection({ settings: null, inspections: [ins({ departed: false })], vehicleId: 'v1', driverId: 'd1', now: NOW }), true, 'bloqueó: se rehace');
assert.equal(dayKey('2026-11-10T02:00:00Z'), '2026-11-09', 'zona horaria RD');

// --- datos con cliente falso ---
function fakeClient({ settings = null, rpc = { data: { inspection_id: 'i1', result: 'critical', departed: true, defects_created: 1 } }, err = null } = {}) {
  const calls = [];
  const q = (table) => {
    const chain = { _t: table, select() { return chain; }, eq() { return chain; }, gte() { return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
      maybeSingle: async () => ({ data: settings ? { id: 's1', settings } : null, error: err }),
      single: async () => ({ data: { settings: chain._w }, error: err }),
      update(v) { chain._w = v.settings; calls.push(['update', v]); return chain; }, insert(v) { chain._w = v.settings; calls.push(['insert', v]); return chain; },
      then(res) { res({ data: [], error: err }); } };
    return chain;
  };
  return { calls, from: q, rpc: async (name, args) => { calls.push(['rpc', name, args]); return err ? { error: err } : rpc; } };
}
assert.deepEqual((await fetchInspectionSettings(fakeClient({ settings: { inspection: { allowCritical: false } } }), 'm1')).settings, { required: true, allowCritical: false });
assert.equal((await fetchInspectionSettings(fakeClient({ err: { message: 'boom' } }), 'm1')).ok, false);
const keep = fakeClient({ settings: { cost_parameters: { a: 1 }, profile: { officialName: 'X' } } });
const saved = await saveInspectionSettings(keep, 'm1', { required: true, allowCritical: false });
assert.equal(saved.ok, true);
assert.deepEqual(keep.calls[0][1].settings.cost_parameters, { a: 1 }, 'no pisa otras claves');
assert.equal(keep.calls[0][1].settings.profile.officialName, 'X');
assert.equal(keep.calls[0][1].settings.inspection.allowCritical, false);
assert.equal((await fetchVehicleInspectionState(fakeClient(), { vehicleId: 'v1' })).ok, true);
assert.equal((await fetchVehicleInspectionState(fakeClient(), {})).ok, false);
const sc = fakeClient();
const sub = await submitInspection(sc, { vehicleId: 'v1', runId: 'run1', results: crit });
assert.equal(sub.ok, true); assert.equal(sub.departed, true); assert.equal(sub.defectsCreated, 1);
assert.equal(sc.calls[0][2].p_items.length, 13);
assert.equal((await submitInspection(sc, { vehicleId: 'v1', results: {} })).ok, false, 'incompleto no llega al servidor');
assert.equal(sc.calls.filter((c) => c[0] === 'rpc').length, 1);
assert.match((await submitInspection(fakeClient({ err: { message: 'inspection_not_allowed' } }), { vehicleId: 'v1', results: allOk() })).message, /permiso/);

// --- migración ---
const sql = readFileSync(new URL('../supabase/migrations/202611100001_sw123_chequeo_previo.sql', import.meta.url), 'utf8');
for (const t of ['vehicle_inspections', 'vehicle_inspection_items', 'vehicle_defects']) assert.match(sql, new RegExp(`create table if not exists ${t}`), t);
for (const t of ['vehicle_inspections', 'vehicle_inspection_items', 'vehicle_defects']) assert.match(sql, new RegExp(`alter table ${t} enable row level security`), `RLS ${t}`);
assert.doesNotMatch(sql, /on vehicle_inspections for (insert|update|delete)/i, 'chequeos solo se crean por RPC');
assert.match(sql, /security definer/i);
assert.match(sql, /revoke all on function submit_vehicle_inspection[^;]*from public/i);
assert.match(sql, /grant execute on function submit_vehicle_inspection[^;]*to authenticated/i);

// --- pantalla ---
const evil = '<img src=x onerror=alert(1)>';
const html = renderDriverInspection({ unit: evil, groups: INSPECTION_GROUPS, results: { frenos: { status: 'fail', severity: 'critical', note: evil } }, done: 1, total: 13, openDefects: [{ label: evil, severity: 'minor' }], sheet: { key: 'luces', label: evil, severity: null, note: evil } });
assert.ok(!html.includes('<img'), 'todo se escapa');
assert.match(html, /Faltan 12 puntos/);
assert.match(html, /data-driver-inspect-submit disabled/);
assert.match(html, /data-driver-inspect-save-fail disabled/, 'no se guarda la falla sin gravedad');
assert.match(renderDriverInspection({ groups: INSPECTION_GROUPS, results: allOk(), done: 13, total: 13 }), /data-driver-inspect-submit>Continuar/);
assert.ok(!renderDriverInspectionBlocked({ critical: [evil] }).includes('<img'));

// --- controlador ---
const stops = [{ sequence: 1, label: 'Calle 1', latitude: 19, longitude: -71 }];
const runs = () => [{ id: 'run1', routeId: 'r1', vehicleId: 'v1', status: 'assigned', createdAt: '2026-11-09T10:00:00Z', scheduledStartAt: '2026-11-10T12:00:00Z', startedAt: null, routeName: 'Ruta Centro', stopsCount: 1, stops, distanceText: '1 m', estimatedMinutes: null }];
function setup({ cfg = { ok: true, settings: { required: true, allowCritical: true }, inspections: [], openDefects: [] }, submit, withInspection = true } = {}) {
  const log = []; const draws = [];
  const gps = { a: false, start: async () => { gps.a = true; log.push('gps'); }, stop: async () => { gps.a = false; }, isActive: () => gps.a };
  const adapter = { startRoute: async (id) => { log.push(['startRoute', id]); return { ok: true, data: { started_at: '2026-11-10T13:01:00Z' } }; }, completeRoute: async () => ({ ok: true }), findOwnVehicleAssignment: async () => ({ ok: true, data: null }), logFuel: async () => ({ ok: true }) };
  const c = createDriverController({
    load: async () => ({ ok: true, driver: { id: 'd1', display_name: 'Carlos' }, unit: 'C-01', runs: runs() }),
    adapter, gps, municipalityId: 'm1', userId: 'u1', toast: (m) => log.push(['toast', m]), draw: (screen, h) => draws.push({ screen, html: h }), now: () => NOW,
    ...(withInspection ? { inspection: { load: async (v) => { log.push(['load', v]); return cfg; }, submit: submit ?? (async (a) => { log.push(['submit', a]); return { ok: true, departed: true, defectsCreated: 0 }; }) } } : {})
  });
  return { c, log, draws };
}
const lastDraw = (s) => s.draws[s.draws.length - 1];

// sin dependencia de chequeo: el flujo de siempre
let s = setup({ withInspection: false });
await s.c.refresh(); await s.c.action('start', 'run1');
assert.equal(lastDraw(s).screen, 'run');

// con chequeo: no inicia hasta completarlo
s = setup();
await s.c.refresh(); await s.c.action('start', 'run1');
assert.equal(lastDraw(s).screen, 'inspect');
assert.ok(!s.log.some((l) => l[0] === 'startRoute'), 'la ruta no inicia antes del chequeo');
await s.c.action('inspect-submit');
assert.ok(!s.log.some((l) => l[0] === 'submit'), 'incompleto no se envía');
for (const g of INSPECTION_GROUPS) await s.c.action('inspect-group-ok', g.id);
await s.c.action('inspect-fail-open', 'luces');
assert.match(lastDraw(s).html, /Falla en/);
await s.c.action('inspect-fail-save', 'quemada');
assert.match(lastDraw(s).html, /data-driver-inspect-sev|Luces/);
await s.c.action('inspect-sev', { severity: 'minor', note: 'quemada' });
await s.c.action('inspect-fail-save', 'quemada');
await s.c.action('inspect-submit');
assert.equal(s.log.filter((l) => l[0] === 'submit').length, 1);
assert.equal(s.log.find((l) => l[0] === 'submit')[1].results.luces.severity, 'minor');
assert.ok(s.log.some((l) => l[0] === 'startRoute'), 'tras el chequeo inicia la ruta');
assert.equal(lastDraw(s).screen, 'run');

// bloqueado por el servidor: no inicia y muestra la causa
s = setup({ submit: async () => ({ ok: true, departed: false, defectsCreated: 1 }) });
await s.c.refresh(); await s.c.action('start', 'run1');
for (const g of INSPECTION_GROUPS) await s.c.action('inspect-group-ok', g.id);
await s.c.action('inspect-sev', { severity: 'critical' }); // sin hoja abierta: no hace nada
await s.c.action('inspect-fail-open', 'frenos');
await s.c.action('inspect-sev', { severity: 'critical' });
await s.c.action('inspect-fail-save', 'sin presión');
await s.c.action('inspect-submit');
assert.equal(lastDraw(s).screen, 'inspect-blocked');
assert.match(lastDraw(s).html, /Frenos/);
assert.ok(!s.log.some((l) => l[0] === 'startRoute'));
await s.c.action('inspect-cancel');
assert.equal(lastDraw(s).screen, 'today');

// error de red al guardar: se queda en el chequeo con el mensaje y puede reintentar
s = setup({ submit: async () => ({ ok: false, message: 'Sin conexión. Conéctate para guardar el chequeo.' }) });
await s.c.refresh(); await s.c.action('start', 'run1');
for (const g of INSPECTION_GROUPS) await s.c.action('inspect-group-ok', g.id);
await s.c.action('inspect-submit');
assert.equal(lastDraw(s).screen, 'inspect');
assert.match(lastDraw(s).html, /Sin conexión/);
assert.ok(!s.log.some((l) => l[0] === 'startRoute'));

// ya hecho hoy / desactivado / lectura fallida: no estorba
s = setup({ cfg: { ok: true, settings: { required: true }, inspections: [ins()], openDefects: [] } });
await s.c.refresh(); await s.c.action('start', 'run1');
assert.equal(lastDraw(s).screen, 'run');
s = setup({ cfg: { ok: true, settings: { required: false }, inspections: [], openDefects: [] } });
await s.c.refresh(); await s.c.action('start', 'run1');
assert.equal(lastDraw(s).screen, 'run');
s = setup({ cfg: { ok: false } });
await s.c.refresh(); await s.c.action('start', 'run1');
assert.equal(lastDraw(s).screen, 'run', 'si no se puede consultar, no se bloquea la ruta');

// --- cableado ---
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /inspection: \{\s*load:/);
assert.match(app, /data-inspection-toggle="required"/);
assert.match(app, /hydrateInspectionSettings\(\); hydrateDefectsBoard\(\)/);
const drv = readFileSync(new URL('../frontend/driver-app.js', import.meta.url), 'utf8');
for (const a of ['driverInspectOk', 'driverInspectFail', 'driverInspectGroup', 'driverInspectSev', 'driverInspectSaveFail', 'driverInspectSubmit', 'driverInspectBack', 'driverInspectCancelFail']) assert.ok(drv.includes(a), a);
console.log('sw123 ok');

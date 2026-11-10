// SW-124: bandeja de fallas, cumplimiento del chequeo y avisos en Resumen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedTransitions, sortDefects, summarizeDefects, inspectionCompliance, fetchDefectsBoard, setDefectStatus, defectErrorMessage } from '../shared/vehicle-defects.js';
import { renderDefectsPanel } from '../frontend/components/defects-screens.js';

// --- recorrido de estados (igual que el servidor) ---
assert.deepEqual(allowedTransitions('reported'), ['in_review', 'fixed']);
assert.deepEqual(allowedTransitions('fixed'), ['verified', 'in_review']);
assert.deepEqual(allowedTransitions('verified'), []);
assert.deepEqual(allowedTransitions('xx'), []);

// --- orden y resumen ---
const D = (o) => ({ id: 'd', vehicle_id: 'v1', label: 'Frenos', severity: 'minor', status: 'reported', reported_at: '2026-11-10T10:00:00Z', ...o });
const list = [D({ id: 'a', severity: 'minor', reported_at: '2026-11-09T10:00:00Z' }), D({ id: 'b', severity: 'critical', reported_at: '2026-11-10T10:00:00Z' }), D({ id: 'c', severity: 'critical', reported_at: '2026-11-08T10:00:00Z' })];
assert.deepEqual(sortDefects(list).map((d) => d.id), ['c', 'b', 'a'], 'críticas primero, más viejas antes');
const sum = summarizeDefects([...list, D({ id: 'e', status: 'fixed', vehicle_id: 'v2' }), D({ id: 'f', status: 'verified' })]);
assert.deepEqual([sum.open, sum.critical, sum.minor, sum.awaiting, sum.toVerify, sum.vehicles], [4, 2, 2, 3, 1, 2], 'verificadas no cuentan');

// --- cumplimiento ---
const NOW = new Date('2026-11-10T14:00:00Z'); // 10:00 a. m. RD
const veh = [{ id: 'v1', code: 'C-01' }, { id: 'v2', code: 'C-02' }, { id: 'v3', code: 'C-03' }, { id: 'v4', code: 'C-04' }];
const runs = [
  { vehicle_id: 'v1', started_at: '2026-11-10T12:00:00Z' },            // salió con chequeo
  { vehicle_id: 'v2', started_at: '2026-11-10T12:30:00Z' },            // salió SIN chequeo
  { vehicle_id: 'v3', scheduled_start_at: '2026-11-10T18:00:00Z' },    // aún no sale, sin chequeo: pendiente
  { vehicle_id: 'v4', started_at: '2026-11-09T12:00:00Z' }             // ayer: no cuenta hoy
];
const insp = [{ vehicle_id: 'v1', created_at: '2026-11-10T11:55:00Z' }, { vehicle_id: 'v4', created_at: '2026-11-09T11:55:00Z' }];
const c = inspectionCompliance({ vehicles: veh, runs, inspections: insp, now: NOW });
assert.deepEqual([c.total, c.checked, c.pending, c.leftWithout], [3, 1, ['C-03'], ['C-02']]);
assert.deepEqual(inspectionCompliance({ now: NOW }), { total: 0, checked: 0, pending: [], leftWithout: [] });

// --- datos con cliente falso ---
function fake({ defErr = null, runsErr = null, calls = [], rpcErr = null } = {}) {
  const t = {
    vehicle_defects: { data: [D({ id: 'x', severity: 'minor' }), D({ id: 'y', severity: 'critical' })], error: defErr },
    vehicles: { data: veh, error: null }, vehicle_inspections: { data: insp, error: null },
    route_runs: { data: runs, error: runsErr }
  };
  return { calls, from: (name) => { const q = { select() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, or(f) { calls.push(['or', f]); return q; }, then(res) { res(t[name]); } }; return q; },
    rpc: async (n, a) => { calls.push(['rpc', n, a]); return rpcErr ? { error: rpcErr } : { data: { id: a.p_defect_id, status: a.p_status } }; } };
}
const board = await fetchDefectsBoard(fake(), { now: NOW });
assert.equal(board.ok, true);
assert.equal(board.defects[0].id, 'y', 'bandeja ordenada');
assert.equal(board.compliance.total, 3);
assert.equal((await fetchDefectsBoard(fake({ defErr: { message: 'boom' } }), { now: NOW })).ok, false);
const soft = await fetchDefectsBoard(fake({ runsErr: { message: 'x' } }), { now: NOW });
assert.equal(soft.ok, true); assert.equal(soft.compliance, null, 'si falla el cumplimiento, la bandeja igual se muestra');
const cl = fake();
assert.equal((await setDefectStatus(cl, { defectId: 'x', status: 'fixed', note: ' cambié pastillas ' })).ok, true);
assert.deepEqual(cl.calls.find((x) => x[0] === 'rpc')[2], { p_defect_id: 'x', p_status: 'fixed', p_note: 'cambié pastillas' });
assert.equal((await setDefectStatus(cl, { defectId: 'x', status: 'borrada' })).ok, false, 'estado inválido ni sale');
assert.equal((await setDefectStatus(cl, { defectId: 'x', status: 'fixed', note: 'x'.repeat(301) })).ok, false);
assert.equal(cl.calls.filter((x) => x[0] === 'rpc').length, 1);
assert.match((await setDefectStatus(fake({ rpcErr: { message: 'defect_transition' } }), { defectId: 'x', status: 'verified' })).message, /no es válido/);
assert.match(defectErrorMessage('defect_not_allowed'), /permiso/);

// --- pantalla ---
const evil = '<img src=x onerror=alert(1)>';
const html = renderDefectsPanel({ defects: [D({ id: 'z', note: evil, label: evil, resolution_note: evil })], vehicles: [{ id: 'v1', code: evil }], compliance: { total: 3, checked: 1, pending: [evil], leftWithout: [evil] }, error: evil, status: evil, now: NOW });
assert.ok(!html.includes('<img'), 'todo se escapa');
assert.match(html, /1 de 3<\/strong> camiones/);
assert.match(html, /Salieron sin chequeo/);
assert.equal((html.match(/data-defect-to=/g) ?? []).length, 2, 'reportada ofrece dos acciones');
assert.match(renderDefectsPanel({ defects: [D({ status: 'fixed' })], vehicles: veh, now: NOW }), /data-defect-to="verified"/);
assert.ok(!renderDefectsPanel({ defects: [D({ status: 'verified' })], vehicles: veh, now: NOW }).includes('data-defect-to'));
assert.match(renderDefectsPanel({ defects: [], loaded: true }), /Sin fallas abiertas/);
assert.match(renderDefectsPanel({ loaded: false }), /Cargando/);
assert.ok(!renderDefectsPanel({ defects: [D()], busyId: 'd', vehicles: veh, now: NOW }).match(/data-defect-to="in_review"(?![^>]*disabled)/), 'ocupada: botones desactivados');

// --- migración ---
const sql = readFileSync(new URL('../supabase/migrations/202611100002_sw124_bandeja_fallas.sql', import.meta.url), 'utf8');
assert.match(sql, /drop policy if exists defects_update_staff/, 'se quita el UPDATE directo');
assert.match(sql, /security definer/i);
assert.match(sql, /has_municipality_role\(d\.municipality_id, array\['municipal_admin','supervisor'\]\)/, 'el chofer no cierra fallas');
assert.match(sql, /defect_transition/);
assert.match(sql, /revoke all on function update_vehicle_defect_status[^;]*from public, anon/);
assert.match(sql, /grant execute on function update_vehicle_defect_status[^;]*to authenticated/);

// --- cableado ---
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /<div id="fleetDefects" hidden>/);
assert.match(app, /data-defect-to/);
assert.match(app, /Salieron sin chequeo/);
assert.match(app, /defectsBoard\.compliance/);
console.log('sw124 ok');

// --- SW-126: Configuración por categorías y paneles que no dependen de HIDE_DEMO ---
assert.match(app, /data-config-tab="\$\{t\.key\}"/);
for (const k of ['ayuntamiento', 'operacion', 'costos', 'navegador']) assert.ok(app.includes(`key: '${k}'`), `pestaña ${k}`);
assert.match(app, /id="configInspectionWrap" hidden/, 'el chequeo aparece solo con backend real');
assert.ok(!/HIDE_DEMO \? `<div id="fleetDefects"/.test(app), 'la bandeja no depende de HIDE_DEMO');
assert.match(app, /defectsBoard\.loaded && !defectsBoard\.error \? summarizeDefects/);
console.log('sw126 ok');

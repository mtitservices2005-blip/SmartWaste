// SW-130: peso y destino por descarga, opcional por ayuntamiento.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWasteSettings, isEnabled, estimateWeight, sourcesForMode, validateDisposalInput, summarizeDisposals, formatKg, disposalErrorMessage, fetchWasteSettings, saveWasteSettings, fetchDisposalBoard, saveDisposalSite, recordDisposal, voidDisposal, MODES, DISPOSAL_UI as ui } from '../shared/waste-disposal.js';
import { renderDisposalSettings, renderDisposalBoard } from '../frontend/components/disposal-screens.js';

// --- ajustes ---
assert.deepEqual(normalizeWasteSettings(null), { mode: 'off', defaultCapacityKg: null }, 'apagado por defecto');
assert.deepEqual(normalizeWasteSettings({ mode: 'scale', defaultCapacityKg: '8000' }), { mode: 'scale', defaultCapacityKg: 8000 });
assert.equal(normalizeWasteSettings({ mode: 'raro' }).mode, 'off');
assert.equal(normalizeWasteSettings({ defaultCapacityKg: -5 }).defaultCapacityKg, null);
assert.equal(normalizeWasteSettings({ defaultCapacityKg: 999999 }).defaultCapacityKg, null);
assert.equal(isEnabled({ mode: 'off' }), false); assert.equal(isEnabled({ mode: 'trips' }), true);
assert.deepEqual(MODES, ['off', 'trips', 'estimated', 'scale']);

// --- estimación y fuentes por modo ---
assert.equal(estimateWeight(8000, 50), 4000); assert.equal(estimateWeight(8000, 25), 2000); assert.equal(estimateWeight(8000, 100), 8000);
assert.equal(estimateWeight(0, 50), null); assert.equal(estimateWeight(8000, 60), null);
assert.deepEqual(sourcesForMode('off'), []); assert.deepEqual(sourcesForMode('trips'), ['none']); assert.deepEqual(sourcesForMode('scale'), ['scale', 'none']);
assert.deepEqual(sourcesForMode('estimated', { defaultCapacityKg: 8000 }), ['estimated', 'scale', 'none']);
assert.deepEqual(sourcesForMode('estimated', {}), ['scale', 'none'], 'sin capacidad no se ofrece estimar');

// --- validación ---
const ctxScale = { mode: 'scale', settings: {} };
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'scale', weightKg: '5230' }, ctxScale).valid, true);
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'scale', weightKg: '' }, ctxScale).valid, false);
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'scale', weightKg: '-1' }, ctxScale).valid, false);
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'scale', weightKg: '100001' }, ctxScale).valid, false);
assert.equal(validateDisposalInput({ source: 'none' }, ctxScale).valid, false, 'falta el camión');
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'estimated', fillLevel: 50 }, ctxScale).valid, false, 'estimar no está activo en modo báscula');
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'estimated', fillLevel: 60 }, { mode: 'estimated', settings: { defaultCapacityKg: 8000 } }).valid, false);
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'none' }, { mode: 'trips', settings: {} }).valid, true);
assert.equal(validateDisposalInput({ vehicleId: 'v', source: 'none', note: 'x'.repeat(301) }, { mode: 'trips', settings: {} }).valid, false);

// --- resumen: anuladas no cuentan, pesado/estimado separados, sin peso aparte ---
const NOW = new Date('2026-11-12T18:00:00Z');
const D = (o) => ({ id: 'd', site_id: 's1', weight_kg: 1000, weight_source: 'scale', unloaded_at: '2026-11-12T10:00:00Z', voided_at: null, ...o });
const list = [D({ id: 'a' }), D({ id: 'b', weight_source: 'estimated', weight_kg: 4000 }), D({ id: 'c', weight_source: 'none', weight_kg: null, site_id: null }), D({ id: 'x', voided_at: '2026-11-12T11:00:00Z' }), D({ id: 'old', unloaded_at: '2026-09-01T10:00:00Z' }), D({ id: 'e', site_id: 's2', weight_kg: 2500 })];
const sum = summarizeDisposals(list, { sinceMs: 7 * 86400000, now: NOW, sites: [{ id: 's1', name: 'Relleno' }, { id: 's2', name: 'Transferencia' }] });
assert.deepEqual([sum.count, sum.totalKg, sum.scaleKg, sum.estimatedKg, sum.withoutWeight], [4, 7500, 3500, 4000, 1]);
assert.deepEqual(sum.byDestination.map((d) => [d.name, d.kg, d.count]), [['Relleno', 5000, 2], ['Transferencia', 2500, 1], ['Sin destino', 0, 1]]);
assert.equal(summarizeDisposals(list, { now: NOW }).count, 5, 'sin período cuenta todas las vigentes');
assert.equal(formatKg(850), '850 kg'); assert.match(formatKg(5230), /5,?23 t|5\.23 t|5,23 t/); assert.equal(formatKg(null), '—');
assert.match(disposalErrorMessage('disposal_no_capacity'), /capacidad típica/); assert.match(disposalErrorMessage('disposal_already_voided'), /anulada/);

// --- datos con cliente falso ---
function fake({ error = null, settings = null, calls = [] } = {}) {
  const rows = { municipality_settings: { data: settings ? { id: 'ms1', settings } : null, error }, disposal_sites: { data: [{ id: 's1', name: 'Relleno', kind: 'landfill', active: true }], error }, waste_disposals: { data: list, error } };
  const q = (t) => { const o = { select: () => o, eq: () => o, is: () => o, gte: () => o, order: () => o, limit: async () => rows[t], maybeSingle: async () => rows[t], single: async () => ({ data: { settings: { waste: calls.at(-1)?.[1]?.settings?.waste } }, error }),
    update: (v) => { calls.push(['update', v]); return o; }, insert: (v) => { calls.push(['insert', v]); return o; } }; return o; };
  return { calls, from: (t) => q(t), rpc: async (n, a) => { calls.push([n, a]); return { data: { id: 'r1', weight_kg: 4000, weight_source: 'estimated' }, error }; } };
}
assert.equal((await fetchWasteSettings(fake({ settings: { waste: { mode: 'scale' }, inspection: {} } }), 'm1')).settings.mode, 'scale');
assert.equal((await fetchWasteSettings(fake(), 'm1')).settings.mode, 'off');
{
  const c = fake({ settings: { inspection: { required: true }, costs: { a: 1 } } });
  const r = await saveWasteSettings(c, 'm1', { mode: 'estimated', defaultCapacityKg: 8000 });
  assert.equal(r.ok, true);
  const upd = c.calls.find((x) => x[0] === 'update')[1].settings;
  assert.deepEqual(upd.inspection, { required: true }, 'no pisa otros ajustes'); assert.deepEqual(upd.costs, { a: 1 }); assert.equal(upd.waste.mode, 'estimated');
}
assert.equal((await fetchDisposalBoard(fake())).sites.length, 1);
assert.equal((await fetchDisposalBoard({})).ok, false);
{
  const c = fake();
  assert.equal((await recordDisposal(c, 'm1', { vehicleId: 'v1', siteId: 's1', source: 'estimated', fillLevel: '50', ticket: ' ' }, { mode: 'estimated', settings: { defaultCapacityKg: 8000 } })).ok, true);
  assert.deepEqual(c.calls[0], ['record_waste_disposal', { p_municipality_id: 'm1', p_vehicle_id: 'v1', p_route_run_id: null, p_site_id: 's1', p_source: 'estimated', p_weight_kg: null, p_ticket: null, p_fill_level: 50, p_note: null, p_unloaded_at: null }]);
  assert.equal((await recordDisposal(c, 'm1', { vehicleId: 'v1', source: 'scale', weightKg: '' }, ctxScale)).ok, false);
  assert.equal(c.calls.length, 1, 'no llama al servidor con datos inválidos');
  assert.match((await recordDisposal(fake({ error: { message: 'disposal_no_capacity' } }), 'm1', { vehicleId: 'v1', source: 'estimated', fillLevel: 50 }, { mode: 'estimated', settings: { defaultCapacityKg: 8000 } })).message, /capacidad típica/);
  assert.equal((await saveDisposalSite(c, 'm1', { name: '  ', kind: 'landfill' })).ok, false);
  assert.equal((await saveDisposalSite(c, 'm1', { name: 'Relleno', kind: 'xx' })).ok, false);
  assert.equal((await saveDisposalSite(c, 'm1', { name: ' Relleno  de  Santiago ', kind: 'landfill' })).ok, true);
  assert.equal(c.calls.at(-1)[1].p_name, 'Relleno de Santiago');
  assert.equal((await voidDisposal(c, { disposalId: 'd1', reason: 'ab' })).ok, false);
  assert.equal((await voidDisposal(c, { disposalId: 'd1', reason: 'Peso mal anotado' })).ok, true);
}

// --- pantallas ---
const sitesEvil = [{ id: 's1', name: '<script>x</script>', kind: 'landfill', active: true }];
const html = renderDisposalSettings({ ui, settings: { mode: 'estimated', defaultCapacityKg: 8000 }, sites: sitesEvil });
assert.equal(html.includes('<script>'), false); assert.match(html, /wasteCapacity/); assert.match(html, /data-site-add/);
assert.equal(renderDisposalSettings({ ui, settings: { mode: 'off', defaultCapacityKg: null } }).includes('data-site-add'), false, 'apagado no pide sitios');
assert.equal(renderDisposalSettings({ ui, settings: { mode: 'scale' } }).includes('wasteCapacity'), false);
assert.match(renderDisposalBoard({ ui, enabled: false }), /apagado/i);
const board = renderDisposalBoard({ ui, mode: 'scale', settings: {}, sites: sitesEvil, vehicles: [{ id: 'v1', label: '<b>C-01</b>' }], disposals: [D({ id: 'z', note: '<img src=x onerror=1>' })], week: sum, month: sum });
assert.equal(board.includes('<img src=x'), false); assert.equal(board.includes('<b>C-01'), false); assert.match(board, /data-disp-save/); assert.match(board, /data-disp-void="z"/);
assert.match(renderDisposalBoard({ ui, mode: 'trips', settings: {}, vehicles: [] }), /type="hidden" id="dispSource" value="none"/);
assert.match(renderDisposalBoard({ ui, mode: 'scale', settings: {}, vehicles: [], disposals: [D({ id: 'z' })], voidingId: 'z' }), /dispVoidReason/);

// --- migración ---
const sql = readFileSync(new URL('../supabase/migrations/202611120001_sw130_peso_destino.sql', import.meta.url), 'utf8');
for (const t of ['disposal_sites', 'waste_disposals']) {
  assert.match(sql, new RegExp(`alter table ${t} enable row level security`, 'i'));
  assert.match(sql, new RegExp(`create policy \\w+ on ${t} for select`, 'i'), `${t} tiene política (rls-coverage)`);
  assert.equal(new RegExp(`create policy[^;]*on ${t} for (insert|update|delete|all)`, 'i').test(sql), false, 'sin escritura directa');
}
for (const fn of ['upsert_disposal_site', 'record_waste_disposal', 'void_waste_disposal']) { assert.match(sql, new RegExp(`function ${fn}`, 'i')); assert.match(sql, new RegExp(`revoke all on function ${fn}`, 'i')); assert.match(sql, new RegExp(`grant execute on function ${fn}`, 'i')); }
assert.match(sql, /disposal_no_capacity/); assert.match(sql, /voided_at/);

// --- cableado ---
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(app, /'basura', 'descargas', 'estadisticas'/); assert.match(app, /data-ops-view="descargas"/); assert.match(app, /hydrateDisposals\(\); setInterval\(hydrateDisposals, 60000\)/);
assert.match(app, /id="configDisposalWrap"/); assert.match(app, /handleDisposalClick\(event\)/);
console.log('sw130 ok');

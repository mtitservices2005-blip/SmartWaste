// SW-083 Task 9 (CA-083-4): litros de combustible al finalizar el recorrido. Opcional, en español claro.
import assert from 'node:assert/strict';
import { parseFuelLiters, buildFuelEntry } from '../shared/fuel-entry.js';

assert.deepEqual(parseFuelLiters('45,5'), { ok: true, liters: 45.5 }, 'coma decimal');
assert.deepEqual(parseFuelLiters('45.5'), { ok: true, liters: 45.5 }, 'punto decimal');
assert.deepEqual(parseFuelLiters('  30 '), { ok: true, liters: 30 });
assert.deepEqual(parseFuelLiters('500'), { ok: true, liters: 500 });
assert.deepEqual(parseFuelLiters(''), { ok: true, liters: null }, 'vacío = omitido (es opcional)');
assert.deepEqual(parseFuelLiters('   '), { ok: true, liters: null });
assert.deepEqual(parseFuelLiters(undefined), { ok: true, liters: null });
assert.deepEqual(parseFuelLiters(null), { ok: true, liters: null });
for (const bad of ['0', '-5', '501', '1000', 'abc', '12 litros', '4,5,6', 'NaN', 'Infinity']) {
  const r = parseFuelLiters(bad);
  assert.equal(r.ok, false, `${bad} debe rechazarse`);
  assert.match(r.message, /litros/i);
}
assert.equal(parseFuelLiters('0').message, 'Escribe los litros cargados (mayor que 0).');
assert.match(parseFuelLiters('501').message, /500/);

// El registro queda asociado al camión y a la corrida de la asignación; sin litros no hay registro.
assert.equal(buildFuelEntry({ liters: null, assignment: { vehicle_id: 'v1', route_run_id: 'r1' }, municipalityId: 'm1' }), null);
assert.equal(buildFuelEntry({ liters: 20, assignment: null, municipalityId: 'm1' }), null);
assert.deepEqual(
  buildFuelEntry({ liters: 20, assignment: { vehicle_id: 'v1', route_run_id: 'r1' }, municipalityId: 'm1' }),
  { vehicle_id: 'v1', route_run_id: 'r1', liters: 20, municipality_id: 'm1' }
);
assert.equal(buildFuelEntry({ liters: 20, assignment: { vehicle_id: 'v1' }, municipalityId: 'm1' }).route_run_id, null);
console.log('fuel-entry ok');

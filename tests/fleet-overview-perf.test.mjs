// SW-081 (CA-081-3): fleet_overview() devuelve 5 filas para 5 camiones en menos de 100 ms con
// 500.000 posiciones históricas cargadas. Prueba de INTEGRACIÓN y de RENDIMIENTO (Postgres con
// migraciones). El tiempo se mide en el servidor con EXPLAIN (ANALYZE), sin latencia de red.
// Todo dentro de una transacción con ROLLBACK. Umbral ajustable con FLEET_OVERVIEW_MAX_MS.
import assert from 'node:assert/strict';
import { connect, finish, asUser, seedMunicipality, point, ingest } from './integration/fleet-db.mjs';

const MAX_MS = Number(process.env.FLEET_OVERVIEW_MAX_MS || 100);
const TOTAL_POSITIONS = 500_000;
const db = await connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
try {
  const A = await seedMunicipality(db, 'perf', { extraVehicles: 3 });
  const vehicles = [A.truck1.vehicleId, A.truck2.vehicleId, ...A.spareVehicleIds];
  assert.equal(vehicles.length, 5);

  await db.query(`
    insert into vehicle_positions (municipality_id, vehicle_id, route_run_id, latitude, longitude, speed, battery_pct, captured_at, source, device_id)
    select $1, v.id, null, 19.8 + random() / 100, -71.0 + random() / 100, random() * 12, 50,
           now() - (g * interval '1 second') - interval '1 hour', 'driver_app', 'perf-' || v.id
    from unnest($2::uuid[]) as v(id), generate_series(1, $3 / 5) as g`, [A.municipalityId, vehicles, TOTAL_POSITIONS]);
  const loaded = Number((await q('select count(*)::int as n from vehicle_positions where municipality_id = $1', [A.municipalityId]))[0].n);
  assert.ok(loaded >= TOTAL_POSITIONS, `se cargaron ${loaded} posiciones`);

  // Estado vivo reciente para los 5 camiones, por la vía real.
  for (const vehicleId of vehicles) {
    await db.query(`insert into vehicle_live_state (municipality_id, vehicle_id, latitude, longitude, speed, captured_at) values ($1, $2, 19.8, -71, 6, now() - interval '3 seconds')`, [A.municipalityId, vehicleId]);
  }
  await db.query('analyze vehicle_positions');

  const rows = await asUser(db, A.adminId, () => q('select * from fleet_overview()'));
  assert.equal(rows.length, 5, 'una fila por camión');

  const timings = [];
  for (let i = 0; i < 5; i += 1) {
    const plan = await asUser(db, A.adminId, () => q('explain (analyze, format json) select * from fleet_overview()'));
    const root = plan[0]['QUERY PLAN'][0];
    timings.push(root['Execution Time'] + root['Planning Time']);
  }
  const best = Math.min(...timings);
  const median = [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)];
  console.log(`fleet_overview: mejor ${best.toFixed(1)} ms, mediana ${median.toFixed(1)} ms (límite ${MAX_MS} ms) con ${loaded} posiciones`);
  assert.ok(median < MAX_MS, `fleet_overview() tardó ${median.toFixed(1)} ms (mediana) con ${loaded} posiciones; límite ${MAX_MS} ms`);

  console.log('fleet-overview-perf ok');
} finally {
  await finish(db);
}

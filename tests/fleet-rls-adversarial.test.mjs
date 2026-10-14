// SW-081 (CA-081-4): dos municipios de prueba no ven filas del otro en ninguna tabla ni RPC nueva,
// y ningún rol puede escribir en el municipio ajeno. Prueba de INTEGRACIÓN (Postgres con migraciones).
import assert from 'node:assert/strict';
import { connect, finish, asUser, expectDbError, seedMunicipality, point, ingest } from './integration/fleet-db.mjs';

const db = await connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const isoAgo = (s) => new Date(Date.now() - s * 1000).toISOString();
try {
  const A = await seedMunicipality(db, 'a');
  const B = await seedMunicipality(db, 'b');

  // Datos en ambos municipios en todas las tablas nuevas.
  for (const M of [A, B]) {
    await asUser(db, M.truck1.userId, () => ingest(db, [point({ vehicle_id: M.truck1.vehicleId, route_run_id: M.runId, captured_at: isoAgo(2) })]));
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [M.truck1.vehicleId]);
    await asUser(db, M.dispatcherId, () => db.query('select refresh_fleet_alerts()'));
    await db.query(`insert into fuel_logs (municipality_id, vehicle_id, liters) values ($1, $2, 20)`, [M.municipalityId, M.truck1.vehicleId]);
  }

  const tables = ['vehicle_live_state', 'fleet_alerts', 'fuel_logs', 'vehicle_positions'];
  for (const [viewer, own, other] of [[A.adminId, A, B], [B.adminId, B, A], [A.dispatcherId, A, B], [B.dispatcherId, B, A]]) {
    for (const table of tables) {
      const rows = await asUser(db, viewer, () => q(`select municipality_id from ${table}`));
      assert.ok(rows.length > 0, `${table}: el municipio propio sí ve sus filas`);
      assert.ok(rows.every((r) => r.municipality_id === own.municipalityId), `${table}: solo filas del municipio propio`);
      assert.equal(rows.some((r) => r.municipality_id === other.municipalityId), false);
    }
    const overview = await asUser(db, viewer, () => q('select vehicle_id from fleet_overview()'));
    assert.deepEqual(overview.map((r) => r.vehicle_id).sort(), [own.truck1.vehicleId, own.truck2.vehicleId].sort());
  }

  // Escrituras cruzadas rechazadas en cada tabla nueva (staff de B contra A).
  const denied = /row-level security|violates|permission denied|not_found|not found/i;
  await expectDbError(db, () => asUser(db, B.adminId, () => db.query(`insert into fuel_logs (municipality_id, vehicle_id, liters, logged_by) values ($1, $2, 10, $3)`, [A.municipalityId, A.truck1.vehicleId, B.adminId])), denied);
  await expectDbError(db, () => asUser(db, B.adminId, () => db.query(`insert into vehicle_live_state (municipality_id, vehicle_id, latitude, longitude, captured_at) values ($1, $2, 1, 1, now())`, [A.municipalityId, A.truck2.vehicleId])), denied);
  const moved = await asUser(db, B.adminId, () => db.query(`update vehicle_live_state set latitude = 0 where vehicle_id = $1`, [A.truck1.vehicleId]));
  assert.equal(moved.rowCount, 0, 'B no actualiza el estado vivo de A');
  const closed = await asUser(db, B.adminId, () => db.query(`update fleet_alerts set status = 'atendida' where municipality_id = $1`, [A.municipalityId]));
  assert.equal(closed.rowCount, 0, 'B no cierra alertas de A');

  // Un chofer no puede forzar el estado vivo directamente (solo vía ingest_positions con su camión).
  await expectDbError(db, () => asUser(db, A.truck1.userId, () => db.query(`update vehicle_live_state set latitude = 0 where vehicle_id = $1 returning 1`, [A.truck2.vehicleId]).then((r) => { if (r.rowCount === 0) throw new Error('rls_sin_filas'); })), /rls_sin_filas/);
  await expectDbError(db, () => asUser(db, A.truck1.userId, () => db.query(`insert into vehicle_live_state (municipality_id, vehicle_id, latitude, longitude, captured_at) values ($1, $2, 1, 1, now())
     on conflict (vehicle_id) do update set latitude = 1`, [A.municipalityId, A.truck2.vehicleId])), denied);

  // Anónimo: nada.
  for (const table of ['vehicle_live_state', 'fleet_alerts', 'fuel_logs']) {
    const rows = await asUser(db, null, () => q(`select * from ${table}`).catch(() => []));
    assert.equal(rows.length, 0, `${table}: anónimo no lee`);
  }

  console.log('fleet-rls-adversarial ok');
} finally {
  await finish(db);
}

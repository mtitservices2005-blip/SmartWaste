// SW-081 (Task 2): alertas de flotilla idempotentes, combustible real y retención configurable.
// Prueba de INTEGRACIÓN (Postgres con migraciones; corre en CI / SW_TEST_DB_URL). Transacción con ROLLBACK.
import assert from 'node:assert/strict';
import { connect, finish, asUser, expectDbError, seedMunicipality, point, ingest } from './integration/fleet-db.mjs';

const db = await connect();
const isoAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const q = async (sql, params) => (await db.query(sql, params)).rows;
try {
  const A = await seedMunicipality(db, 'a');
  const B = await seedMunicipality(db, 'b');
  const v1 = A.truck1.vehicleId;
  const openAlerts = (vehicleId, type) => q(`select * from fleet_alerts where vehicle_id = $1 and type = $2 and status = 'abierta'`, [vehicleId, type]);
  const refresh = (userId) => asUser(db, userId, async () => Number((await q('select refresh_fleet_alerts() as n'))[0].n));

  // Alerta "sin_señal": única aunque se refresque varias veces (CA-084-2) y se cierra al volver a reportar.
  {
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, captured_at: isoAgo(2) })]));
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'sin_senal')).length, 0, 'con señal reciente no hay alerta');

    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [v1]);
    assert.equal(await refresh(A.dispatcherId), 1, 'primera pasada abre 1 alerta');
    assert.equal(await refresh(A.dispatcherId), 0, 'segunda pasada no abre otra');
    assert.equal(await refresh(A.adminId), 0, 'otro usuario del mismo municipio tampoco duplica');
    const [alert] = await openAlerts(v1, 'sin_senal');
    assert.equal(alert.municipality_id, A.municipalityId);
    assert.equal(alert.route_run_id, A.runId);

    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, captured_at: isoAgo(1) })]));
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'sin_senal')).length, 0, 'al volver a reportar la alerta se cierra');
    const closed = await q(`select status, closed_at from fleet_alerts where id = $1`, [alert.id]);
    assert.equal(closed[0].status, 'atendida');
    assert.ok(closed[0].closed_at);
  }

  // "Atendida" a mano mientras el problema sigue: no se vuelve a abrir una alerta repetida.
  {
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [v1]);
    assert.equal(await refresh(A.dispatcherId), 1, 'nuevo episodio de sin señal abre una alerta nueva');
    const [alert] = await openAlerts(v1, 'sin_senal');
    await asUser(db, A.dispatcherId, () => db.query('select acknowledge_fleet_alert($1)', [alert.id]));
    assert.equal(await refresh(A.dispatcherId), 0, 'atendida a mano y el camión sigue sin señal: no se repite');
    assert.equal((await openAlerts(v1, 'sin_senal')).length, 0);
    assert.equal((await q(`select count(*)::int as n from fleet_alerts where vehicle_id = $1 and type = 'sin_senal'`, [v1]))[0].n, 2);
  }

  // Batería baja (< 20 %) y detenido largo.
  {
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, battery_pct: 12, speed: 0.1, captured_at: isoAgo(1) })]));
    await db.query(`update vehicle_live_state set stopped_since = now() - interval '9 minutes' where vehicle_id = $1`, [v1]);
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'bateria_baja')).length, 1);
    assert.equal((await openAlerts(v1, 'detenido_largo')).length, 1);
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, battery_pct: 55, speed: 7, captured_at: isoAgo(0.5) })]));
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'bateria_baja')).length, 0);
    assert.equal((await openAlerts(v1, 'detenido_largo')).length, 0);
  }

  // Ruta retrasada: corrida en estado 'delayed'.
  {
    await db.query(`update route_runs set status = 'delayed' where id = $1`, [A.runId]);
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'ruta_retrasada')).length, 1);
    await db.query(`update route_runs set status = 'in_progress' where id = $1`, [A.runId]);
    await refresh(A.dispatcherId);
    assert.equal((await openAlerts(v1, 'ruta_retrasada')).length, 0);
  }

  // Aislamiento: B no ve ni atiende alertas de A; el chofer no lee alertas.
  {
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [v1]);
    await refresh(A.dispatcherId);
    const [alert] = await openAlerts(v1, 'sin_senal');
    assert.ok(alert, 'hay una alerta abierta de A');
    assert.equal((await asUser(db, B.adminId, () => q('select * from fleet_alerts'))).length, 0);
    await expectDbError(db, () => asUser(db, B.adminId, () => db.query('select acknowledge_fleet_alert($1)', [alert.id])), /alert_not_found/);
    assert.equal((await asUser(db, A.truck1.userId, () => q('select * from fleet_alerts'))).length, 0, 'el chofer no lee alertas');
    await expectDbError(db, () => asUser(db, A.truck1.userId, () => db.query('select acknowledge_fleet_alert($1)', [alert.id])), /alert_not_found/);
    assert.equal((await openAlerts(v1, 'sin_senal')).length, 1, 'nadie ajeno la cerró');
    await expectDbError(db, () => asUser(db, B.adminId, () => db.query(
      `insert into fleet_alerts (municipality_id, vehicle_id, type) values ($1, $2, 'sin_senal')`, [A.municipalityId, v1])), /row-level security|violates|not found/i);
  }

  // Job de plataforma (pg_cron / service_role / dueño de la base): sin usuario no hay auth.uid(), pero
  // NO debe cerrar las alertas vigentes de ningún municipio (hallazgo P1 de la revisión de Codex en el PR #95).
  {
    await asUser(db, B.truck1.userId, () => ingest(db, [point({ vehicle_id: B.truck1.vehicleId, route_run_id: B.runId, captured_at: isoAgo(2) })]));
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [B.truck1.vehicleId]);
    await refresh(B.dispatcherId);
    const openFor = async (vehicleId) => (await openAlerts(vehicleId, 'sin_senal')).length;
    assert.equal(await openFor(v1), 1, 'precondición: A tiene su alerta de sin señal abierta');
    assert.equal(await openFor(B.truck1.vehicleId), 1, 'precondición: B tiene su alerta de sin señal abierta');

    assert.equal(Number((await q('select refresh_fleet_alerts() as n'))[0].n), 0, 'el job (dueño de la base) no abre ni duplica');
    assert.equal(await openFor(v1), 1, 'el job no cierra la alerta vigente de A');
    assert.equal(await openFor(B.truck1.vehicleId), 1, 'el job no cierra la alerta vigente de B');

    await db.query('set local role service_role');
    try {
      assert.equal(Number((await q('select refresh_fleet_alerts() as n'))[0].n), 0);
    } finally { await db.query('reset role'); }
    assert.equal(await openFor(v1), 1, 'service_role tampoco cierra alertas vigentes');
    assert.equal(await openFor(B.truck1.vehicleId), 1);

    // Si la condición de A termina, el job sí cierra la de A y deja la de B.
    await db.query(`update vehicle_live_state set captured_at = now() where vehicle_id = $1`, [v1]);
    await q('select refresh_fleet_alerts()');
    assert.equal(await openFor(v1), 0, 'el job cierra la alerta de A cuando A vuelve a reportar');
    assert.equal(await openFor(B.truck1.vehicleId), 1, 'y deja intacta la de B');
    // Deja el estado como lo esperan los bloques siguientes.
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [v1]);
    await refresh(A.dispatcherId);
  }

  // Combustible real: litros > 0, ligado al camión/corrida correctos, chofer solo de su camión.
  {
    const log = (userId, row) => asUser(db, userId, () => db.query(
      `insert into fuel_logs (municipality_id, vehicle_id, route_run_id, liters, odometer_km, logged_by) values ($1, $2, $3, $4, $5, $6) returning *`,
      [row.municipalityId ?? A.municipalityId, row.vehicleId, row.runId ?? null, row.liters, row.odometer ?? null, userId]));
    const ok = await log(A.truck1.userId, { vehicleId: v1, runId: A.runId, liters: 42.5, odometer: 18234.2 });
    assert.equal(ok.rows[0].vehicle_id, v1);
    assert.equal(ok.rows[0].route_run_id, A.runId);
    assert.equal(Number(ok.rows[0].liters), 42.5);
    assert.ok(ok.rows[0].logged_at);
    await expectDbError(db, () => log(A.truck1.userId, { vehicleId: v1, liters: 0 }), /fuel_logs_liters|check/i);
    await expectDbError(db, () => log(A.truck1.userId, { vehicleId: A.truck2.vehicleId, liters: 30 }), /row-level security|violates/i);
    await expectDbError(db, () => log(A.truck2.userId, { vehicleId: A.truck2.vehicleId, runId: A.runId, liters: 30 }), /Vehicle does not match|row-level security|violates/i);
    await expectDbError(db, () => log(B.truck1.userId, { municipalityId: A.municipalityId, vehicleId: v1, liters: 30 }), /row-level security|violates|not found/i);
    const staff = await log(A.dispatcherId, { vehicleId: A.truck2.vehicleId, liters: 25 });
    assert.equal(staff.rowCount, 1, 'despacho puede registrar combustible de cualquier camión del municipio');
    assert.equal((await asUser(db, B.adminId, () => q('select * from fuel_logs'))).length, 0, 'B no ve combustible de A');
    assert.equal((await asUser(db, A.adminId, () => q('select * from fuel_logs'))).length, 2);
    assert.equal((await asUser(db, A.truck1.userId, () => q('select * from fuel_logs'))).length, 1, 'el chofer ve solo lo suyo');
    const edited = await asUser(db, A.dispatcherId, () => db.query(`update fuel_logs set liters = 1`));
    assert.equal(edited.rowCount, 0, 'el registro de combustible es de solo agregar (sin edición ni borrado)');
  }

  // Retención configurable (aprobada en 180 días, no fija en el código).
  {
    const setting = (await q(`select value from fleet_settings where key = 'gps_retention_days'`))[0];
    assert.equal(Number(setting.value), 180, 'la retención por defecto es 180 días y vive en configuración');
    const v2 = A.truck2.vehicleId;
    const mk = (days) => db.query(
      `insert into vehicle_positions (municipality_id, vehicle_id, latitude, longitude, captured_at, source) values ($1, $2, 19.8, -71, now() - ($3 || ' days')::interval, 'driver_app')`,
      [A.municipalityId, v2, String(days)]);
    for (const d of [10, 100, 170, 190, 400]) await mk(d);
    const live = (await q('select count(*)::int as n from vehicle_live_state'))[0].n;

    assert.equal(Number((await q('select purge_old_positions() as n'))[0].n), 2, 'con 180 días borra solo 190 y 400');
    assert.equal(Number((await q('select purge_old_positions() as n'))[0].n), 0, 'repetirla no borra más');
    await db.query(`update fleet_settings set value = to_jsonb(120) where key = 'gps_retention_days'`);
    assert.equal(Number((await q('select purge_old_positions() as n'))[0].n), 1, 'al cambiar la configuración a 120 días borra el de 170');
    assert.equal(Number((await q('select purge_old_positions(30) as n'))[0].n), 1, 'un parámetro explícito manda sobre la configuración');
    assert.equal((await q('select count(*)::int as n from vehicle_live_state'))[0].n, live, 'purgar no toca el estado vivo');

    await db.query(`delete from fleet_settings where key = 'gps_retention_days'`);
    await expectDbError(db, () => q('select purge_old_positions()'), /retention_not_configured/);
    await expectDbError(db, () => q('select purge_old_positions(0)'), /invalid_retention/);
    await db.query(`insert into fleet_settings (key, value) values ('gps_retention_days', to_jsonb(180))`);

    // Un usuario normal no puede purgar ni cambiar la configuración.
    assert.equal(Number((await asUser(db, A.adminId, () => q('select purge_old_positions(1) as n')))[0].n), 0, 'sin permiso de borrado no borra nada');
    await asUser(db, A.adminId, () => db.query(`update fleet_settings set value = to_jsonb(1) where key = 'gps_retention_days'`));
    assert.equal(Number((await q(`select value from fleet_settings where key = 'gps_retention_days'`))[0].value), 180, 'un administrador de municipio no cambia la retención de la plataforma');
  }

  console.log('fleet-alerts-fuel ok');
} finally {
  await finish(db);
}

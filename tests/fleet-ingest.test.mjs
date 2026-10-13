// SW-081 (CA-081-1, CA-081-2, CA-081-4): ingesta idempotente de posiciones, estado vivo de la
// flotilla y estados derivados. Prueba de INTEGRACIÓN: necesita Postgres con las migraciones
// aplicadas (Supabase local en CI, o SW_TEST_DB_URL). Corre en el job `integration-tests`.
// Todo ocurre dentro de una transacción que termina en ROLLBACK (ver tests/integration/fleet-db.mjs).
import assert from 'node:assert/strict';
import { connect, finish, asUser, expectDbError, seedMunicipality, point, ingest } from './integration/fleet-db.mjs';

const db = await connect();
const isoAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
try {
  const A = await seedMunicipality(db, 'a');
  const B = await seedMunicipality(db, 'b');
  const v1 = A.truck1.vehicleId;
  const v2 = A.truck2.vehicleId;
  const positionsOf = (vehicleId) => count('select count(*)::int as n from vehicle_positions where vehicle_id = $1', [vehicleId]);

  // CA-081-1: el mismo lote enviado dos veces no duplica filas.
  {
    const batch = [60, 50, 40].map((s) => point({ vehicle_id: v1, route_run_id: A.runId, captured_at: isoAgo(s) }));
    const first = await asUser(db, A.truck1.userId, () => ingest(db, batch));
    assert.deepEqual(first, { inserted: 3, ignored: 0, rejected: 0 });
    const second = await asUser(db, A.truck1.userId, () => ingest(db, batch));
    assert.deepEqual(second, { inserted: 0, ignored: 3, rejected: 0 }, 'reenviar el mismo lote no debe insertar de nuevo');
    assert.equal(await positionsOf(v1), 3);
    const stored = (await db.query('select source, battery_pct, municipality_id, route_run_id from vehicle_positions where vehicle_id = $1 limit 1', [v1])).rows[0];
    assert.equal(stored.source, 'driver_app');
    assert.equal(stored.battery_pct, 80);
    assert.equal(stored.municipality_id, A.municipalityId, 'el municipio sale del camión, no del lote');
    assert.equal(stored.route_run_id, A.runId);
  }

  // Idempotencia también cuando device_id es nulo (NULL no es igual a NULL en un índice único normal).
  {
    const batch = [point({ vehicle_id: v1, route_run_id: A.runId, device_id: null, captured_at: isoAgo(30) })];
    assert.deepEqual(await asUser(db, A.truck1.userId, () => ingest(db, batch)), { inserted: 1, ignored: 0, rejected: 0 });
    assert.deepEqual(await asUser(db, A.truck1.userId, () => ingest(db, batch)), { inserted: 0, ignored: 1, rejected: 0 });
  }

  // CA-081-2: un chofer no inserta posiciones de un camión no asignado ni de otro municipio.
  {
    const before = await positionsOf(v2);
    const otherTruck = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v2 })]));
    assert.deepEqual(otherTruck, { inserted: 0, ignored: 0, rejected: 1 }, 'chofer 1 no puede reportar el camión del chofer 2');
    const otherTenant = await asUser(db, B.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId })]));
    assert.deepEqual(otherTenant, { inserted: 0, ignored: 0, rejected: 1 }, 'chofer del municipio B no puede reportar camiones de A');
    const staff = await asUser(db, A.dispatcherId, () => ingest(db, [point({ vehicle_id: v1 })]));
    assert.equal(staff.rejected, 1, 'solo el chofer asignado reporta por esta vía');
    assert.equal(await positionsOf(v2), before);
    await expectDbError(db, () => asUser(db, null, () => ingest(db, [point({ vehicle_id: v1 })])), /not_authenticated|permission denied/i);
  }

  // La corrida del punto debe ser la del mismo camión y chofer, y estar activa.
  {
    const otherRun = (await db.query(
      `insert into route_runs (municipality_id, route_id, vehicle_id, driver_id, status) values ($1, $2, $3, $4, 'started') returning id`,
      [A.municipalityId, A.routeId, v2, A.truck2.driverId])).rows[0].id;
    const wrongRun = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: otherRun })]));
    assert.equal(wrongRun.rejected, 1, 'corrida de otro camión debe rechazarse');
    const crossTenantRun = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: B.runId })]));
    assert.equal(crossTenantRun.rejected, 1, 'corrida de otro municipio debe rechazarse');
    await db.query(`update route_runs set status = 'completed' where id = $1`, [otherRun]); // el camión 2 vuelve a quedar sin corrida activa
    await db.query(`update route_runs set status = 'completed' where id = $1`, [A.runId]);
    const finished = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, captured_at: isoAgo(20) })]));
    assert.equal(finished.rejected, 1, 'corrida terminada no recibe más puntos');
    await db.query(`update route_runs set status = 'started' where id = $1`, [A.runId]);
  }

  // Entradas basura: se rechaza el punto, no se cae todo el lote.
  {
    const batch = [
      point({ vehicle_id: v1, route_run_id: A.runId, captured_at: isoAgo(15) }),
      point({ vehicle_id: v1, route_run_id: A.runId, latitude: 95, captured_at: isoAgo(14) }),
      point({ vehicle_id: 'no-es-un-uuid', captured_at: isoAgo(13) }),
      point({ vehicle_id: v1, route_run_id: A.runId, captured_at: 'ayer' }),
      point({ vehicle_id: v1, route_run_id: A.runId, latitude: null, captured_at: isoAgo(12) })
    ];
    assert.deepEqual(await asUser(db, A.truck1.userId, () => ingest(db, batch)), { inserted: 1, ignored: 0, rejected: 4 });
    await expectDbError(db, () => asUser(db, A.truck1.userId, () => db.query(`select ingest_positions('{"vehicle_id":1}'::jsonb)`)), /batch_must_be_array/);
  }

  // Batería fuera de rango: el punto se guarda, la batería no.
  {
    const capturedAt = isoAgo(25);
    const result = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, battery_pct: 150, captured_at: capturedAt })]));
    assert.equal(result.inserted, 1);
    const rows = (await db.query('select battery_pct from vehicle_positions where vehicle_id = $1 and captured_at = $2', [v1, capturedAt])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].battery_pct, null, 'batería fuera de 0-100 se guarda como nula');
  }

  // Lote máximo: 200 puntos sí, 201 no.
  {
    const make = (n) => Array.from({ length: n }, (_, i) => point({ vehicle_id: v2, device_id: 'phone-batch', captured_at: new Date(Date.now() - 3_600_000 + i * 1000).toISOString() }));
    const ok = await asUser(db, A.truck2.userId, () => ingest(db, make(200)));
    assert.deepEqual(ok, { inserted: 200, ignored: 0, rejected: 0 });
    await expectDbError(db, () => asUser(db, A.truck2.userId, () => ingest(db, make(201))), /batch_too_large/);
  }

  // Review Focus 1: reloj del teléfono adelantado más de 5 min → rechazado y sin tocar el estado vivo.
  {
    const before = (await db.query('select captured_at from vehicle_live_state where vehicle_id = $1', [v1])).rows[0].captured_at;
    const future = new Date(Date.now() + 6 * 60_000).toISOString();
    const result = await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, captured_at: future })]));
    assert.deepEqual(result, { inserted: 0, ignored: 0, rejected: 1 });
    const after = (await db.query('select captured_at from vehicle_live_state where vehicle_id = $1', [v1])).rows[0].captured_at;
    assert.equal(after.getTime(), before.getTime(), 'el estado vivo no debe moverse al futuro');
  }

  // Review Focus 2: un lote tardío con puntos más viejos entra al historial pero no retrocede el estado vivo.
  {
    const liveBefore = (await db.query('select captured_at, latitude from vehicle_live_state where vehicle_id = $1', [v1])).rows[0];
    const old = point({ vehicle_id: v1, route_run_id: A.runId, latitude: 18.5, captured_at: isoAgo(600) });
    const result = await asUser(db, A.truck1.userId, () => ingest(db, [old]));
    assert.equal(result.inserted, 1);
    const liveAfter = (await db.query('select captured_at, latitude from vehicle_live_state where vehicle_id = $1', [v1])).rows[0];
    assert.equal(liveAfter.captured_at.getTime(), liveBefore.captured_at.getTime(), 'el estado vivo no retrocede');
    assert.equal(Number(liveAfter.latitude), Number(liveBefore.latitude));
  }

  // Estado vivo: sigue al punto más nuevo y lleva batería, corrida y municipio del camión.
  {
    const live = (await db.query('select * from vehicle_live_state where vehicle_id = $1', [v1])).rows[0];
    assert.equal(live.municipality_id, A.municipalityId);
    assert.equal(live.route_run_id, A.runId);
    assert.equal(live.battery_pct, 80);
    assert.equal(live.status, 'en_ruta');
  }

  // Estados derivados en SQL (misma tabla que shared/fleet-status.js).
  {
    const status = async (...args) => (await db.query('select derive_vehicle_status($1, $2, $3, $4, $5) as s', args)).rows[0].s;
    const now = '2026-10-13T12:00:00Z';
    const ago = (s) => new Date(Date.parse(now) - s * 1000).toISOString();
    assert.equal(await status(true, ago(89), 5, null, now), 'en_ruta');
    assert.equal(await status(true, ago(91), 5, null, now), 'sin_senal');
    assert.equal(await status(true, null, null, null, now), 'sin_senal', 'corrida activa sin ninguna posición');
    assert.equal(await status(true, ago(10), 0.5, ago(360), now), 'detenido');
    assert.equal(await status(true, ago(10), 0.5, ago(240), now), 'en_ruta', 'menos de 5 minutos quieto no es detenido');
    assert.equal(await status(true, ago(100), 0.5, ago(900), now), 'sin_senal', 'sin señal gana sobre detenido');
    assert.equal(await status(false, ago(5), 9, null, now), 'disponible', 'Review Focus 4: se mueve sin corrida activa');
    assert.equal(await status(false, null, null, null, now), 'disponible');
  }

  // fleet_overview: una fila por camión, estado derivado, y sin filtrar datos de otro municipio.
  {
    await asUser(db, A.truck2.userId, () => ingest(db, [point({ vehicle_id: v2, speed: 9, captured_at: isoAgo(3) })]));
    const rows = await asUser(db, A.adminId, async () => (await db.query('select * from fleet_overview()')).rows);
    assert.equal(rows.length, 2, 'administrador A ve los 2 camiones de A y ninguno de B');
    const t1 = rows.find((r) => r.vehicle_id === v1);
    const t2 = rows.find((r) => r.vehicle_id === v2);
    assert.equal(t1.status, 'en_ruta');
    assert.equal(t1.route_id, A.routeId);
    assert.ok(t1.driver_name.startsWith('Chofer 1'));
    assert.ok(t1.seconds_since_report >= 0 && t1.seconds_since_report < 120);
    assert.equal(t2.status, 'disponible', 'camión con posición reciente pero sin corrida activa');
    assert.equal(rows.some((r) => r.vehicle_id === B.truck1.vehicleId), false);

    // sin señal: la última posición del camión 1 se envejece 5 minutos.
    await db.query(`update vehicle_live_state set captured_at = now() - interval '5 minutes' where vehicle_id = $1`, [v1]);
    const stale = await asUser(db, A.dispatcherId, async () => (await db.query('select status from fleet_overview() where vehicle_id = $1', [v1])).rows[0]);
    assert.equal(stale.status, 'sin_senal');

    // CA-081-4 (parte de lectura): B no ve A; el chofer no usa el centro de control.
    const asB = await asUser(db, B.adminId, async () => (await db.query('select vehicle_id from fleet_overview()')).rows);
    assert.deepEqual(asB.map((r) => r.vehicle_id).sort(), [B.truck1.vehicleId, B.truck2.vehicleId].sort());
    const asDriver = await asUser(db, A.truck1.userId, async () => (await db.query('select * from fleet_overview()')).rows);
    assert.equal(asDriver.length, 0, 'un chofer no recibe la vista de flotilla');
    await expectDbError(db, () => asUser(db, null, () => db.query('select * from fleet_overview()')), /permission denied/i);
  }

  // "Detenido": velocidad < 1 m/s sostenida; el reloj de quietud no se reinicia con cada punto.
  {
    await db.query(`update vehicle_live_state set captured_at = now() - interval '20 seconds' where vehicle_id = $1`, [v1]);
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, speed: 0.2, captured_at: isoAgo(10) })]));
    const first = (await db.query('select stopped_since from vehicle_live_state where vehicle_id = $1', [v1])).rows[0].stopped_since;
    assert.ok(first, 'queda marcado desde cuándo está quieto');
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, speed: 0.1, captured_at: isoAgo(2) })]));
    const second = (await db.query('select stopped_since from vehicle_live_state where vehicle_id = $1', [v1])).rows[0].stopped_since;
    assert.equal(second.getTime(), first.getTime(), 'puntos quietos consecutivos conservan el inicio de la quietud');
    await db.query(`update vehicle_live_state set stopped_since = now() - interval '6 minutes' where vehicle_id = $1`, [v1]);
    const overview = await asUser(db, A.adminId, async () => (await db.query('select status from fleet_overview() where vehicle_id = $1', [v1])).rows[0]);
    assert.equal(overview.status, 'detenido');
    await asUser(db, A.truck1.userId, () => ingest(db, [point({ vehicle_id: v1, route_run_id: A.runId, speed: 6, captured_at: isoAgo(1) })]));
    const moving = (await db.query('select stopped_since from vehicle_live_state where vehicle_id = $1', [v1])).rows[0].stopped_since;
    assert.equal(moving, null, 'al volver a moverse se limpia la quietud');
  }

  console.log('fleet-ingest ok');
} finally {
  await finish(db);
}

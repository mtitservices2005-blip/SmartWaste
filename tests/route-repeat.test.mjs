// SW-086: al completar una corrida queda lista la siguiente (la ruta se repite) sin abrir permisos nuevos.
// Prueba de INTEGRACIÓN (Postgres con migraciones; corre en CI / SW_TEST_DB_URL). Transacción con ROLLBACK.
import assert from 'node:assert/strict';
import { connect, finish, asUser, expectDbError, seedMunicipality } from './integration/fleet-db.mjs';

const db = await connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const OPEN = `('planned','assigned','started','in_progress','delayed')`;
try {
  const A = await seedMunicipality(db, 'rep');
  const openRuns = () => q(`select * from route_runs where route_id = $1 and status in ${OPEN} order by created_at`, [A.routeId]);

  // El chofer completa su corrida → aparece exactamente una nueva "assigned" con el mismo camión y chofer.
  await asUser(db, A.truck1.userId, () => db.query(`update route_runs set status = 'completed', completed_at = now() where id = $1`, [A.runId]));
  let open = await openRuns();
  assert.equal(open.length, 1, 'queda una sola corrida abierta');
  assert.equal(open[0].status, 'assigned');
  assert.equal(open[0].vehicle_id, A.truck1.vehicleId);
  assert.equal(open[0].driver_id, A.truck1.driverId);
  assert.equal(open[0].municipality_id, A.municipalityId);
  assert.notEqual(open[0].id, A.runId);

  // Volver a escribir "completed" sobre la misma corrida no duplica.
  await db.query(`update route_runs set completed_at = now() where id = $1`, [A.runId]);
  assert.equal((await openRuns()).length, 1, 'no se duplica');

  // Verificar la corrida terminada no crea otra.
  await db.query(`update route_runs set status = 'verified' where id = $1`, [A.runId]);
  assert.equal((await openRuns()).length, 1, 'verificar no crea corrida');

  // Con una corrida abierta de la misma ruta, completar otra no agrega más.
  const second = await q(`insert into route_runs (municipality_id, route_id, vehicle_id, driver_id, status, started_at) values ($1,$2,$3,$4,'started', now()) returning id`, [A.municipalityId, A.routeId, A.truck1.vehicleId, A.truck1.driverId]);
  await db.query(`update route_runs set status = 'completed', completed_at = now() where id = $1`, [second[0].id]);
  assert.equal((await openRuns()).length, 1, 'nunca dos corridas abiertas');

  // Sin camión no se repite.
  await db.query(`update route_runs set status = 'cancelled' where id = $1`, [open[0].id]);
  const noVehicle = await q(`insert into route_runs (municipality_id, route_id, driver_id, status, started_at) values ($1,$2,$3,'started', now()) returning id`, [A.municipalityId, A.routeId, A.truck1.driverId]);
  await db.query(`update route_runs set status = 'completed', completed_at = now() where id = $1`, [noVehicle[0].id]);
  assert.equal((await openRuns()).length, 0, 'sin camión no se repite');

  // La función no se puede llamar a mano ni con sesión ni sin ella.
  for (const userId of [A.truck1.userId, A.adminId, null]) {
    await expectDbError(db, () => asUser(db, userId, () => db.query('select repeat_route_run_after_completion()')), /permission denied|trigger|does not exist/i);
  }

  // Columnas nuevas: solo días 0 a 6.
  await expectDbError(db, () => db.query(`update routes set days_of_week = array[7]::smallint[] where id = $1`, [A.routeId]), /routes_days_of_week_check|check/i);
  await db.query(`update routes set start_time = '08:00', days_of_week = array[1,3,5]::smallint[] where id = $1`, [A.routeId]);
  const [route] = await q(`select start_time::text, days_of_week from routes where id = $1`, [A.routeId]);
  assert.equal(route.start_time, '08:00:00');
  assert.deepEqual(route.days_of_week, [1, 3, 5]);
  console.log('route-repeat ok');
} finally {
  await finish(db);
}

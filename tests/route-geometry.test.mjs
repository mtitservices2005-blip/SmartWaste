// SW-086b: reemplazo atómico de trazo y paradas. Prueba de INTEGRACIÓN (Postgres con migraciones; corre en CI / SW_TEST_DB_URL).
// Transacción con ROLLBACK.
import assert from 'node:assert/strict';
import { connect, finish, asUser, expectDbError, seedMunicipality } from './integration/fleet-db.mjs';

const db = await connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
try {
  const A = await seedMunicipality(db, 'geo-a');
  const B = await seedMunicipality(db, 'geo-b');
  const pts = (n, base = 19) => Array.from({ length: n }, (_, i) => ({ sequence: i + 1, latitude: base + i * 0.001, longitude: -71 - i * 0.001 }));
  const stops = (n, base = 19) => pts(n, base).map((p) => ({ ...p, label: `Parada ${p.sequence}` }));
  const replace = (userId, routeId, points, st) => asUser(db, userId, () => db.query('select replace_route_geometry($1, $2::jsonb, $3::jsonb)', [routeId, JSON.stringify(points), JSON.stringify(st)]));
  const counts = async () => (await q(`select (select count(*)::int from route_paths where route_id = $1) as paths, (select count(*)::int from route_stops where route_id = $1) as stops`, [A.routeId]))[0];

  for (const p of pts(3)) await db.query('insert into route_paths (municipality_id, route_id, sequence, latitude, longitude) values ($1,$2,$3,$4,$5)', [A.municipalityId, A.routeId, p.sequence, p.latitude, p.longitude]);
  for (const s of stops(3)) await db.query('insert into route_stops (municipality_id, route_id, sequence, label, latitude, longitude) values ($1,$2,$3,$4,$5,$6)', [A.municipalityId, A.routeId, s.sequence, s.label, s.latitude, s.longitude]);
  assert.deepEqual(await counts(), { paths: 3, stops: 3 });

  // Con la corrida en marcha no se puede editar el trazo.
  await expectDbError(db, () => replace(A.dispatcherId, A.routeId, pts(2), stops(2)), /en marcha|P0001/i);
  assert.deepEqual(await counts(), { paths: 3, stops: 3 }, 'sin cambios');

  // Termina la corrida (como base): ya se puede editar.
  await db.query(`update route_runs set status = 'completed', completed_at = now() where id = $1`, [A.runId]);

  // Quién no puede: chofer, otro municipio, anónimo.
  for (const userId of [A.truck1.userId, B.adminId]) {
    await expectDbError(db, () => replace(userId, A.routeId, pts(2), stops(2)), /sin permiso|42501|permission/i);
  }
  await expectDbError(db, () => replace(null, A.routeId, pts(2), stops(2)), /permission denied|42501|sin permiso/i);
  assert.deepEqual(await counts(), { paths: 3, stops: 3 }, 'nadie sin permiso cambió nada');

  // Datos inválidos: no queda a medias (todo o nada).
  await expectDbError(db, () => replace(A.dispatcherId, A.routeId, pts(1), stops(1)), /al menos 2 puntos|22023/i);
  await expectDbError(db, () => replace(A.dispatcherId, A.routeId, pts(2), [{ sequence: 1, label: 'x', latitude: 'no-es-numero', longitude: 1 }]), /invalid input|22P02|numeric/i);
  assert.deepEqual(await counts(), { paths: 3, stops: 3 }, 'si falla, conserva trazo y paradas anteriores');
  const [firstOld] = await q('select latitude::float8 as lat from route_paths where route_id = $1 order by sequence', [A.routeId]);
  assert.equal(firstOld.lat, 19);

  // Éxito: despachador reemplaza; el trazo y las paradas viejos desaparecen.
  await replace(A.dispatcherId, A.routeId, pts(5, 20), stops(4, 20));
  assert.deepEqual(await counts(), { paths: 5, stops: 4 });
  const [first] = await q('select latitude::float8 as lat from route_paths where route_id = $1 order by sequence limit 1', [A.routeId]);
  assert.equal(first.lat, 20);
  const owner = await q('select distinct municipality_id from route_paths where route_id = $1', [A.routeId]);
  assert.deepEqual(owner.map((r) => r.municipality_id), [A.municipalityId], 'las filas nuevas son del municipio de la ruta');

  // El historial de corridas no se toca.
  const runs = await q(`select status from route_runs where id = $1`, [A.runId]);
  assert.equal(runs[0].status, 'completed');
  console.log('route-geometry ok');
} finally {
  await finish(db);
}

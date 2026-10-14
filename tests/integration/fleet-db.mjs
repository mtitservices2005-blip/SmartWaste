// SW-081: helpers compartidos por las pruebas de integración de flotilla (fleet-*.test.mjs).
// Conexión directa a Postgres (igual que tests/rls-coverage.test.mjs): DB_URL sale de
// `npx supabase status -o json`, o de la variable SW_TEST_DB_URL si se quiere apuntar a otro
// Postgres con las migraciones aplicadas. Cada prueba corre dentro de UNA transacción que termina
// en ROLLBACK, así que no deja datos y no toca nada fuera de la base local.
// Los usuarios se simulan como lo hace PostgREST: `set local role authenticated` + claims JWT.
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadLocalSupabaseEnv } from './local-supabase-env.mjs';

export async function connect() {
  const url = process.env.SW_TEST_DB_URL || loadLocalSupabaseEnv().DB_URL;
  if (!url) throw new Error('No hay DB_URL: inicia `npx supabase start` o define SW_TEST_DB_URL.');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query('begin');
  return db;
}

export async function finish(db) {
  try { await db.query('rollback'); } finally { await db.end(); }
}

// Ejecuta fn como el usuario `userId` (rol authenticated) o como anónimo (userId = null).
export async function asUser(db, userId, fn) {
  const claims = userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : JSON.stringify({ role: 'anon' });
  await db.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [claims, userId || '']);
  await db.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    // Limpieza "lo mejor posible": si la transacción ya falló, no debe tapar el error original.
    await db.query('reset role').catch(() => {});
    await db.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`).catch(() => {});
  }
}

// Espera que fn falle con un error de base de datos que cumpla `pattern`; deja la transacción usable.
export async function expectDbError(db, fn, pattern) {
  await db.query('savepoint expect_err');
  try {
    await fn();
  } catch (error) {
    await db.query('rollback to savepoint expect_err');
    await db.query('release savepoint expect_err');
    if (pattern) assert.match(`${error.message}`, pattern, `error inesperado: ${error.message}`);
    return error;
  }
  await db.query('release savepoint expect_err');
  assert.fail('se esperaba un error de base de datos y no ocurrió');
}

let counter = 0;
const uid = () => `${Date.now().toString(16)}${(counter++).toString(16)}`;

async function one(db, text, params) {
  const result = await db.query(text, params);
  return result.rows[0];
}

async function addMember(db, municipalityId, role, label) {
  const profile = await one(db, `insert into profiles (id, display_name) values (gen_random_uuid(), $1) returning id`, [label]);
  await db.query(`insert into memberships (municipality_id, profile_id, role, status) values ($1, $2, $3, 'active')`, [municipalityId, profile.id, role]);
  return profile.id;
}

// Un municipio con: admin, despacho, dos choferes (cada uno asignado a su camión), una ruta y una
// corrida activa del chofer 1 con el camión 1. `extraVehicles` crea camiones extra sin chofer.
export async function seedMunicipality(db, tag, { extraVehicles = 0 } = {}) {
  const suffix = `${tag}-${uid()}`;
  const municipality = await one(db, `insert into municipalities (slug, name) values ($1, $2) returning id`, [`sw081-${suffix}`, `Municipio ${suffix}`]);
  const m = municipality.id;
  const adminId = await addMember(db, m, 'municipal_admin', `Admin ${suffix}`);
  const dispatcherId = await addMember(db, m, 'dispatcher', `Despacho ${suffix}`);
  const route = await one(db, `insert into routes (municipality_id, name) values ($1, $2) returning id`, [m, `Ruta ${suffix}`]);
  const trucks = [];
  for (const n of [1, 2]) {
    const userId = await addMember(db, m, 'driver', `Chofer ${n} ${suffix}`);
    const driver = await one(db, `insert into drivers (municipality_id, profile_id, display_name) values ($1, $2, $3) returning id`, [m, userId, `Chofer ${n} ${suffix}`]);
    const vehicle = await one(db, `insert into vehicles (municipality_id, code, plate) values ($1, $2, $3) returning id`, [m, `C${n}-${suffix}`, `P${n}-${suffix}`]);
    await db.query(`insert into vehicle_assignments (municipality_id, vehicle_id, driver_id, status) values ($1, $2, $3, 'assigned')`, [m, vehicle.id, driver.id]);
    trucks.push({ userId, driverId: driver.id, vehicleId: vehicle.id });
  }
  const run = await one(db,
    `insert into route_runs (municipality_id, route_id, vehicle_id, driver_id, status, started_at) values ($1, $2, $3, $4, 'started', now()) returning id`,
    [m, route.id, trucks[0].vehicleId, trucks[0].driverId]);
  const spare = [];
  for (let i = 0; i < extraVehicles; i += 1) {
    const vehicle = await one(db, `insert into vehicles (municipality_id, code) values ($1, $2) returning id`, [m, `X${i}-${suffix}`]);
    spare.push(vehicle.id);
  }
  return { municipalityId: m, adminId, dispatcherId, routeId: route.id, runId: run.id, truck1: trucks[0], truck2: trucks[1], spareVehicleIds: spare };
}

// Arma un punto de lote con los mismos nombres de campo que acepta ingest_positions.
export function point(overrides = {}) {
  return {
    vehicle_id: null,
    route_run_id: null,
    device_id: 'phone-test-1',
    latitude: 19.8,
    longitude: -71.0,
    accuracy: 8,
    speed: 5,
    heading: 90,
    battery_pct: 80,
    captured_at: new Date(Date.now() - 5000).toISOString(),
    ...overrides
  };
}

export async function ingest(db, batch) {
  const result = await db.query('select ingest_positions($1::jsonb) as r', [JSON.stringify(batch)]);
  return result.rows[0].r;
}

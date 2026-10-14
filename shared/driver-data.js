// SW-085: lo que el chofer ve hoy. Solo lecturas con la anon key y la sesión del chofer; las reglas de
// seguridad (RLS) siguen decidiendo qué filas puede leer. Un error real se devuelve como error, nunca como
// "sin rutas". Si la columna scheduled_start_at todavía no existe (migración sin aplicar), se reintenta sin ella.
import { haversineMeters, formatDistance } from './driver-nav.js';

const DRIVER_COLS = 'id,display_name,email,status,municipality_id,profile_id';
const RUN_STATUSES = ['planned', 'assigned', 'started', 'in_progress', 'delayed', 'completed'];

const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
const failure = (error) => ({ ok: false, message: error?.message ?? 'Error desconocido al leer tus rutas.' });

export async function findDriverRow(client, { userId, municipalityId, email }) {
  const byProfile = await client.from('drivers').select(DRIVER_COLS).eq('municipality_id', municipalityId).eq('profile_id', userId).maybeSingle();
  if (byProfile.error) throw new Error(byProfile.error.message);
  if (byProfile.data) return byProfile.data;
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail) return null;
  const byEmail = await client.from('drivers').select(DRIVER_COLS).eq('municipality_id', municipalityId).ilike('email', escapeLike(mail)).maybeSingle();
  if (byEmail.error) throw new Error(byEmail.error.message);
  return byEmail.data ?? null;
}

async function fetchRuns(client, driverId, withSchedule) {
  const cols = `id,route_id,vehicle_id,status,created_at,started_at${withSchedule ? ',scheduled_start_at' : ''}`;
  return client.from('route_runs').select(cols).eq('driver_id', driverId).in('status', RUN_STATUSES).order('created_at', { ascending: false }).limit(50);
}

function pathDistanceText(stops) {
  const pts = stops.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  if (pts.length < 2 || pts.length !== stops.length) return '—';
  let meters = 0;
  for (let i = 1; i < pts.length; i += 1) meters += haversineMeters(pts[i - 1], pts[i]) ?? 0;
  return formatDistance(meters);
}

export async function loadDriverToday(client, { userId, municipalityId, email }) {
  try {
    const driver = await findDriverRow(client, { userId, municipalityId, email });
    if (!driver) return { ok: true, driver: null, unit: null, runs: [] };
    let result = await fetchRuns(client, driver.id, true);
    if (result.error && /scheduled_start_at/.test(result.error.message ?? '')) result = await fetchRuns(client, driver.id, false);
    if (result.error) return failure(result.error);
    const runs = result.data ?? [];
    if (!runs.length) return { ok: true, driver, unit: null, runs: [] };
    const routeIds = [...new Set(runs.map((r) => r.route_id).filter(Boolean))];
    const vehicleIds = [...new Set(runs.map((r) => r.vehicle_id).filter(Boolean))];
    const [routesRes, stopsRes, vehiclesRes] = await Promise.all([
      routeIds.length ? client.from('routes').select('id,name').in('id', routeIds) : { data: [], error: null },
      routeIds.length ? client.from('route_stops').select('route_id,sequence,label,latitude,longitude').in('route_id', routeIds).order('sequence', { ascending: true }) : { data: [], error: null },
      vehicleIds.length ? client.from('vehicles').select('id,code,plate').in('id', vehicleIds) : { data: [], error: null }
    ]);
    for (const res of [routesRes, stopsRes, vehiclesRes]) if (res.error) return failure(res.error);
    const nameById = new Map((routesRes.data ?? []).map((r) => [r.id, r.name]));
    const unitById = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.code]));
    const items = runs.map((run) => {
      const stops = (stopsRes.data ?? []).filter((s) => s.route_id === run.route_id).sort((a, b) => a.sequence - b.sequence);
      return {
        id: run.id, routeId: run.route_id, vehicleId: run.vehicle_id, status: run.status, createdAt: run.created_at,
        scheduledStartAt: run.scheduled_start_at ?? null, startedAt: run.started_at ?? null,
        routeName: nameById.get(run.route_id) ?? 'Ruta',
        stopsCount: stops.length, stops, distanceText: pathDistanceText(stops), estimatedMinutes: null
      };
    });
    const unit = unitById.get(runs.find((r) => r.vehicle_id)?.vehicle_id) ?? null;
    return { ok: true, driver, unit, runs: items };
  } catch (error) {
    return failure(error);
  }
}

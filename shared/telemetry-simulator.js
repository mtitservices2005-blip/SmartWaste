import { trucks, routePaths, simulationNotice } from './demo-data.js';
export const TELEMETRY_SOURCES = ['driver_app','browser_geolocation','dedicated_tracker','external_authorized','simulator'];
export function makeTelemetry({ vehicle_id, municipality_id='laguna-salada-rd', latitude, longitude, accuracy=12, speed=0, heading=0, source='simulator', device_id='demo-simulator', correlation_id='demo-correlation' }) {
  return { vehicle_id, municipality_id, latitude, longitude, accuracy, speed, heading, captured_at:new Date().toISOString(), received_at:new Date().toISOString(), source, device_id, correlation_id };
}
export class DeviceSimulator {
  // docs/TECHNICAL_DEBT_REGISTER.md item 16: emit() used to always look up its path via the global
  // routePaths dictionary, coupling this otherwise adapter-agnostic class to a specific in-memory
  // demo structure — the reason frontend/app.js's finishCreateRoute() had to mutate that dictionary
  // at runtime for hand-drawn routes. `getPath`, if given, is called lazily on every emit() instead
  // (not read once at construction) so callers can supply geometry from wherever it actually lives
  // (e.g. frontend/app.js's routeGeometry(), which reads through operationsAdapter) without this
  // class needing to know or care. Omit it and behavior is unchanged — falls back to the same
  // routePaths/trucks lookup as before, which is what every existing test still relies on.
  constructor(vehicleId = trucks[0].id, { getPath = null } = {}) { this.vehicleId = vehicleId; this.getPath = getPath; this.intervalMs = 1000; this.speed = 18; this.index = 0; this.running = false; this.signalLost = false; this.events = []; }
  selectVehicle(vehicleId) { this.vehicleId = vehicleId; this.reset(); }
  start() { this.running = true; return this.emit(); }
  pause() { this.running = false; return { paused:true }; }
  reset() { this.index = 0; this.signalLost = false; this.events = []; }
  setSpeed(speed) { this.speed = speed; }
  simulateSignalLoss() { this.signalLost = true; return null; }
  simulateStopped() { this.speed = 0; return this.emit('stopped'); }
  simulateDelayed() { return this.emit('delayed'); }
  simulateIncident(type='simulated_incident') { const event = { type, vehicle_id:this.vehicleId, notice: simulationNotice }; this.events.push(event); return event; }
  emit(status='in_progress') { if (this.signalLost) return null; const truck = trucks.find((t) => t.id === this.vehicleId) ?? trucks[0]; const path = this.getPath ? this.getPath() : (routePaths[truck.routeId] ?? [truck.position ?? [19.6489, -71.0956]]); const [latitude, longitude] = path[this.index % path.length]; this.index += 1; return { status, ...makeTelemetry({ vehicle_id:this.vehicleId, latitude, longitude, speed:this.speed }) }; }
}

// Client-side stand-in for querying vehicle_positions by vehicle_id ordered by captured_at (the
// real read path — see supabase/migrations/202607150003_sw013_persistence_hardening.sql:72's
// vehicle_positions_vehicle_recorded_idx). Keeps every recorded point, never discards — same
// "dense history" shape the real table has. Used by frontend/app.js's driver mobile view to poll
// for redraws while Realtime postgres_changes stays unresolved (docs/TECHNICAL_DEBT_REGISTER.md
// item #14).
export function createDemoPositionHistory() {
  const history = new Map();
  return {
    record(position) {
      if (!position?.vehicle_id) return position;
      const list = history.get(position.vehicle_id) ?? [];
      list.push(position);
      history.set(position.vehicle_id, list);
      return position;
    },
    listPositions(vehicleId) {
      return (history.get(vehicleId) ?? []).slice().sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
    }
  };
}

export function validateTelemetryPosition(position, { maxAgeMs = 1000 * 60 * 60 * 6, now = Date.now() } = {}) {
  const errors = [];
  if (!position?.vehicle_id) errors.push('vehicle_id is required');
  if (!position?.municipality_id) errors.push('municipality_id is required');
  if (!Number.isFinite(Number(position?.latitude)) || Number(position.latitude) < -90 || Number(position.latitude) > 90) errors.push('latitude is invalid');
  if (!Number.isFinite(Number(position?.longitude)) || Number(position.longitude) < -180 || Number(position.longitude) > 180) errors.push('longitude is invalid');
  if (!TELEMETRY_SOURCES.includes(position?.source)) errors.push('source is not recognized');
  if (position?.speed !== undefined && Number(position.speed) < 0) errors.push('speed cannot be negative');
  const recordedAt = Date.parse(position?.captured_at ?? position?.recorded_at ?? '');
  if (!Number.isFinite(recordedAt)) errors.push('timestamp is invalid');
  else if (now - recordedAt > maxAgeMs) errors.push('position is too old');
  return { valid: errors.length === 0, errors };
}

// See the comments inside subscribe() below for why these exist.
const REALTIME_SUBSCRIBE_SETTLE_MS = 2000;
const REALTIME_SUBSCRIBE_RETRY_BACKOFF_MS = [1000, 2000, 4000];

export function createTelemetryIngestionAdapter(client, { municipality_id = null } = {}) {
  return {
    mode: client?.from ? 'REAL' : 'REAL_NOT_RUN',
    async ingest(position, opts = {}) {
      const validation = validateTelemetryPosition(position);
      if (!validation.valid) return { ok:false, source:this.mode, error:{ code:'INVALID_TELEMETRY', message:validation.errors.join('; ') }, correlation_id: opts.correlation_id ?? position?.correlation_id ?? null };
      if (municipality_id && position.municipality_id !== municipality_id) return { ok:false, source:this.mode, error:{ code:'CROSS_TENANT_TELEMETRY', message:'Telemetry municipality does not match active municipality.' }, correlation_id: opts.correlation_id ?? position.correlation_id ?? null };
      if (!client?.from) return { ok:false, source:'REAL_NOT_RUN', error:{ code:'SUPABASE_CLIENT_MISSING', message:'Telemetry persistence was prepared but not executed.' }, correlation_id: opts.correlation_id ?? position.correlation_id ?? null };
      // Only the columns vehicle_positions actually has (supabase/migrations/202607150001_sw007_
      // foundation.sql:13) — DeviceSimulator.emit() (above) returns { status, ...telemetry } where
      // `status` describes simulated route progress for the map UI, not a vehicle_positions column;
      // spreading `position` directly into the insert would send that extra field to PostgREST and
      // fail with "Could not find the 'status' column" (PGRST204).
      const payload = {
        vehicle_id: position.vehicle_id,
        municipality_id: position.municipality_id,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        heading: position.heading,
        captured_at: position.captured_at ?? position.recorded_at,
        received_at: position.received_at,
        source: position.source,
        device_id: position.device_id,
        correlation_id: opts.correlation_id ?? position.correlation_id
      };
      const result = await client.from('vehicle_positions').insert(payload).select('*').single();
      if (result.error) return { ok:false, source:'REAL', error:{ code: result.error.code ?? 'SUPABASE_ERROR', message: result.error.message }, correlation_id: payload.correlation_id };
      return { ok:true, source:'REAL', data:result.data, correlation_id: payload.correlation_id };
    },
    subscribe(vehicleId, onPosition, { onStatus } = {}) {
      if (!client?.channel) return { status:'REALTIME_NOT_RUN', unsubscribe() {} };
      // Item #14 (SW-022, docs/TECHNICAL_DEBT_REGISTER.md): the channel reports 'SUBSCRIBED' as
      // soon as the client joins the Phoenix channel, but that does not mean the server-side WAL
      // consumer for this specific table+filter has actually been set up yet — that can still fail
      // shortly after (observed in CI as the "subscription_errors" rate counter incrementing ~1s
      // after join). Retry the whole subscribe from scratch with backoff whenever the channel
      // reports CHANNEL_ERROR/CLOSED/TIMED_OUT, and only pass 'SUBSCRIBED' up to the caller after
      // it has held for REALTIME_SUBSCRIBE_SETTLE_MS without failing. NOTE this is a best-effort
      // mitigation, not a guaranteed fix: SW-022 also observed a third failure mode in CI where the
      // channel stays open and reports nothing wrong at all, yet the event is simply never
      // delivered — that failure is invisible to the client, so no retry-on-status logic can catch
      // it. Callers relying on Realtime delivery being real should not assume this makes it so.
      let settleTimer = null;
      let retryTimer = null;
      let attempt = 0;
      let stopped = false;
      let channel = null;

      const attemptSubscribe = () => {
        attempt += 1;
        channel = client.channel(`vehicle_positions:${vehicleId}:${attempt}`)
          .on('postgres_changes', { event:'INSERT', schema:'public', table:'vehicle_positions', filter:`vehicle_id=eq.${vehicleId}` }, (payload) => onPosition(payload.new))
          .subscribe((status, err) => {
            if (stopped) return;
            if (status === 'SUBSCRIBED') { settleTimer = setTimeout(() => { if (!stopped) onStatus?.(status, err); }, REALTIME_SUBSCRIBE_SETTLE_MS); return; }
            const canRetry = (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') && attempt <= REALTIME_SUBSCRIBE_RETRY_BACKOFF_MS.length;
            if (canRetry) {
              if (settleTimer) clearTimeout(settleTimer);
              channel.unsubscribe();
              retryTimer = setTimeout(attemptSubscribe, REALTIME_SUBSCRIBE_RETRY_BACKOFF_MS[attempt - 1]);
              return;
            }
            onStatus?.(status, err);
          });
      };
      attemptSubscribe();

      return {
        status:'REALTIME_SUBSCRIBED',
        unsubscribe: () => {
          stopped = true;
          if (settleTimer) clearTimeout(settleTimer);
          if (retryTimer) clearTimeout(retryTimer);
          channel?.unsubscribe();
        }
      };
    }
  };
}

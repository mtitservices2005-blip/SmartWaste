import { trucks, routePaths, simulationNotice } from './demo-data.js';
export const TELEMETRY_SOURCES = ['driver_app','browser_geolocation','dedicated_tracker','external_authorized','simulator'];
export function makeTelemetry({ vehicle_id, municipality_id='laguna-salada-rd', latitude, longitude, accuracy=12, speed=0, heading=0, source='simulator', device_id='demo-simulator', correlation_id='demo-correlation' }) {
  return { vehicle_id, municipality_id, latitude, longitude, accuracy, speed, heading, captured_at:new Date().toISOString(), received_at:new Date().toISOString(), source, device_id, correlation_id };
}
export class DeviceSimulator {
  constructor(vehicleId = trucks[0].id) { this.vehicleId = vehicleId; this.intervalMs = 1000; this.speed = 18; this.index = 0; this.running = false; this.signalLost = false; this.events = []; }
  selectVehicle(vehicleId) { this.vehicleId = vehicleId; this.reset(); }
  start() { this.running = true; return this.emit(); }
  pause() { this.running = false; return { paused:true }; }
  reset() { this.index = 0; this.signalLost = false; this.events = []; }
  setSpeed(speed) { this.speed = speed; }
  simulateSignalLoss() { this.signalLost = true; return null; }
  simulateStopped() { this.speed = 0; return this.emit('stopped'); }
  simulateDelayed() { return this.emit('delayed'); }
  simulateIncident(type='simulated_incident') { const event = { type, vehicle_id:this.vehicleId, notice: simulationNotice }; this.events.push(event); return event; }
  emit(status='in_progress') { if (this.signalLost) return null; const truck = trucks.find((t) => t.id === this.vehicleId) ?? trucks[0]; const path = routePaths[truck.routeId] ?? [truck.position ?? [19.6489, -71.0956]]; const [latitude, longitude] = path[this.index % path.length]; this.index += 1; return { status, ...makeTelemetry({ vehicle_id:this.vehicleId, latitude, longitude, speed:this.speed }) }; }
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

export function createTelemetryIngestionAdapter(client, { municipality_id = null } = {}) {
  return {
    mode: client?.from ? 'REAL' : 'REAL_NOT_RUN',
    async ingest(position, opts = {}) {
      const validation = validateTelemetryPosition(position);
      if (!validation.valid) return { ok:false, source:this.mode, error:{ code:'INVALID_TELEMETRY', message:validation.errors.join('; ') }, correlation_id: opts.correlation_id ?? position?.correlation_id ?? null };
      if (municipality_id && position.municipality_id !== municipality_id) return { ok:false, source:this.mode, error:{ code:'CROSS_TENANT_TELEMETRY', message:'Telemetry municipality does not match active municipality.' }, correlation_id: opts.correlation_id ?? position.correlation_id ?? null };
      if (!client?.from) return { ok:false, source:'REAL_NOT_RUN', error:{ code:'SUPABASE_CLIENT_MISSING', message:'Telemetry persistence was prepared but not executed.' }, correlation_id: opts.correlation_id ?? position.correlation_id ?? null };
      const payload = { ...position, captured_at: position.captured_at ?? position.recorded_at, correlation_id: opts.correlation_id ?? position.correlation_id };
      const result = await client.from('vehicle_positions').insert(payload).select('*').single();
      if (result.error) return { ok:false, source:'REAL', error:{ code: result.error.code ?? 'SUPABASE_ERROR', message: result.error.message }, correlation_id: payload.correlation_id };
      return { ok:true, source:'REAL', data:result.data, correlation_id: payload.correlation_id };
    },
    subscribe(vehicleId, onPosition) {
      if (!client?.channel) return { status:'REALTIME_NOT_RUN', unsubscribe() {} };
      const channel = client.channel(`vehicle_positions:${vehicleId}`).on('postgres_changes', { event:'INSERT', schema:'public', table:'vehicle_positions', filter:`vehicle_id=eq.${vehicleId}` }, (payload) => onPosition(payload.new)).subscribe();
      return { status:'REALTIME_SUBSCRIBED', unsubscribe: () => channel.unsubscribe() };
    }
  };
}

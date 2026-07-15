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

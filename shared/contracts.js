export const ROUTE_STATES = ['planned','assigned','started','in_progress','delayed','completed','verified','cancelled'];
export const VEHICLE_STATES = ['active','stopped','delayed','offline','completed','maintenance'];
export const INCIDENT_STATES = ['open','triaged','assigned','in_progress','resolved','verified','cancelled'];
export const CITIZEN_REPORT_STATES = ['received','validated','linked_to_incident','in_progress','resolved','closed','rejected'];

export const ROUTE_TRANSITIONS = {
  planned: ['assigned','cancelled'], assigned: ['started','cancelled'], started: ['in_progress','delayed','cancelled'],
  in_progress: ['delayed','completed','cancelled'], delayed: ['in_progress','completed','cancelled'], completed: ['verified'], verified: [], cancelled: []
};

export function canTransitionRoute(from, to) { return Boolean(ROUTE_TRANSITIONS[from]?.includes(to)); }
export function requireMunicipality(record) { if (!record?.municipality_id) throw new Error('municipality_id is required'); return record; }

const base = { id:'uuid', municipality_id:'uuid', created_at:'timestamp', updated_at:'timestamp' };
export const contracts = {
  municipality: { id:'slug', name:'string', country:'string', status:'onboarding|active|paused|archived', created_at:'timestamp', updated_at:'timestamp' },
  vehicle: { ...base, code:'string', plate:'string', state: VEHICLE_STATES, created_by:'uuid?' },
  driver: { ...base, profile_id:'uuid?', display_name:'string', status:'available|assigned|off_duty|suspended' },
  route: { ...base, name:'string', status: ROUTE_STATES, sector_ids:'uuid[]', scheduled_start_at:'timestamp?', created_by:'uuid?' },
  route_run: { ...base, route_id:'uuid', vehicle_id:'uuid?', driver_id:'uuid?', status: ROUTE_STATES, correlation_id:'uuid' },
  vehicle_position: { ...base, vehicle_id:'uuid', latitude:'number', longitude:'number', accuracy:'number?', speed:'number?', heading:'number?', captured_at:'timestamp', received_at:'timestamp', source:'driver_app|browser|tracker|external|simulator', device_id:'string?', correlation_id:'uuid' },
  incident: { ...base, route_run_id:'uuid?', vehicle_id:'uuid?', type:'string', status: INCIDENT_STATES, priority:'low|medium|high|critical', correlation_id:'uuid' },
  citizen_report: { ...base, sector_id:'uuid?', type:'missed_pickup|illegal_dump|other', status: CITIZEN_REPORT_STATES, folio:'string', channel:'web|chatbot|whatsapp|internal', correlation_id:'uuid' }
};

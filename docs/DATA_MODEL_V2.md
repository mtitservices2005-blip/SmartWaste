# DATA MODEL V2

SmartWaste V2 is a multi-institution SaaS model. Operational tables carry `municipality_id`, timestamps, explicit state, and future audit fields. Entities: municipalities, municipality_settings, profiles, memberships, vehicles, drivers, vehicle_assignments, sectors, routes, route_stops, route_runs, vehicle_positions, incidents, citizen_reports, audit_events, integration_events.

Route states: planned, assigned, started, in_progress, delayed, completed, verified, cancelled. Allowed transitions are defined in `shared/contracts.js`; rejected transitions are any edge not listed.

Vehicle states: active, stopped, delayed, offline, completed, maintenance.

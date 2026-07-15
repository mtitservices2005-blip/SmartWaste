export const demoNotice = 'Datos demo · no producción';
export const simulationNotice = 'Simulación demo · no GPS real';

export const truckStates = ['active', 'stopped', 'delayed', 'offline', 'completed'];

export const stateLabels = {
  active: 'Activo',
  stopped: 'Detenido',
  delayed: 'Retrasado',
  offline: 'Offline',
  completed: 'Completado',
  assigned: 'Asignada',
  in_progress: 'En progreso',
  verified: 'Verificada',
  open: 'Abierta'
};

export const routeFlow = ['planned', 'assigned', 'started', 'in_progress', 'delayed', 'completed', 'verified'];

export const pilotMunicipality = {
  id: 'laguna-salada-rd',
  name: 'Laguna Salada',
  country: 'República Dominicana',
  center: [19.6489, -71.0956],
  zoom: 15,
  sectors: ['Centro urbano', 'Avenida Duarte', 'Los Maestros', 'Buenos Aires', 'Salida hacia Mao'],
  branding: {
    primary: '#0f7b4f',
    accent: '#155eef',
    label: 'Municipio piloto demo'
  },
  integrationsReady: [
    'GPS real',
    'app móvil de conductores',
    'trackers dedicados',
    'Supabase',
    'Realtime',
    'historial de posiciones',
    'geofencing',
    'optimización de rutas',
    'alertas',
    'auditoría'
  ]
};

export const municipalities = [
  { id: 'laguna-salada-rd', name: 'Ayuntamiento de Laguna Salada', plan: 'Alpha Municipal', trucks: 12, routes: 18, users: 42, status: 'Operativo demo' },
  { id: 'mun-norte', name: 'Ayuntamiento Distrito Norte', plan: 'Piloto', trucks: 5, routes: 7, users: 19, status: 'Onboarding' }
];

export const sectors = [
  { id: 'centro', name: 'Centro urbano', status: 'En servicio', covered: 8, pending: 2, pickupDay: 'Lunes y jueves' },
  { id: 'duarte', name: 'Avenida Duarte', status: 'Retraso moderado', covered: 5, pending: 4, pickupDay: 'Martes y viernes' },
  { id: 'maestros', name: 'Los Maestros', status: 'Completado', covered: 9, pending: 0, pickupDay: 'Miércoles y sábado' },
  { id: 'buenos-aires', name: 'Buenos Aires', status: 'Pendiente', covered: 0, pending: 6, pickupDay: 'Jueves' },
  { id: 'mao', name: 'Salida hacia Mao', status: 'Monitoreo', covered: 3, pending: 3, pickupDay: 'Sábado' }
];

export const drivers = [
  { id: 'drv-01', name: 'Marta Rojas', phone: 'demo-1001', status: 'Disponible' },
  { id: 'drv-02', name: 'Luis Peña', phone: 'demo-1002', status: 'En ruta' },
  { id: 'drv-03', name: 'Ana Cruz', phone: 'demo-1003', status: 'Disponible' },
  { id: 'drv-04', name: 'Carlos Mejía', phone: 'demo-1004', status: 'En pausa' }
];

export const routePaths = {
  'route-centro': [[19.6512, -71.1006], [19.6504, -71.0987], [19.6495, -71.0968], [19.6489, -71.0956], [19.6481, -71.0938], [19.6474, -71.0918]],
  'route-duarte': [[19.6532, -71.1019], [19.6522, -71.0998], [19.6509, -71.0972], [19.6497, -71.0947], [19.6484, -71.0923]],
  'route-maestros': [[19.6462, -71.0998], [19.6469, -71.0978], [19.6475, -71.0959], [19.6482, -71.0941], [19.6488, -71.0922]],
  'route-buenos-aires': [[19.6518, -71.0914], [19.6505, -71.0925], [19.6492, -71.0936], [19.6479, -71.0947], [19.6467, -71.0959]],
  'route-mao': [[19.6542, -71.1041], [19.6531, -71.1023], [19.6520, -71.1004], [19.6508, -71.0984], [19.6496, -71.0965]]
};

export const routes = [
  { id: 'route-centro', name: 'Demo Centro Urbano AM', status: 'in_progress', sectors: ['Centro urbano', 'Avenida Duarte'], sector: 'Centro urbano', truckId: 'truck-01', driverId: 'drv-02', progress: 68, scheduled: '07:00', started: '07:14', eta: '10:40', distanceKm: 5.8, estimatedMinutes: 72, stops: 12, covered: 8, pending: 4, incidents: ['INC-003'] },
  { id: 'route-duarte', name: 'Demo Duarte Comercial', status: 'delayed', sectors: ['Avenida Duarte', 'Centro urbano'], sector: 'Avenida Duarte', truckId: 'truck-02', driverId: 'drv-01', progress: 42, scheduled: '08:00', started: '08:21', eta: '11:25', distanceKm: 4.7, estimatedMinutes: 85, stops: 14, covered: 5, pending: 9, incidents: ['INC-001', 'INC-002'] },
  { id: 'route-maestros', name: 'Demo Los Maestros', status: 'completed', sectors: ['Los Maestros'], sector: 'Los Maestros', truckId: 'truck-04', driverId: 'drv-01', progress: 100, scheduled: '06:30', started: '06:34', eta: '09:55', distanceKm: 3.9, estimatedMinutes: 55, stops: 9, covered: 9, pending: 0, incidents: [] },
  { id: 'route-buenos-aires', name: 'Demo Buenos Aires PM', status: 'assigned', sectors: ['Buenos Aires'], sector: 'Buenos Aires', truckId: 'truck-03', driverId: 'drv-03', progress: 14, scheduled: '14:00', started: 'Pendiente', eta: '15:20', distanceKm: 4.2, estimatedMinutes: 63, stops: 6, covered: 1, pending: 5, incidents: ['INC-004'] },
  { id: 'route-mao', name: 'Demo salida hacia Mao', status: 'in_progress', sectors: ['Salida hacia Mao'], sector: 'Salida hacia Mao', truckId: 'truck-06', driverId: 'drv-04', progress: 54, scheduled: '09:00', started: '09:08', eta: '12:05', distanceKm: 6.1, estimatedMinutes: 91, stops: 10, covered: 5, pending: 5, incidents: ['INC-005'] }
];

export const trucks = [
  { id: 'truck-01', unit: 'SW-LS-01', name: 'Unidad Compactadora 01', plate: 'DEMO-LS-001', state: 'active', driverId: 'drv-02', routeId: 'route-centro', progress: 68, speedKmh: 18, updatedAt: 'Hace 2 min', sector: 'Centro urbano', nextStop: 'Parada demo Mercado Municipal', loadLevel: 63, positionIndex: 2 },
  { id: 'truck-02', unit: 'SW-LS-02', name: 'Unidad Compactadora 02', plate: 'DEMO-LS-002', state: 'delayed', driverId: 'drv-01', routeId: 'route-duarte', progress: 42, speedKmh: 7, updatedAt: 'Hace 5 min', sector: 'Avenida Duarte', nextStop: 'Parada demo Duarte norte', loadLevel: 78, positionIndex: 1 },
  { id: 'truck-03', unit: 'SW-LS-03', name: 'Camión volteo apoyo', plate: 'DEMO-LS-003', state: 'stopped', driverId: 'drv-03', routeId: 'route-buenos-aires', progress: 14, speedKmh: 0, updatedAt: 'Hace 8 min', sector: 'Buenos Aires', nextStop: 'Parada demo escuela', loadLevel: 25, positionIndex: 0 },
  { id: 'truck-04', unit: 'SW-LS-04', name: 'Unidad Compactadora 04', plate: 'DEMO-LS-004', state: 'completed', driverId: 'drv-01', routeId: 'route-maestros', progress: 100, speedKmh: 0, updatedAt: 'Hace 18 min', sector: 'Los Maestros', nextStop: 'Base demo', loadLevel: 12, positionIndex: 4 },
  { id: 'truck-05', unit: 'SW-LS-05', name: 'Unidad reserva', plate: 'DEMO-LS-005', state: 'offline', driverId: null, routeId: null, progress: 0, speedKmh: 0, updatedAt: 'Hace 41 min', sector: 'Base demo', nextStop: 'Sin asignar', loadLevel: 0, position: [19.6471, -71.1016] },
  { id: 'truck-06', unit: 'SW-LS-06', name: 'Unidad liviana 06', plate: 'DEMO-LS-006', state: 'active', driverId: 'drv-04', routeId: 'route-mao', progress: 54, speedKmh: 22, updatedAt: 'Hace 1 min', sector: 'Salida hacia Mao', nextStop: 'Parada demo carretera', loadLevel: 48, positionIndex: 2 }
];

export const incidents = [
  { id: 'SW-FOLIO-1001', code: 'INC-001', type: 'Calle bloqueada', sector: 'Avenida Duarte', status: 'En revisión', priority: 'Alta', position: [19.6512, -71.0984], detail: 'Obstáculo reportado en calle demo; supervisor debe validar.' },
  { id: 'SW-FOLIO-1002', code: 'INC-002', type: 'Retraso', sector: 'Avenida Duarte', status: 'Asignada a supervisor', priority: 'Media', position: [19.6500, -71.0962], detail: 'Retraso demo por congestión local.' },
  { id: 'SW-FOLIO-1003', code: 'INC-003', type: 'Zona pendiente', sector: 'Centro urbano', status: 'Abierta', priority: 'Media', position: [19.6487, -71.0944], detail: 'Punto pendiente de recolección demo.' },
  { id: 'SW-FOLIO-1004', code: 'INC-004', type: 'Vertedero improvisado', sector: 'Buenos Aires', status: 'Abierta', priority: 'Alta', position: [19.6472, -71.0955], detail: 'Acumulación demo para priorización municipal.' },
  { id: 'SW-FOLIO-1005', code: 'INC-005', type: 'Avería', sector: 'Salida hacia Mao', status: 'En revisión', priority: 'Alta', position: [19.6524, -71.1007], detail: 'Alerta demo de mantenimiento; no proviene de telemetría real.' }
];

export const notifications = [
  'Ruta Duarte Comercial presenta retraso demo por incidencia operativa.',
  'Servicio Los Maestros completado y verificado en modo demo.',
  'Aviso demo: no usar datos personales reales ni rutas oficiales.'
];

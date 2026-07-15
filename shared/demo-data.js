export const demoNotice = 'Datos demo · no producción';

export const truckStates = ['active', 'stopped', 'delayed', 'offline', 'completed'];

export const routeFlow = ['planned', 'assigned', 'started', 'in_progress', 'delayed', 'completed', 'verified'];

export const municipalities = [
  { id: 'mun-laguna', name: 'Ayuntamiento de Laguna Verde', plan: 'Alpha Municipal', trucks: 12, routes: 18, users: 42, status: 'Operativo' },
  { id: 'mun-norte', name: 'Ayuntamiento Distrito Norte', plan: 'Piloto', trucks: 5, routes: 7, users: 19, status: 'Onboarding' }
];

export const sectors = [
  { id: 'centro', name: 'Centro', status: 'En servicio', covered: 8, pending: 2, pickupDay: 'Lunes y jueves' },
  { id: 'norte', name: 'Norte', status: 'Retraso moderado', covered: 5, pending: 4, pickupDay: 'Martes y viernes' },
  { id: 'sur', name: 'Sur', status: 'Completado', covered: 9, pending: 0, pickupDay: 'Miércoles y sábado' },
  { id: 'este', name: 'Este', status: 'Pendiente', covered: 0, pending: 6, pickupDay: 'Jueves' }
];

export const drivers = [
  { id: 'drv-01', name: 'Marta Rojas', phone: 'demo-1001', status: 'Disponible' },
  { id: 'drv-02', name: 'Luis Peña', phone: 'demo-1002', status: 'En ruta' },
  { id: 'drv-03', name: 'Ana Cruz', phone: 'demo-1003', status: 'Disponible' }
];

export const trucks = [
  { id: 'truck-01', name: 'Camión 01', state: 'active', driverId: 'drv-02', routeId: 'route-centro', progress: 68, lat: 34, lng: 46, sector: 'Centro' },
  { id: 'truck-02', name: 'Camión 02', state: 'delayed', driverId: 'drv-01', routeId: 'route-norte', progress: 42, lat: 58, lng: 30, sector: 'Norte' },
  { id: 'truck-03', name: 'Camión 03', state: 'stopped', driverId: 'drv-03', routeId: 'route-este', progress: 14, lat: 74, lng: 60, sector: 'Este' },
  { id: 'truck-04', name: 'Camión 04', state: 'completed', driverId: 'drv-01', routeId: 'route-sur', progress: 100, lat: 40, lng: 76, sector: 'Sur' },
  { id: 'truck-05', name: 'Camión 05', state: 'offline', driverId: null, routeId: null, progress: 0, lat: 18, lng: 64, sector: 'Base' }
];

export const routes = [
  { id: 'route-centro', name: 'Ruta Centro AM', status: 'in_progress', sector: 'Centro', truckId: 'truck-01', driverId: 'drv-02', progress: 68, eta: '10:40', stops: 12, covered: 8, pending: 4 },
  { id: 'route-norte', name: 'Ruta Norte Comercial', status: 'delayed', sector: 'Norte', truckId: 'truck-02', driverId: 'drv-01', progress: 42, eta: '11:25', stops: 14, covered: 5, pending: 9 },
  { id: 'route-sur', name: 'Ruta Sur Residencial', status: 'verified', sector: 'Sur', truckId: 'truck-04', driverId: 'drv-01', progress: 100, eta: '09:55', stops: 9, covered: 9, pending: 0 },
  { id: 'route-este', name: 'Ruta Este PM', status: 'assigned', sector: 'Este', truckId: 'truck-03', driverId: 'drv-03', progress: 14, eta: '14:00', stops: 6, covered: 1, pending: 5 }
];

export const incidents = [
  { id: 'SW-FOLIO-1001', type: 'Basura no recogida', sector: 'Norte', status: 'En revisión', priority: 'Media' },
  { id: 'SW-FOLIO-1002', type: 'Vertedero improvisado', sector: 'Este', status: 'Asignada a supervisor', priority: 'Alta' }
];

export const notifications = [
  'Ruta Norte presenta retraso por tráfico local.',
  'Servicio Sur completado y verificado.',
  'Aviso demo: no usar datos personales reales.'
];

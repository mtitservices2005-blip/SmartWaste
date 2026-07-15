export const municipalFlow = [
  { state: 'planned', label: 'Ruta planificada', actor: 'Administrador municipal' },
  { state: 'assigned', label: 'Ruta asignada', actor: 'Supervisor' },
  { state: 'started', label: 'Conductor inicia', actor: 'Conductor' },
  { state: 'in_progress', label: 'En progreso', actor: 'Conductor' },
  { state: 'delayed', label: 'Retrasada opcional', actor: 'Supervisor' },
  { state: 'completed', label: 'Completada', actor: 'Conductor' },
  { state: 'verified', label: 'Verificada', actor: 'Supervisor' }
];

export function nextFlowState(currentState) {
  const index = municipalFlow.findIndex((step) => step.state === currentState);
  return municipalFlow[(index + 1) % municipalFlow.length].state;
}

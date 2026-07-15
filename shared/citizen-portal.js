import { incidents, sectors } from './demo-data.js';

export function createDemoFolio(sequence = 1) {
  return `SW-FOLIO-${String(3000 + sequence).padStart(4, '0')}`;
}

export function findSectorService(sectorId) {
  const sector = sectors.find((item) => item.id === sectorId);
  if (!sector) return null;
  return { sector: sector.name, pickupDay: sector.pickupDay, status: sector.status };
}

export function findIncidentStatus(folio) {
  const incident = incidents.find((item) => item.id === folio);
  return incident ? { folio: incident.id, type: incident.type, status: incident.status } : null;
}

export const chatbotReadiness = {
  intentSources: ['consulta_recoleccion', 'reporte_incidencia', 'estado_folio', 'avisos_sector'],
  privacyMode: 'demo-no-personal-data'
};

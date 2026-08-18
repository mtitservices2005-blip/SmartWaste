import { incidents, sectors } from './demo-data.js';

export function createDemoFolio(sequence = 1) {
  return `SW-FOLIO-${String(3000 + sequence).padStart(4, '0')}`;
}

// SW-039: a real report's folio must be client-generated (unlike the demo's sequential counter) —
// citizen_reports.folio is required by anon_insert_citizen_report's RLS check (4-40 chars, not
// null), and anon has no SELECT policy to read back a server-generated id, so there's nothing to
// read after the insert even if one existed. Collision risk is negligible for a municipal citizen
// portal's real traffic volume (timestamp + short random suffix), and the table's own
// unique(municipality_id, folio) constraint is the actual backstop if it ever happens.
export function generateCitizenFolio(now = Date.now()) {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SW-${now.toString(36).toUpperCase()}-${random}`;
}

// SW-039: persists a real citizen incident report (+ optional evidence file) to Supabase — the
// anonymous counterpart to shared/operations-adapter.js's dual demo/real pattern, kept as one
// focused function rather than a full adapter object since there is exactly one real write here,
// not a family of CRUD operations to abstract over.
//
// Evidence uploads before the report insert, not after: citizen_reports has no anon UPDATE policy
// (anon_insert_citizen_report only grants INSERT, by design — a citizen must not be able to alter
// their own report after submitting), so evidence_path has to be known at insert time. The folio is
// generated first specifically so the storage path can be organized by it.
//
// Must NOT chain .select() on the citizen_reports insert — PostgREST does INSERT ... RETURNING
// under the hood, and since anon has no SELECT policy on citizen_reports, the returned row isn't
// visible under the caller's own read access, which PostgREST reports as an RLS violation on the
// insert itself even though the write succeeded (confirmed in
// supabase/migrations/202607150006_sw020_rls_fixes.sql's comment and exercised for real in
// tests/rls-adversarial.test.mjs).
export async function submitCitizenReport(client, { municipality_id, sector_id, type, description, evidenceFile, channel = 'web' }) {
  if (!client?.from) return { ok: false, error: { code: 'NO_CLIENT', message: 'No hay backend real configurado.' } };
  if (!municipality_id) return { ok: false, error: { code: 'NO_MUNICIPALITY', message: 'Falta municipality_id en la configuración del portal.' } };
  const folio = generateCitizenFolio();

  let evidence_path = null;
  if (evidenceFile) {
    const path = `${municipality_id}/${folio}/${evidenceFile.name}`;
    const upload = await client.storage.from('citizen-evidence').upload(path, evidenceFile, { upsert: false });
    if (upload.error) return { ok: false, error: { code: 'EVIDENCE_UPLOAD_FAILED', message: upload.error.message } };
    evidence_path = upload.data.path;
  }

  const result = await client.from('citizen_reports').insert({
    municipality_id, sector_id: sector_id || null, folio, type, description: description || null,
    evidence_path, channel, status: 'received'
  });
  if (result.error) return { ok: false, error: { code: result.error.code ?? 'SUPABASE_ERROR', message: result.error.message } };
  return { ok: true, folio };
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

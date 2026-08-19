import assert from 'node:assert/strict';
import { createDemoFolio, findIncidentStatus, findSectorService, chatbotReadiness, generateCitizenFolio, submitCitizenReport } from '../shared/citizen-portal.js';

assert.equal(createDemoFolio(7), 'SW-FOLIO-3007');
assert.equal(findSectorService('centro').pickupDay, 'Lunes y jueves');
assert.equal(findIncidentStatus('SW-FOLIO-1001').status, 'En revisión');
assert.ok(chatbotReadiness.intentSources.includes('estado_folio'));

// SW-039: generateCitizenFolio() — real reports can't rely on a server-generated id (anon has no
// SELECT to read one back), so the client must generate one that satisfies
// anon_insert_citizen_report's RLS check (4-40 chars, not null).
const folioA = generateCitizenFolio(1723500000000);
const folioB = generateCitizenFolio(1723500000000);
assert.ok(folioA.length >= 4 && folioA.length <= 40, 'folio must fit the RLS check bounds (4-40 chars)');
assert.ok(folioA.startsWith('SW-'));
assert.notEqual(folioA, folioB, 'two folios generated in the same millisecond must still differ (random suffix)');

// submitCitizenReport(): no client / no realAdapter configured -> demo mode never calls Supabase.
const noClientResult = await submitCitizenReport(null, { municipality_id: 'muni-1', type: 'x' });
assert.equal(noClientResult.ok, false);
assert.equal(noClientResult.error.code, 'NO_CLIENT');

// No municipality_id (anonymous citizen portal has no session to derive it from, and the deployer
// didn't set SMARTWASTE_SUPABASE_CONFIG.municipality_id) -> fails before touching the network.
const fakeClientNoCalls = { from: () => { throw new Error('must not be called without municipality_id'); } };
const noMunicipalityResult = await submitCitizenReport(fakeClientNoCalls, { type: 'x' });
assert.equal(noMunicipalityResult.ok, false);
assert.equal(noMunicipalityResult.error.code, 'NO_MUNICIPALITY');

// Happy path, no evidence: inserts once, doesn't touch storage, never chains .select() on the
// insert (anon has no SELECT policy on citizen_reports — see the comment in
// supabase/migrations/202607150006_sw020_rls_fixes.sql and shared/citizen-portal.js).
let insertedPayload = null;
const happyClient = {
  from: (table) => {
    assert.equal(table, 'citizen_reports');
    return { insert: (payload) => { insertedPayload = payload; return Promise.resolve({ error: null }); } };
  },
  storage: { from: () => { throw new Error('must not touch storage without an evidence file'); } }
};
const happyResult = await submitCitizenReport(happyClient, { municipality_id: 'muni-1', type: 'Basura no recogida', description: 'desc' });
assert.equal(happyResult.ok, true);
assert.ok(happyResult.folio.startsWith('SW-'));
assert.equal(insertedPayload.municipality_id, 'muni-1');
assert.equal(insertedPayload.status, 'received');
assert.equal(insertedPayload.channel, 'web');
assert.equal(insertedPayload.evidence_path, null);
assert.equal(insertedPayload.sector_id, null);
assert.equal(insertedPayload.folio, happyResult.folio);

// With evidence: uploads first (path organized by municipality/folio, matching the storage RLS
// policies' storage.foldername(name) check), then inserts evidence_path alongside the report.
let uploadedPath = null;
const evidenceClient = {
  from: () => ({ insert: (payload) => { insertedPayload = payload; return Promise.resolve({ error: null }); } }),
  storage: { from: (bucket) => { assert.equal(bucket, 'citizen-evidence'); return { upload: (path) => { uploadedPath = path; return Promise.resolve({ data: { path }, error: null }); } }; } }
};
const evidenceResult = await submitCitizenReport(evidenceClient, { municipality_id: 'muni-1', type: 'x', evidenceFile: { name: 'foto.jpg' } });
assert.equal(evidenceResult.ok, true);
assert.ok(uploadedPath.startsWith(`muni-1/${evidenceResult.folio}/`), 'evidence path must be organized by municipality_id/folio for the storage RLS folder-prefix check');
assert.equal(insertedPayload.evidence_path, uploadedPath);

// Upload failure must not fall through to an insert with a stale/wrong evidence_path.
const failingUploadClient = {
  from: () => { throw new Error('must not insert the report if evidence upload failed'); },
  storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: 'network error' } }) }) }
};
const failedEvidenceResult = await submitCitizenReport(failingUploadClient, { municipality_id: 'muni-1', type: 'x', evidenceFile: { name: 'foto.jpg' } });
assert.equal(failedEvidenceResult.ok, false);
assert.equal(failedEvidenceResult.error.code, 'EVIDENCE_UPLOAD_FAILED');

// Insert failure (e.g. RLS rejection) is surfaced, not swallowed.
const rejectedClient = { from: () => ({ insert: () => Promise.resolve({ error: { code: 'PGRST_TEST', message: 'rejected' } }) }) };
const rejectedResult = await submitCitizenReport(rejectedClient, { municipality_id: 'muni-1', type: 'x' });
assert.equal(rejectedResult.ok, false);
assert.equal(rejectedResult.error.code, 'PGRST_TEST');

console.log('citizen-portal ok');

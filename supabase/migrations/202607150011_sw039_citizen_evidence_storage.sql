-- SW-039: real evidence upload for citizen incident reports. Before this, shared/channel-
-- contracts.js's validateEvidenceFile() only ever validated a file for local preview
-- ("accepted_for_local_preview_only") — nothing persisted it (docs/TECHNICAL_DEBT_REGISTER.md,
-- "sin upload real" in the component classification). This creates a private storage bucket and
-- the RLS policies that let an anonymous citizen upload evidence for their own report, and let
-- municipal staff read it back, mirroring the exact scoping already used for citizen_reports
-- itself (see 202607150006_sw020_rls_fixes.sql's anon_insert_citizen_report and
-- municipality_is_onboarded()).
--
-- Objects are stored at `{municipality_id}/{folio}/{filename}` — the municipality_id folder
-- prefix is what both RLS policies below check against, via storage.foldername(name), the same
-- technique Supabase's own docs use for per-tenant storage scoping.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'citizen-evidence',
  'citizen-evidence',
  false,
  5242880, -- 5 MB, matches shared/channel-contracts.js's validateEvidenceFile() maxBytes
  array['image/jpeg','image/png','image/webp','application/pdf'] -- matches validateEvidenceFile()'s allowed list
)
on conflict (id) do nothing;

-- Anonymous citizens upload their own report's evidence, scoped to an onboarded municipality —
-- same anti-abuse posture as anon_insert_citizen_report (no self-resolve, bounded, tenant-checked
-- via the security-definer function since anon has no SELECT on municipalities).
drop policy if exists anon_insert_citizen_evidence on storage.objects;
create policy anon_insert_citizen_evidence on storage.objects for insert
  to anon
  with check (
    bucket_id = 'citizen-evidence'
    and municipality_is_onboarded(((storage.foldername(name))[1])::uuid)
  );

-- Municipal staff (not drivers — evidence review is a supervisor/dispatcher/admin function, same
-- role set citizen_reports' own tenant_insert_staff policy uses) can read evidence for their
-- municipality. No anon SELECT, matching citizen_reports itself: the citizen isn't expected to
-- read their own upload back, only staff reviewing the report.
drop policy if exists staff_read_citizen_evidence on storage.objects;
create policy staff_read_citizen_evidence on storage.objects for select
  to authenticated
  using (
    bucket_id = 'citizen-evidence'
    and has_municipality_role(((storage.foldername(name))[1])::uuid, array['municipal_admin','supervisor','dispatcher'])
  );

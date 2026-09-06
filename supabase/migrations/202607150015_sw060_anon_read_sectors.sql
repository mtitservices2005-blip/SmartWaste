-- SW-060: real sectors for the citizen portal form. Before this, an anonymous citizen report
-- (submitCitizenReport(), shared/citizen-portal.js) always sent sector_id: null, because the
-- <select> in the citizen portal form only ever offered the hardcoded demo sectors from
-- shared/demo-data.js — those ids don't exist as real rows in Supabase, so sending one would
-- violate citizen_reports.sector_id's foreign key. Reading real sectors requires its own anon
-- SELECT policy: `sectors` only carries tenant_read (has_municipality_role(municipality_id)) from
-- 202607150004_sw014_auth_rls_policies.sql, and anon has no membership row, so anon could not read
-- a single real sector before this migration.
--
-- Reuses municipality_is_onboarded() (202607150006_sw020_rls_fixes.sql) rather than a new
-- function — same anti-abuse posture as anon_insert_citizen_report: bounded to a municipality
-- that's actually active/onboarding, not a blanket grant across every municipality on the
-- platform. Also bounded to status = 'active' — an anonymous citizen has no legitimate reason to
-- see a sector a municipality has since deactivated.
drop policy if exists anon_read_sectors on sectors;
create policy anon_read_sectors on sectors for select
  to anon
  using (
    status = 'active'
    and municipality_is_onboarded(sectors.municipality_id)
  );

-- Codex review (PR #77, P1): anon_read_sectors above lets an anonymous caller enumerate sector ids
-- across every onboarded municipality, not just the one they happen to be reporting for. Without
-- this, nothing stopped an anon insert into citizen_reports for municipality A carrying a
-- sector_id that actually belongs to municipality B — citizen_reports.sector_id's FK only checks
-- that the row exists, and anon_insert_citizen_report (202607150006_sw020_rls_fixes.sql) only ever
-- checked that the report's own municipality_id is onboarded, never that sector_id's municipality
-- matches it. Redefines the policy (rather than editing the already-shipped migration that first
-- created it — CLAUDE.md rule against rewriting shipped migrations) to add that same-tenant check.
drop policy if exists anon_insert_citizen_report on citizen_reports;
create policy anon_insert_citizen_report on citizen_reports for insert
  to anon
  with check (
    status = 'received'
    and channel in ('web', 'chatbot', 'whatsapp')
    and folio is not null and char_length(folio) between 4 and 40
    and (description is null or char_length(description) <= 2000)
    and municipality_is_onboarded(citizen_reports.municipality_id)
    and (
      sector_id is null
      or exists (
        select 1 from sectors s
        where s.id = citizen_reports.sector_id
          and s.municipality_id = citizen_reports.municipality_id
      )
    )
  );

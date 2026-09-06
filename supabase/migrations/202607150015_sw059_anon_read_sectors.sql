-- SW-059: real sectors for the citizen portal form. Before this, an anonymous citizen report
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

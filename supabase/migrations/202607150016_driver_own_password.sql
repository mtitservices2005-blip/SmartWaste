-- Existing driver access accounts were provisioned with a temporary password before the marker
-- existed. Backfill only profiles linked to a drivers row and an active driver membership; future
-- accounts receive the same marker directly in create-driver-account.
update auth.users as auth_user
set raw_user_meta_data = coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('requires_password_change', true)
where exists (
  select 1
  from public.drivers driver
  join public.memberships membership
    on membership.profile_id = driver.profile_id
   and membership.role = 'driver'
   and membership.status = 'active'
  where driver.profile_id = auth_user.id
);

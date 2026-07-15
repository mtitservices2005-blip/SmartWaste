# RLS security plan

RLS is prepared as local SQL documentation only. Do not apply remotely without review. Policies should: map `auth.uid()` to `memberships`, restrict municipal roles to matching `municipality_id`, allow `mt_superadmin` platform reads through an approved claim or membership, and deny anonymous operational writes. Service role must never be exposed to frontend.

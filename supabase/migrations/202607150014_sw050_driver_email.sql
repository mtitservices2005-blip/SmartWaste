-- SW-050: drivers.email was never persisted anywhere in Supabase — the "Crear cuenta de acceso"
-- button (frontend/app.js's renderDriverList()/createDriverAccount()) only ever read it off the
-- browser tab's in-memory driver object, set once from the "Flota y personal" form. If the
-- dispatcher didn't click that button in the SAME page session (reload, closed tab, came back
-- hours later), the email was gone for good with no way to recover or even re-enter it — found via
-- a real dispatcher getting stuck exactly like this in staging. Nullable, no backfill needed:
-- existing drivers rows genuinely have no known email to fill in.
alter table drivers add column if not exists email text;

# Activation Checklist SW-017

1. Install Docker and Supabase CLI locally.
2. Run `supabase start` and `supabase db reset` against local only.
3. Seed two municipalities, profiles, memberships, vehicles, drivers, sectors and routes.
4. Execute positive and adversarial RLS tests for all roles.
5. Run operations flow from create vehicle through route verification.
6. Run simulator telemetry into `vehicle_positions` and verify history/latest position.
7. Verify Supabase Realtime updates the existing operational map without duplicate markers.
8. Run all Node tests and JSON/syntax checks.
9. Only after local verification, plan reviewed remote migration; do not use `supabase db push` blindly.

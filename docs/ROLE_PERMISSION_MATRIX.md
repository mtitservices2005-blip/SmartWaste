# Role and permission matrix

| Role | Scope | Key permissions |
| --- | --- | --- |
| mt_superadmin | Platform | supervise client municipalities, onboarding, platform health, support |
| municipal_admin | One municipality | vehicles, routes, users, settings, reports |
| supervisor | One municipality | supervise operation, verify routes, manage incidents |
| dispatcher | One municipality | assign vehicles, drivers, routes; create incidents |
| driver | Authorized own operation | view route, start route, update progress, report incidents |

Security must be enforced by backend/RLS with `municipality_id`; frontend filters are demo UX only by default. `frontend/auth-gate.js` adds an opt-in real login + role gate backed by `resolveSupabaseAuthContext()` (see `docs/FRONTEND_LOGIN_SETUP.md`) — but it activates only when explicitly configured, and RLS remains the actual security boundary either way.

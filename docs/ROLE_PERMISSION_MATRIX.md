# Role and permission matrix

| Role | Scope | Key permissions |
| --- | --- | --- |
| mt_superadmin | Platform | supervise client municipalities, onboarding, platform health, support |
| municipal_admin | One municipality | vehicles, routes, users, settings, reports |
| supervisor | One municipality | supervise operation, verify routes, manage incidents |
| dispatcher | One municipality | assign vehicles, drivers, routes; create incidents |
| driver | Authorized own operation | dedicated route workspace only: view/start/complete assigned route and share GPS |

Security must be enforced by backend/RLS with `municipality_id`; frontend filters are demo UX only by default. `frontend/auth-gate.js` adds an opt-in real login + role gate backed by `resolveSupabaseAuthContext()` (see `docs/FRONTEND_LOGIN_SETUP.md`) — but it activates only when explicitly configured, and RLS remains the actual security boundary either way.

When the real login gate is active, an authenticated driver only sees `#conductor` plus the global
logout action. The public citizen portal remains available without login, but it is not shown as a
driver work menu. Administrative summaries and operation subviews are not exposed to that role.

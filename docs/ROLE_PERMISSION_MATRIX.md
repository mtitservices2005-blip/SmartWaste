# Role and permission matrix

| Role | Scope | Key permissions |
| --- | --- | --- |
| mt_superadmin | Platform | supervise client municipalities, onboarding, platform health, support |
| municipal_admin | One municipality | vehicles, routes, users, settings, reports |
| supervisor | One municipality | supervise operation, verify routes, manage incidents |
| dispatcher | One municipality | assign vehicles, drivers, routes; create incidents |
| driver | Authorized own operation | view route, start route, update progress, report incidents |

Security must be enforced by backend/RLS with `municipality_id`; frontend filters are demo UX only.

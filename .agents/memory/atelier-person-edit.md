---
name: Roster person edit surface
description: Invariants of the full Edit Person PATCH and its UI form
---
- PATCH /roster/people/:id is the full-profile edit surface: per-worker-type zod whitelists, hr/partner/founding_partner gate, title still hr/founding_partner-only, 422 field-locked for pay/bank/lifecycle + employee RBAC role (PFR free-text role IS editable).
- **Why:** pay/bank live on finance flows; employee `role` is access-managed; mixing them here would bypass their approval gates.
- **How to apply:** any new editable person field goes into the right schema in rosterRoutes.ts AND the openapi AtelierRosterPersonEdit schema; syncing employee identity to atelierUsers must write `name` (users table has no fullName column).
- UI form (EditPersonForm.tsx) sends dirty fields only; personalEmail prefetches from the /personal endpoint (same viewer set as editors); partner-firm dropdown uses GET /roster/partner-firms.

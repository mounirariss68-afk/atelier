---
name: Atelier roster visibility scoping
description: Who sees which people data; dual audit routes; me-lens interactions
---

Roster gates (server role predicates are the source of truth, mirrored in DB guard functions and the frontend perms helper):
- SENSITIVE_PEOPLE (personal data, person docs, HR notes, demographics, compliance registers, per-person audit): founding_partner | hr (+self on personal/docs).
- COMP (IBAN/day-rate/base comp): founding_partner | hr | finance.
- ENGAGEMENT_COSTING (rate-card internal cost, deal-pricing cost/margin, change-order deltas, PnL): fp | partner | finance | hr.
- People edits: founding_partner | hr only (`canEditPeople`); partners lost edit surfaces.
- Managers (BFS over ALL reports_to edges, org-scoped, cycle-safe) get business-only wires of their tree; other internal roles get an empty "reports" scope; employee/contractor personas 403 before this (Me-lens lock).

**Why:** partners must not see personal/comp data; finance must not see personal data; deal economics stay partner-visible.

**How to apply / gotchas:**
- The per-person audit path is registered TWICE: the audit-pack PDF handler mounts BEFORE the roster JSON route and wins every match — any gate change must be made in BOTH places.
- Per-person data leaks through SIDE CHANNELS outside the roster router (skills graph, timesheet summaries). Any new per-person read route must call the shared roster-scope predicate exported from the roster router, not just a role check like canApproveLead.
- List/detail roster GETs are raw fetch on the frontend (not in openapi); viewer-scope flags ride in the response body.
- Finance is a full-roster viewer but sensitive fields are stripped in-route (notes/gender/nationality).
- Destructive roster flows must scope the first lookup and every linked-user mutation to the actor's org, then verify the roster row was affected before revoking credentials, sessions, grants, or tokens. Reject unsupported worker types explicitly.
- Linked identity enrichment must validate both the linked id and org before attaching structured names. Personal-document reads must likewise match org + worker type + roster id, never logical ids alone.

**Why:** A role gate alone does not prevent a caller from supplying another tenant's roster ID; an unscoped lookup can turn a zero-row roster update into cross-tenant account revocation.

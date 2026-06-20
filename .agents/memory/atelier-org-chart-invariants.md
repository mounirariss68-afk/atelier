---
name: Atelier org chart (reports_to) invariants
description: Non-obvious constraints for contact relationship / org-chart code in the Atelier account system.
---

# Atelier reports_to org-chart invariants

- **reports_to has NO DB uniqueness on (fromContactId, type).** A contact can hold
  multiple live `reports_to` edges (multiple managers). Any cycle-detection or
  tree-walk over the org chart MUST traverse every reachable manager (BFS/DFS over
  an adjacency map), never `edges.find(first match)` — single-path walks miss real
  cycles under multi-parent data and can also infinite-loop the frontend tree render.
  **Where it applies:** `accountRoutes.ts` `wouldCreateReportsCycle`, and the
  `contact_relationship_create` capability in `coverage-capabilities.ts` (keep both
  in sync).

- **The app is multi-tenant by `orgId`** (default `"aico"`). Any lookup of
  `atelierUsers` for display (e.g. contact owner name) must be scoped by the
  account/contact `orgId`, and any user id accepted from a write (`contactOwnerId`)
  must be validated against the same org — otherwise a caller can store a foreign id
  and read back a cross-org user's name.
  **Why:** caught in code review; unscoped owner-name resolution was a tenant
  isolation leak.

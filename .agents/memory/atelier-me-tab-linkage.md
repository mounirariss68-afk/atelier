---
name: Me-tab data linkage split
description: Which id links each self-scope Me data surface (roster person id vs user id)
---
Self-scope Me-lens data reads link by TWO different ids:

- **Roster person id** (`emp_*` / `ct_*`, via `resolveSelfPerson`): timesheet weeks/entries (`personId`), person skills (`personType`+`personId`).
- **User id** (`atelier_users.id`): expenses (`atelierExpenses.personId` is the SUBMITTER's user id, despite the name) and payments (`atelierContractorPayments.payeeUserId` — also used for employee pay runs, not just contractors).

**Why:** mixing them up silently returns empty (or someone else's) rows; `personId` naming is inconsistent across tables.

**How to apply:** any new `/me/*` read/write must pick the right key per table; personas without a roster record get empty lists, never errors. Contractor pay shows `dayRateAmount`, never `dayRateInternalCost` (firm-side margin figure).

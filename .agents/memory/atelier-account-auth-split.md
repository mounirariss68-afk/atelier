---
name: Atelier account-scope auth split
description: Read gate vs financial gate convention for account-scope endpoints (workspace, account-360, plan PDF)
---

# Atelier account-scope auth split

For account-scope endpoints (workspace view, account-360, account-plan/QBR PDF),
keep two distinct gates:

1. **Read gate** = `canSeeAccount(access, me, accountId)` — firm-wide (`access.all`),
   a holder of an engagement grant on the account, OR the account `partnerOwnerId`.
   This is the SINGLE shared read gate; reuse the exported helper from
   `accountRoutes.ts` rather than re-deriving role lists, to avoid policy drift.
2. **Financial gate** = account-WIDE authority only: `access.all || partnerOwnerId === me.id`,
   AND not restricted/board persona. Used for AR/pipeline/P&L rollups.

**Why:** A scoped consultant with one engagement grant must be able to *read* the
account (and export its plan PDF) at parity with the workspace, but must NOT see
account-wide financial totals for engagements they aren't authorized to view.
Gating the whole route to account-wide authority is the wrong, over-restrictive
default (it was the Task #571 PDF bug).

**How to apply:** New account-scope read endpoints → gate the route with
`canSeeAccount`; gate any financial section separately with the account-wide +
not-restricted/board check. Write/mutation endpoints use `canManageAccountPlan`
(partner-tier + account team/AM + owner), not the read gate.

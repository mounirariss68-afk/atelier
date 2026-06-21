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
default — it was the original account-plan PDF bug (the route hard-blocked
non-account-wide readers who could already see the account in the workspace).

**How to apply:** New account-scope read endpoints → gate the route with
`canSeeAccount`; gate any financial section separately with the account-wide +
not-restricted/board check. Write/mutation endpoints use `canManageAccountPlan`
(partner-tier + account team/AM + owner), not the read gate.

## Boundary makes the financial gate's restricted/board terms uneven to test

The financial gate's `!isRestrictedPersona && !isBoardObserver` terms behave very
differently over HTTP because of the central non-employee boundary middleware in
`routes/atelier/index.ts`:

- **Restricted personas** (contractor / partner_firm_resource / recruiter) are
  rejected by that boundary BEFORE any `/accounts/*` handler (incl. `plan.pdf`)
  runs — they may only hit engagement-scoped routes. So the in-handler
  `!isRestrictedPersona` term is unreachable defense-in-depth: a restricted
  persona can never produce a 200 brief, only a 403. Test it as a 403 (no brief
  = strictly stronger than redaction), not as a redacted PDF.
- **Board observers** are NOT on that boundary, so they DO reach the handler;
  `attachRls` only sets a deny sentinel and calls `next()` (never 403s), and the
  PDF handler reads the global `db`, so RLS doesn't block it. To make
  `isBoardObserver` the *deciding* factor in `canSeeFinancials` (not `accountWide`),
  give the observer account-wide authority by making it the account
  `partnerOwnerId` — then the brief renders 200 but redacts the financial block.

**Why:** Writing "restricted persona exports a redacted PDF" tests will fail — the
route is unreachable for them. Seed has no board_observer user, so board tests
must create one (cleanup the user + owned account).

# Executive Assistant delegation — design note (Task #386)

## Patterns researched
Established "act on behalf of" patterns in HR / professional-services tools
(Workday delegations, SAP Concur delegates, ADP proxies, Salesforce "login as"
alternatives) converge on a small set of principles, which we adopt:

1. **Explicit, scoped grants — never session impersonation.** The principal
   (partner) creates a grant naming the delegate (EA) and the exact task
   areas delegated. The delegate stays signed in as *themself*; the server
   resolves the acting-for target per request. We follow the existing
   self-scope resolution pattern (`resolveSelfPerson` / `resolvePersonForCaller`)
   rather than swapping identities.
2. **Persistent acting-as banner.** Any screen where the delegate operates in
   the principal's context shows a clearly-labeled "Acting for [Partner]"
   banner so entries are never made in the wrong context by accident.
3. **Dual attribution in the audit trail.** Every delegated action records
   both parties ("by EA X on behalf of Partner Y") — the actor is the EA,
   the on-behalf-of principal rides in the payload and summary.
4. **Principal review before the normal ladder.** Delegate-entered items are
   *proposals*: they sit in a "pending partner review" state and only enter
   the normal downstream approval ladder after the partner approves.
   Rejection carries a reason and loops back to the delegate for edit +
   resubmit (Concur's "delegate prepares, employee submits" model).
5. **Least-privilege data visibility.** Delegates see only what data entry
   requires: no day rates, compensation, costing, HR fields, and no access
   to the principal's own approval queues or CRM/financial authority.
6. **Revocation & offboarding semantics.** Grants are revocable at any time
   by the principal, and *automatically revoked* when either party is
   deactivated on the roster (leaver flow) — dangling delegations are a
   classic audit finding.
7. **Idempotent approval.** Approving twice (double-click, retry) must apply
   the item exactly once; the applied artifact reference is stored on the
   pending item.

## Data model
- `atelier_employees.is_executive_assistant` / `atelier_contractors.is_executive_assistant`
  — EA designation on the roster (EA can be a full-time employee or a
  fractional contractor; fractional EAs keep the normal contractor weekly
  timesheet obligation for their own hours).
- `atelier_ea_delegations` — grant rows: partnerUserId ↔ eaUserId,
  `scopes` (subset of `timesheets | expenses | meetings_tasks`),
  `status` active|revoked (+ who/when/why). Many-to-many by construction.
- `atelier_ea_pending_items` — delegated entries awaiting partner review:
  `kind` (timesheet_entry | expense | meeting_task), the proposed `payload`,
  `status` pending|approved|rejected, rejection reason, and `appliedRef`
  (the id of the artifact created at approval — the idempotency token).

## Enforcement surfaces
- All EA delegate routes live under `/me/assist/*`; partner review routes
  under `/me/delegates/*`. Both are self-scope (`/me/*`), so the existing
  employee/contractor route boundary already confines EA personas — and the
  same boundary blocks EAs from the chat/CLI surface (`/cli/*` 403s for
  employee/contractor roles), so an EA cannot do via chat what the UI blocks.
- Scope checks run server-side on every delegated read/write: the grant must
  be `active` AND carry the relevant scope.
- Delegated reads strip monetary/HR fields (the acting-for timesheet view
  returns only entries/hours; no rates, no comp, no approval queues).
- Receipts uploaded by an EA are stored in private object storage owned by
  the EA; a dedicated download route additionally admits the partner and HR
  (and no one else).

## Approval application semantics
- **Timesheet entry** → approved items are inserted into the partner's week
  (`ensureWeekShell` + entry insert + `recomputeWeekTotals`), then follow the
  normal draft → submit → lead/partner ladder under the partner's control.
- **Expense** → approved items create the expense row (status `draft`,
  attributed to the partner as owner, EA as creator) so the partner runs the
  normal policy-checked submit; the EA's receipt rides along.
- **Meeting/task** → approved items drop a self-notification card on the
  partner's Me home (in-app first; real Graph calendar delegation is out of
  scope — the per-user MS365 connection is OAuth-scoped to the signed-in
  user, so sending invites from the partner's calendar would require new
  admin-consented delegated permissions; noted as a possible follow-up).

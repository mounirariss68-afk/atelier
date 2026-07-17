---
name: Me-lens self-service policy quirks
description: Non-obvious rules in the /me timesheet/leave/expense self-service stack
---
- Expense claims store personId = atelier_users id (wallet convention); timesheets/leave use the roster person id. Don't mix them.
- evaluateExpense reads atelier_expense_policies rows from the DB — a fresh/prod DB with no policy rows evaluates everything green. Tests must insert an ephemeral policy row for a unique category.
- Wallet approve: firm-overhead claims (no engagementId) get 403 `lead-cannot-approve-firm-overhead` for lead-tier approvers by design; partner/ops/finance must approve.
- Reimburse endpoint is idempotent: repeat call returns 200 `{alreadyReimbursed:true}`, not 409.
- "lead" is NOT a valid role; lead-tier approvers are founding_partner/partner/senior_manager/finance (LEAD_APPROVERS in personaRoles.ts).
- The ledger Timesheet.tsx grid is reused by the Me lens via props (apiBase/engagementsUrl/eyebrow); self personas fetch engagement options from /me/expense-contexts since /engagements is 403 for them.
- Leave approvals route via reports_to edges (multi-manager); with NO edge the deciders are HR/founding_partner/partner fallback only — senior_manager is NOT a fallback decider and gets 403 not-your-report.
- Entitlement precedence: person > employment-type default (atelier_leave_type_entitlements, keyed FTE/fixed_term/intern/contractor) > hardcoded default; contractors resolve to type "contractor".
- /me/timesheets/current carries an approvedLeave overlay (me-lens only, absent on ledger surface) so timesheet and leave views can't disagree.

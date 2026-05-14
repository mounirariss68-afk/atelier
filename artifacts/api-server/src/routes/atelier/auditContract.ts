/**
 * Task #261 — Atelier v3 Audit Contract Registry.
 *
 * Centralizes the action-key strings written to atelier_audit_events so we
 * can grep, lint, and back-fill them. Action keys follow `<domain>.<noun>.<verb>`
 * with a small set of historic exceptions kept intact for backwards-compat
 * (`expense.create`, `ledger.draft`, `invitation.sent`, etc.).
 *
 * Contract: every Roster / Ledger / Wallet mutation MUST write a row whose
 * `action` is in V3_AUDIT_ACTIONS. Compensation-field reads/writes MUST also
 * write `policy.read.restricted`.
 */
export const V3_AUDIT_ACTIONS = {
  // Roster ----------------------------------------------------------------
  ROSTER_PERSON_CREATED: "roster.person.created",
  ROSTER_PERSON_UPDATED: "roster.person.updated",
  ROSTER_INVITATION_SENT: "invitation.sent",
  ROSTER_ONBOARDING_CREATED: "onboarding.created",
  ROSTER_ONBOARDING_STEP_DONE: "onboarding.step.done",
  ROSTER_ONBOARDING_STEP_BLOCKED: "onboarding.step.blocked",
  ROSTER_ONBOARDING_STEP_PENDING: "onboarding.step.pending",
  ROSTER_ONBOARDING_COMPLETED: "onboarding.completed",
  ROSTER_OFFBOARDING_CREATED: "offboarding.created",
  ROSTER_OFFBOARDING_INITIATED: "offboarding.initiated",
  ROSTER_OFFBOARDING_STEP_DONE: "offboarding.step.done",
  ROSTER_OFFBOARDING_REVOKE: "offboarding.revoke.atelier_access",
  ROSTER_COMPLIANCE_EXPIRATION: "compliance.expiration.detected",
  ROSTER_CONFLICT_RAISED: "conflict.raised",
  ROSTER_CONFLICT_OVERRIDDEN: "conflict.overridden",

  // Ledger (timesheets) ---------------------------------------------------
  LEDGER_DRAFT: "ledger.draft",
  LEDGER_SUBMIT: "ledger.submit",
  LEDGER_APPROVE: "ledger.approve",
  LEDGER_REJECT: "ledger.reject",
  LEDGER_NUDGE_SUBMIT: "ledger.nudge.submit_due",
  LEDGER_NUDGE_APPROVE: "ledger.nudge.approve_due",
  LEDGER_BURN_THRESHOLD: "ledger.burn.threshold_crossed",

  // Wallet (expenses + payments) ------------------------------------------
  EXPENSE_CREATE: "expense.create",
  EXPENSE_AUDIT: "expense.audit",
  EXPENSE_SUBMIT: "expense.submit",
  EXPENSE_APPROVE: "expense.approve",
  EXPENSE_REJECT: "expense.reject",
  EXPENSE_POLICY_RED: "expense.policy.red",
  CONTRACTOR_PAYMENT_PROPOSED: "wallet.contractor_payment.proposed",
  CONTRACTOR_PAYMENT_APPROVED: "wallet.contractor_payment.approved",
  CONTRACTOR_PAYMENT_REJECTED: "wallet.contractor_payment.rejected",
  PARTNER_FIRM_INVOICE_PROPOSED: "wallet.partner_firm_invoice.proposed",
  PARTNER_FIRM_INVOICE_APPROVED: "wallet.partner_firm_invoice.approved",
  PARTNER_FIRM_INVOICE_REJECTED: "wallet.partner_firm_invoice.rejected",
  INVOICE_DRAFT_GENERATED: "wallet.invoice_draft.generated",
  PUBLISH_SENTINEL_BLOCK: "wallet.publish_sentinel.block",

  // Compensation column policy lock --------------------------------------
  POLICY_READ_RESTRICTED: "policy.read.restricted",

  // Principle override (breakglass) — Task #293 -------------------------
  PRINCIPLE_OVERRIDE_GRANTED: "principle_override.granted",

  // Atelier CLI — Task #331 --------------------------------------------
  CLI_TURN: "cli.turn",
  CLI_TURN_CONFIRMED: "cli.turn.confirmed",
  CLI_TURN_CANCELLED: "cli.turn.cancelled",
} as const;

export type V3AuditAction = (typeof V3_AUDIT_ACTIONS)[keyof typeof V3_AUDIT_ACTIONS];

const ALL_ACTIONS: ReadonlySet<string> = new Set(Object.values(V3_AUDIT_ACTIONS));

/**
 * Registry assertion: in non-prod (dev/test), throws if an action key is
 * not registered so a forgotten registration fails CI/the running test
 * suite. In production, downgrades to a warn so a regression never 5xx's
 * a customer mutation. Routes call this from their central `audit()`
 * helper.
 *
 * Historic action keys not yet folded into V3_AUDIT_ACTIONS are tolerated
 * (`expense.submit.blocked`, `*.read.*`) via the prefix allowlist below.
 */
const TOLERATED_PREFIXES = [
  "expense.submit.",
  "ledger.steward.",
  "wallet.",
  "compliance.",
  "skill.",
  "engagement.",
  "deliverable.",
  "raid.",
  "process.",
  "agent_design.",
  "session.",
  "asset.",
  "prompt.",
  "agent.",
  "knowledge.",
  "person.",
  "policy.",
  "conflict.",
  "invitation.",
  "onboarding.",
  "offboarding.",
  "wallet_policy.",
  "deal_pricing.",
  "rate_card.",
  "margin_policy.",
  "win_loss.",
  "forecast.",
  "report.",
  "proposal.",
  "access.",
  "document.",
  "person_document.",
];

export function assertAuditAction(action: string): void {
  if (ALL_ACTIONS.has(action)) return;
  if (TOLERATED_PREFIXES.some((p) => action.startsWith(p))) return;
  const msg = `[audit-contract] unregistered action "${action}" — add to V3_AUDIT_ACTIONS`;
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.warn(msg);
    return;
  }
  throw new Error(msg);
}

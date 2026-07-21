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
  // Microsoft 365 connection (Task #327) ----------------------------------
  MS_CONNECTION_CONNECTED: "ms.connection.connected",
  MS_CONNECTION_DISCONNECTED: "ms.connection.disconnected",
  // Microsoft 365 meeting auto-log (Task #336) ----------------------------
  MS_MEETING_AUTOLOGGED: "ms.meeting.autologged",
  MS_MEETING_AUTOLOG_REMOVED: "ms.meeting.autolog_removed",
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

  // Me lens self-service — Task #53 ---------------------------------------
  LEAVE_REQUEST: "leave.request",
  LEAVE_APPROVE: "leave.approve",
  LEAVE_REJECT: "leave.reject",
  LEAVE_CANCEL: "leave.cancel",
  LEAVE_ENTITLEMENT_SET: "leave.entitlement.set",
  ROSTER_REPORTS_TO_SET: "roster.reports_to.set",
  EXPENSE_REIMBURSE: "expense.reimburse",

  // Compensation column policy lock --------------------------------------
  POLICY_READ_RESTRICTED: "policy.read.restricted",

  // CLI attachments — Task #334 -----------------------------------------
  CLI_ATTACHMENT_UPLOAD: "cli_attachment.upload",
  CLI_ATTACHMENT_REJECT: "cli_attachment.reject",
  CLI_ATTACHMENT_EXTRACT: "cli_attachment.extract",
  CLI_OPPORTUNITY_QUALIFY_RUBRIC: "opportunity.qualify_rubric",

  // Principle override (breakglass) — Task #293 -------------------------
  PRINCIPLE_OVERRIDE_GRANTED: "principle_override.granted",

  // L2C Wave 3 — Task #362 (invoicing, e-invoicing, AR, collections) ----
  INVOICE_DRAFTED: "wallet.invoice.drafted",
  INVOICE_LINE_ADDED: "wallet.invoice.line_added",
  INVOICE_ISSUED: "wallet.invoice.issued",
  INVOICE_VOIDED: "wallet.invoice.voided",
  INVOICE_PAYMENT_RECORDED: "wallet.invoice.payment_recorded",
  EINVOICE_SUBMITTED: "einvoice.submitted",
  EINVOICE_CLEARED: "einvoice.cleared",
  EINVOICE_REJECTED: "einvoice.rejected",
  DUNNING_NOTICE_SENT: "dunning.notice.sent",
  DUNNING_PROMISE_RECORDED: "dunning.promise.recorded",
  DUNNING_PROMISE_KEPT: "dunning.promise.kept",
  DUNNING_PROMISE_BROKEN: "dunning.promise.broken",

  // Atelier CLI — Task #331 --------------------------------------------
  CLI_TURN: "cli.turn",
  CLI_TURN_CONFIRMED: "cli.turn.confirmed",
  CLI_TURN_CANCELLED: "cli.turn.cancelled",
  // Task #335 — feedback + undo audit actions.
  CLI_FEEDBACK: "cli.feedback",
  CLI_UNDO: "cli.undo",
  // Task #485 — manual chat rename (auto-title only fires on title IS NULL).
  CLI_SESSION_RENAMED: "cli.session.renamed",
  // Task #490 — user-initiated soft-delete of a chat session.
  CLI_SESSION_DELETED: "cli.session.deleted",

  // EA delegation — Task #386 (partner ↔ Executive Assistant grants +
  // delegated pending items; every row carries dual attribution:
  // actor = the person acting, payload.onBehalfOf = the principal).
  EA_DELEGATION_CREATED: "ea.delegation.created",
  EA_DELEGATION_UPDATED: "ea.delegation.updated",
  EA_DELEGATION_REVOKED: "ea.delegation.revoked",
  EA_ITEM_SUBMITTED: "ea.item.submitted",
  EA_ITEM_UPDATED: "ea.item.updated",
  EA_ITEM_RESUBMITTED: "ea.item.resubmitted",
  EA_ITEM_APPROVED: "ea.item.approved",
  EA_ITEM_REJECTED: "ea.item.rejected",

  // Automated billing — Task #429 (billing rules, triggers, orchestrator)
  BILLING_RULE_CREATED: "billing.rule.created",
  BILLING_RULE_UPDATED: "billing.rule.updated",
  BILLING_TRIGGER_DRAFTED: "billing.trigger.drafted",
  BILLING_TRIGGER_HELD: "billing.trigger.held",
  BILLING_TRIGGER_RELEASED: "billing.trigger.released",
  BILLING_TRIGGER_SKIPPED: "billing.trigger.skipped",
  BILLING_TRIGGER_APPROVED: "billing.trigger.approved",

  // Task #451 — client invoice email delivery from the billing worklist.
  INVOICE_EMAILED: "wallet.invoice.emailed",
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
  "pay_document.",
  "bank_change.",
  "person_insurance.",
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

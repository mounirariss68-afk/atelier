/**
 * Task #1091 — Riser finance approvals inbox in chat.
 *
 * "Run finance on autopilot with one approvals inbox for founders." This
 * file gives founders/finance-leadership the SAME unified approvals inbox
 * they see on the web (`/finance/approvals`) from chat, and lets them act
 * on it with the SAME safety rails:
 *
 *   READS
 *     finance_approvals_inbox   — the unified queue (counts per kind +
 *                                 items), via the shared aggregation
 *                                 helper the REST route uses.
 *     finance_autopilot_settings — current partner-tier autopilot
 *                                 thresholds.
 *
 *   WRITES (two-phase confirm + HMAC commit-token defense; every commit
 *   runs through the SAME route core as the REST endpoint, never a fork)
 *     approve_self_billing / reject_self_billing
 *     review_supplier_invoice        (allocation constraint parity)
 *     approve_close_accrual / reject_close_accrual   (accrual + CT prov.)
 *     approve_payroll_run            (MONEY-OUT ⇒ typed-name confirm)
 *     approve_send_collections       (OUTBOUND client email ⇒ typed-name;
 *                                     internal escalations are not outbound)
 *     set_autopilot_settings         (partner-tier threshold edit)
 *
 *   Payment-run SIGNING is deliberately NOT a chat commit — signing
 *   collects legal signatures against per-signatory bank limits
 *   (maker-checker, dual-sign) and needs the full run line-item view, so
 *   the inbox item deep-links to the payment-run page instead.
 *
 * ── Role clamps (four layers, defence in depth) ──
 *   1. `requiredRoles` on each entry = finance leadership only.
 *   2. The catalog gate (`capabilitiesForPersona`) strips the whole
 *      `ledger` module from restricted personas (contractor /
 *      partner_firm_resource / recruiter), from SELF_ONLY roles
 *      (employee/contractor → me.* only) and from alliance partners
 *      (partnerportal.* only); board_observer is read-only.
 *   3. Each `run` re-checks `isFinanceAutopilotLeadership` / partner tier
 *      server-side (never trusts model-supplied identity).
 *   4. Partner-tier-only inbox items (money-out) are actionable:false for
 *      finance callers and refuse at commit — checked server-side inside
 *      the shared cores.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierSelfBilledInvoices,
  atelierPayrollRun,
  atelierCollectionsDraft,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { isFinance, isFoundingPartner, isPartner } from "../../routes/atelier/personaRoles.js";
import {
  loadFinanceApprovalsInbox,
  updateFinanceAutopilotSettingsCore,
  isFinanceAutopilotLeadership,
  isFinanceAutopilotPartnerTier,
  type Me,
} from "../../routes/atelier/financeAutopilotRoutes.js";
import { loadFinanceAutopilotSettings } from "../atelier-finance-autopilot-settings.js";
import {
  approveSelfBillingCore,
  rejectSelfBillingCore,
  reviewSupplierInvoiceCore,
} from "../../routes/atelier/financePayablesRoutes.js";
import {
  approveCloseAccrualCore,
  rejectCloseAccrualCore,
  approveSendCollectionsDraftCore,
} from "../../routes/atelier/closeRoutes.js";
import { approvePayrollRunCore } from "../../routes/atelier/payrollRoutes.js";
import type { CliPersona, ToolResult } from "./index.js";

// ---------------------------------------------------------------------
// Commit-token defense — identical scheme to finance-doc-capabilities:
// phase 1 stamps an HMAC token into the server-persisted pending.input
// (never shown to the model); phase 2 commits ONLY when the token
// verifies against the committed fields. A model-fabricated confirm:true
// without the token degrades to the phase-1 preview instead of writing.
// For money-out / outbound writes this HMAC gate stacks UNDER the
// platform's typed-name confirm (entries flagged irreversible:true).
// ---------------------------------------------------------------------
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const COMMIT_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
function commitTokenFor(tool: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input)
    .filter((k) => k !== "confirm" && k !== "commitToken" && k !== "typedName")
    .sort();
  const canonical = JSON.stringify(keys.map((k) => [k, input[k]]));
  return createHmac("sha256", COMMIT_SECRET).update(`${tool}\n${canonical}`).digest("hex");
}
function isVerifiedCommit(tool: string, input: Record<string, unknown>): boolean {
  if (input.confirm !== true) return false;
  const got = typeof input.commitToken === "string" ? input.commitToken : "";
  const want = commitTokenFor(tool, input);
  if (got.length !== want.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(want, "utf8"));
  } catch {
    return false;
  }
}

/** Finance approvals are a finance-leadership surface. */
const FINANCE_ROLES = ["founding_partner", "partner", "finance"] as const;
/** Money-out / partner-tier-gated actions. */
const PARTNER_ROLES = ["founding_partner", "partner"] as const;

const INBOX_PATH = "/finance/approvals";

function denyForbidden(msg: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: msg };
}
function denyInvalid(msg: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: msg };
}

/** Resolve the full user row (cores + role checks key off the DB row). */
async function loadFullUser(personaId: string, orgId: string): Promise<Me | null> {
  const [row] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, personaId), eq(atelierUsers.orgId, orgId)));
  return row ?? null;
}

// ---------------------------------------------------------------------
// Read-only preview loaders. For irreversible / outbound writes the
// typed-name the user must retype MUST be a meaningful, authoritative
// value (invoice number, payroll period label) — never the opaque row
// id — so the confirm copy and the platform's enforcement agree. These
// fetch that value from the row at phase-1 preview time. Returning null
// means "not found / not actionable"; the commit core then refuses.
// ---------------------------------------------------------------------
async function previewSelfBilling(orgId: string, id: string): Promise<{ invoiceNumber: string } | null> {
  const [row] = await db.select({ invoiceNumber: atelierSelfBilledInvoices.invoiceNumber })
    .from(atelierSelfBilledInvoices)
    .where(and(eq(atelierSelfBilledInvoices.id, id), eq(atelierSelfBilledInvoices.orgId, orgId), isNull(atelierSelfBilledInvoices.deletedAt)));
  return row?.invoiceNumber ? { invoiceNumber: row.invoiceNumber } : null;
}
async function previewPayrollRun(orgId: string, id: string): Promise<{ periodLabel: string } | null> {
  const [row] = await db.select({ periodLabel: atelierPayrollRun.periodLabel })
    .from(atelierPayrollRun)
    .where(and(eq(atelierPayrollRun.id, id), eq(atelierPayrollRun.orgId, orgId), isNull(atelierPayrollRun.deletedAt)));
  return row?.periodLabel ? { periodLabel: row.periodLabel } : null;
}
async function previewCollectionsDraft(orgId: string, id: string): Promise<{ invoiceNumber: string; escalation: boolean } | null> {
  const [row] = await db.select({ invoiceNumber: atelierCollectionsDraft.invoiceNumber, escalation: atelierCollectionsDraft.escalation })
    .from(atelierCollectionsDraft)
    .where(and(eq(atelierCollectionsDraft.id, id), eq(atelierCollectionsDraft.orgId, orgId), isNull(atelierCollectionsDraft.deletedAt)));
  if (!row) return null;
  // A client-email step keys the typed value off the invoice number; an
  // internal escalation has no client email but still confirms on the id.
  return { invoiceNumber: row.invoiceNumber ?? id, escalation: row.escalation };
}

/** Layer-3 gate: finance leadership only, checked against the DB row. */
async function requireFinanceLeadership(
  persona: CliPersona,
): Promise<{ me: Me } | { deny: ToolResult }> {
  // Fast pre-check on the persona role (matches the catalog requiredRoles),
  // then authoritative re-check against the DB row inside the cores.
  if (!(isFoundingPartner(persona.role) || isPartner(persona.role) || isFinance(persona.role)))
    return { deny: denyForbidden("The approvals inbox is limited to finance leadership (founding_partner | partner | finance).") };
  const me = await loadFullUser(persona.id, persona.orgId);
  if (!me) return { deny: denyForbidden("User not found.") };
  if (!isFinanceAutopilotLeadership(me))
    return { deny: denyForbidden("The approvals inbox is limited to finance leadership (founding_partner | partner | finance).") };
  return { me };
}

/**
 * Map a shared-core `{ status, body }` outcome onto a ToolResult.
 * - 200/201 → ok:true with a `navigateTo` on commit-success (chat write
 *   contract: isWrite tools MUST return navigateTo on commit-success).
 * - 4xx/5xx → an honest refusal carrying the server's error code/message.
 * `buildData` shapes the success payload (adds recap fields); the caller
 * is responsible for appending `navigateTo`.
 */
function coreToResult(
  out: { status: number; body: Record<string, unknown> },
  buildOk: (body: Record<string, unknown>) => Record<string, unknown>,
): ToolResult {
  if (out.status === 200 || out.status === 201) {
    return { ok: true, data: { ...buildOk(out.body), navigateTo: { path: INBOX_PATH, when: "on_commit" as const } } };
  }
  const err = out.body as { error?: string; message?: string; status?: string };
  return {
    ok: false,
    errorCode: String(err.error ?? "failed"),
    errorMessage: String(err.message ?? `The action could not be completed${err.status ? ` (current status: ${err.status})` : ""}.`),
  };
}

// =====================================================================
// READ — finance_approvals_inbox
// =====================================================================
defineCapability({
  id: "ledger.finance_approvals_inbox",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "finance_approvals_inbox",
  description:
    "Show the unified finance approvals inbox — everything waiting on the founder/finance lead across payment runs, supplier & self-billing invoices, month-end accruals/CT provisions, payroll runs and collections drafts, with counts per kind. This is the same queue as the Finance → Approvals page.",
  slashAliases: { en: ["/approvals", "/finance-inbox"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  twoPhaseConfirm: false,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global", "home"],
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["what needs my approval?", "show the finance approvals inbox", "anything waiting on me in finance?"],
  },
  async run(_input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const inbox = await loadFinanceApprovalsInbox(gate.me);
    const totalCount = Object.values(inbox.totals).reduce((s, t) => s + t.count, 0);
    const actionableCount = Object.values(inbox.totals).reduce((s, t) => s + t.actionable, 0);
    return {
      ok: true,
      data: {
        ...inbox,
        totalCount,
        actionableCount,
        // Read tool: navigate hint points at the full page (no commit).
        navigateTo: { path: INBOX_PATH, when: "on_view" as const },
        summary:
          totalCount === 0
            ? "Your finance approvals inbox is clear — nothing is waiting on you."
            : `${totalCount} item(s) awaiting decision (${actionableCount} you can action now)${inbox.includesNonActionable ? "; partner-only items are shown but not actionable at your tier" : ""}.`,
      },
    };
  },
});

// =====================================================================
// READ — finance_autopilot_settings
// =====================================================================
defineCapability({
  id: "ledger.finance_autopilot_settings",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "finance_autopilot_settings",
  description:
    "Show the current finance autopilot thresholds — the AI-journal auto-post confidence floor and the supplier-invoice / AI-journal auto-approve ceilings (AED). Editing them requires partner tier.",
  slashAliases: { en: ["/autopilot-settings"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  twoPhaseConfirm: false,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["what are the finance autopilot thresholds?", "show autopilot settings"] },
  async run(_input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const settings = await loadFinanceAutopilotSettings(gate.me.orgId);
    return {
      ok: true,
      data: {
        settings,
        editable: isFinanceAutopilotPartnerTier(gate.me),
        navigateTo: { path: INBOX_PATH, when: "on_view" as const },
      },
    };
  },
});

// =====================================================================
// WRITE — approve_self_billing
// =====================================================================
defineCapability({
  id: "ledger.approve_self_billing",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "approve_self_billing",
  description:
    "Approve a draft self-billing invoice from the approvals inbox. Approving emails the supplier the invoice PDF (OUTBOUND) — IRREVERSIBLE, you'll be asked to type the invoice number to confirm. Runs the same payables core as the Finance UI.",
  slashAliases: { en: ["/approve-self-billing"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, confirm: { type: "boolean" }, typedName: { type: "string" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  // Approval emails the supplier the invoice PDF — an outbound, effectively
  // irreversible act — so the platform requires the invoice number typed.
  irreversible: true,
  outboundChannel: "email",
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["approve self-billing invoice sbi_123"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which self-billing invoice? Give its id from the inbox.");

    if (!isVerifiedCommit("approve_self_billing", input)) {
      const preview = await previewSelfBilling(gate.me.orgId, id);
      if (!preview) return { ok: false, errorCode: "not_found", errorMessage: "Self-billing invoice not found." };
      return {
        ok: true,
        data: { preview: { id, invoiceNumber: preview.invoiceNumber } },
        confirmation: {
          summary: `OUTBOUND: approve self-billing invoice ${preview.invoiceNumber}? The supplier is emailed the invoice PDF on approval. Type the invoice number to confirm.`,
          diff: {
            update: { table: "atelier_self_billed_invoices", id, status: "approved" },
            irreversible: true,
            outboundChannel: "email",
            // Authoritative typed value — matches the confirm copy.
            typedNameRequired: preview.invoiceNumber,
          },
          pending: {
            tool: "approve_self_billing",
            input: (() => {
              const pin: Record<string, unknown> = { id, confirm: true };
              pin.commitToken = commitTokenFor("approve_self_billing", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await approveSelfBillingCore({ me: gate.me, id });
    return coreToResult(out, (body) => ({
      message: `Approved self-billing invoice ${body.invoiceNumber ?? id} ⇒ approved; supplier notified.`,
      invoiceNumber: body.invoiceNumber,
      email: body.email,
    }));
  },
});

// =====================================================================
// WRITE — reject_self_billing
// =====================================================================
defineCapability({
  id: "ledger.reject_self_billing",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "reject_self_billing",
  description: "Reject a self-billing invoice from the approvals inbox, with an optional reason. Same payables core as the Finance UI.",
  slashAliases: { en: ["/reject-self-billing"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, reason: { type: "string" }, confirm: { type: "boolean" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["reject self-billing invoice sbi_123 — reason: duplicate"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which self-billing invoice? Give its id from the inbox.");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";

    if (!isVerifiedCommit("reject_self_billing", input)) {
      return {
        ok: true,
        data: { preview: { id, reason } },
        confirmation: {
          summary: `Reject self-billing invoice ${id}${reason ? ` (reason: ${reason})` : ""}?`,
          diff: { update: { table: "atelier_self_billed_invoices", id, status: "rejected", reason: reason || null } },
          pending: {
            tool: "reject_self_billing",
            input: (() => {
              const pin: Record<string, unknown> = { id, ...(reason ? { reason } : {}), confirm: true };
              pin.commitToken = commitTokenFor("reject_self_billing", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await rejectSelfBillingCore({ me: gate.me, id, reason: reason || null });
    return coreToResult(out, (body) => ({
      message: `Rejected self-billing invoice ${body.invoiceNumber ?? id} ⇒ rejected.`,
      invoiceNumber: body.invoiceNumber,
    }));
  },
});

// =====================================================================
// WRITE — review_supplier_invoice (approve / reject / start_review)
// =====================================================================
defineCapability({
  id: "ledger.review_supplier_invoice",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "review_supplier_invoice",
  description:
    "Review a supplier invoice from the approvals inbox: start_review, approve or reject. Approving also decides the invoice's entity allocation — if the allocation still needs input you must name the entity (legalEntityId); overriding a proposed entity needs allocationOverrideReason. Rejection needs a reason. Same payables review core (incl. bank-details hold) as the Finance UI.",
  slashAliases: { en: ["/review-supplier-invoice"] },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      decision: { type: "string", enum: ["start_review", "approve", "reject"] },
      reason: { type: "string" },
      legalEntityId: { type: "string" },
      allocationOverrideReason: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["id", "decision"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["approve supplier invoice si_123", "reject supplier invoice si_123 — reason: wrong amount"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which supplier invoice? Give its id from the inbox.");
    const decision = String(input.decision ?? "").trim();
    if (!["start_review", "approve", "reject"].includes(decision))
      return denyInvalid("decision must be start_review, approve or reject.");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const legalEntityId = typeof input.legalEntityId === "string" ? input.legalEntityId.trim() : "";
    const allocationOverrideReason = typeof input.allocationOverrideReason === "string" ? input.allocationOverrideReason.trim() : "";
    if (decision === "reject" && !reason)
      return denyInvalid("A rejection reason is required to reject a supplier invoice.");

    if (!isVerifiedCommit("review_supplier_invoice", input)) {
      const verb = decision === "start_review" ? "Start review of" : decision === "approve" ? "Approve" : "Reject";
      const allocNote =
        decision === "approve"
          ? legalEntityId
            ? ` Entity allocation → the entity you named${allocationOverrideReason ? ` (override: ${allocationOverrideReason})` : ""}.`
            : " If the allocation still needs input, name the entity (legalEntityId) or it stays queued for manual allocation."
          : "";
      return {
        ok: true,
        data: { preview: { id, decision, reason: reason || null, legalEntityId: legalEntityId || null } },
        confirmation: {
          summary: `${verb} supplier invoice ${id}${reason ? ` (reason: ${reason})` : ""}?${allocNote}`,
          diff: { update: { table: "atelier_partner_firm_invoices", id, decision, ...(legalEntityId ? { legalEntityId } : {}) } },
          pending: {
            tool: "review_supplier_invoice",
            input: (() => {
              const pin: Record<string, unknown> = {
                id, decision,
                ...(reason ? { reason } : {}),
                ...(legalEntityId ? { legalEntityId } : {}),
                ...(allocationOverrideReason ? { allocationOverrideReason } : {}),
                confirm: true,
              };
              pin.commitToken = commitTokenFor("review_supplier_invoice", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await reviewSupplierInvoiceCore({
      me: gate.me, id, decision,
      reason: reason || null,
      legalEntityId: legalEntityId || null,
      allocationOverrideReason: allocationOverrideReason || null,
    });
    const outcome = decision === "start_review" ? "under review" : decision === "approve" ? "approved" : "rejected";
    return coreToResult(out, (body) => ({
      invoice: body.invoice,
      message: `Supplier invoice ${id} ⇒ ${outcome}.`,
    }));
  },
});

// =====================================================================
// WRITE — approve_close_accrual (accrual + CT provision)
// =====================================================================
defineCapability({
  id: "ledger.approve_close_accrual",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "approve_close_accrual",
  description:
    "Approve a month-end accrual or CT provision from the approvals inbox. Approving posts the balanced journal (and its auto-reversal on the 1st of the next period, when configured). Partner tier only; same close core (incl. GL period-lock checks) as the Finance UI.",
  slashAliases: { en: ["/approve-accrual"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, note: { type: "string" }, confirm: { type: "boolean" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...PARTNER_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["approve accrual acc_123", "approve the CT provision"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    if (!isFinanceAutopilotPartnerTier(gate.me))
      return denyForbidden("Accrual / CT-provision approval requires partner tier (founding_partner | partner).");
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which accrual? Give its id from the inbox.");
    const note = typeof input.note === "string" ? input.note.trim() : "";

    if (!isVerifiedCommit("approve_close_accrual", input)) {
      return {
        ok: true,
        data: { preview: { id, note: note || null } },
        confirmation: {
          summary: `Approve accrual / CT provision ${id}? This posts the balanced journal (plus auto-reversal next period, when configured).`,
          diff: { update: { table: "atelier_close_accrual", id, status: "approved" } },
          pending: {
            tool: "approve_close_accrual",
            input: (() => {
              const pin: Record<string, unknown> = { id, ...(note ? { note } : {}), confirm: true };
              pin.commitToken = commitTokenFor("approve_close_accrual", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await approveCloseAccrualCore({ me: gate.me, id, note: note || null });
    return coreToResult(out, (body) => {
      const data = (body.data ?? {}) as Record<string, unknown>;
      const label = data.isCt ? "CT provision" : "accrual";
      return {
        ...data,
        message: `Approved ${label} "${data.memo ?? id}" ⇒ approved; journal ${data.journalEntryId} posted${data.reversalEntryId ? ` with auto-reversal ${data.reversalEntryId}` : ""}.`,
      };
    });
  },
});

// =====================================================================
// WRITE — reject_close_accrual (accrual + CT provision)
// =====================================================================
defineCapability({
  id: "ledger.reject_close_accrual",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "reject_close_accrual",
  description: "Reject a proposed month-end accrual or CT provision from the approvals inbox, with an optional note. Partner tier only; same close core as the Finance UI.",
  slashAliases: { en: ["/reject-accrual"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, note: { type: "string" }, confirm: { type: "boolean" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...PARTNER_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["reject accrual acc_123 — note: over-provisioned"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    if (!isFinanceAutopilotPartnerTier(gate.me))
      return denyForbidden("Accrual / CT-provision rejection requires partner tier (founding_partner | partner).");
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which accrual? Give its id from the inbox.");
    const note = typeof input.note === "string" ? input.note.trim() : "";

    if (!isVerifiedCommit("reject_close_accrual", input)) {
      return {
        ok: true,
        data: { preview: { id, note: note || null } },
        confirmation: {
          summary: `Reject accrual / CT provision ${id}${note ? ` (note: ${note})` : ""}?`,
          diff: { update: { table: "atelier_close_accrual", id, status: "rejected" } },
          pending: {
            tool: "reject_close_accrual",
            input: (() => {
              const pin: Record<string, unknown> = { id, ...(note ? { note } : {}), confirm: true };
              pin.commitToken = commitTokenFor("reject_close_accrual", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await rejectCloseAccrualCore({ me: gate.me, id, note: note || null });
    return coreToResult(out, (body) => {
      const label = body.isCt ? "CT provision" : "accrual";
      return { message: `Rejected ${label} "${body.memo ?? id}" ⇒ rejected.` };
    });
  },
});

// =====================================================================
// WRITE — approve_payroll_run (MONEY-OUT ⇒ typed-name confirm)
// =====================================================================
defineCapability({
  id: "ledger.approve_payroll_run",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "approve_payroll_run",
  description:
    "Approve a payroll run from the approvals inbox. This is money-out: it posts the salary journal (Dr salaries / Cr payroll payable). Partner tier only; IRREVERSIBLE — you'll be asked to type the period label to confirm. Same payroll core (incl. GL period-lock checks) as the Finance UI.",
  slashAliases: { en: ["/approve-payroll"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, confirm: { type: "boolean" }, typedName: { type: "string" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...PARTNER_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["approve payroll run payrun_123"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    if (!isFinanceAutopilotPartnerTier(gate.me))
      return denyForbidden("Payroll approval requires partner tier (founding_partner | partner).");
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which payroll run? Give its id from the inbox.");

    if (!isVerifiedCommit("approve_payroll_run", input)) {
      const preview = await previewPayrollRun(gate.me.orgId, id);
      if (!preview) return { ok: false, errorCode: "not_found", errorMessage: "Payroll run not found." };
      return {
        ok: true,
        data: { preview: { id, periodLabel: preview.periodLabel } },
        confirmation: {
          summary: `MONEY-OUT: approve payroll run for ${preview.periodLabel}? This posts the salary journal. Type the period label to confirm.`,
          diff: {
            update: { table: "atelier_payroll_run", id, status: "approved" },
            irreversible: true,
            // Authoritative typed value — the period label the copy names.
            typedNameRequired: preview.periodLabel,
          },
          pending: {
            tool: "approve_payroll_run",
            input: (() => {
              const pin: Record<string, unknown> = { id, confirm: true };
              pin.commitToken = commitTokenFor("approve_payroll_run", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await approvePayrollRunCore({ me: gate.me, id });
    return coreToResult(out, (body) => {
      const data = (body.data ?? {}) as Record<string, unknown>;
      return {
        ...data,
        message: `Approved payroll ${data.periodLabel ?? id} (USD ${data.totalAmount ?? "?"}, ${data.employees ?? "?"} employee(s)) ⇒ approved; salary journal ${data.journalEntryId} posted.`,
      };
    });
  },
});

// =====================================================================
// WRITE — approve_send_collections (OUTBOUND client email ⇒ typed-name)
// =====================================================================
defineCapability({
  id: "ledger.approve_send_collections",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "approve_send_collections",
  description:
    "Approve and send a collections (dunning) draft from the approvals inbox. For a client-email step this sends an OUTBOUND chase email to the customer — IRREVERSIBLE, you'll be asked to type the invoice number to confirm. Internal escalations are acknowledged only (no client email). Same collections core (incl. send-time re-validation of invoice state, ladder position and open promise-to-pay) as the Finance UI.",
  slashAliases: { en: ["/send-collections", "/approve-collections"] },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, confirm: { type: "boolean" }, typedName: { type: "string" } },
    required: ["id"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: "email",
  resultCard: null,
  requiredRoles: [...FINANCE_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["approve and send collections draft cd_123"] },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    const id = String(input.id ?? "").trim();
    if (!id) return denyInvalid("Which collections draft? Give its id from the inbox.");

    if (!isVerifiedCommit("approve_send_collections", input)) {
      const preview = await previewCollectionsDraft(gate.me.orgId, id);
      if (!preview) return { ok: false, errorCode: "not_found", errorMessage: "Collections draft not found." };
      return {
        ok: true,
        data: { preview: { id, invoiceNumber: preview.invoiceNumber, escalation: preview.escalation } },
        confirmation: {
          summary: `OUTBOUND: approve + send collections chase for invoice ${preview.invoiceNumber}? If this is a client-email step, the chase email leaves the building. Type the invoice number to confirm.`,
          diff: {
            update: { table: "atelier_collections_draft", id, status: "sent" },
            irreversible: true,
            outboundChannel: "email",
            // Authoritative typed value — the invoice number named in the copy.
            typedNameRequired: preview.invoiceNumber,
          },
          pending: {
            tool: "approve_send_collections",
            input: (() => {
              const pin: Record<string, unknown> = { id, confirm: true };
              pin.commitToken = commitTokenFor("approve_send_collections", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await approveSendCollectionsDraftCore({ me: gate.me, id });
    return coreToResult(out, (body) => {
      const data = (body.data ?? {}) as Record<string, unknown>;
      if (data.escalation) {
        return { ...data, message: `Escalation for invoice ${data.invoiceNumber ?? id} ⇒ acknowledged (internal, no client email).` };
      }
      return {
        ...data,
        message: `Collections chase for invoice ${data.invoiceNumber ?? id} ⇒ sent to ${data.recipient} via ${data.via}.`,
      };
    });
  },
});

// =====================================================================
// WRITE — set_autopilot_settings (partner-tier threshold edit)
// =====================================================================
defineCapability({
  id: "ledger.set_autopilot_settings",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "set_autopilot_settings",
  description:
    "Update the finance autopilot thresholds — AI-journal auto-post confidence floor (0–1), supplier-invoice auto-approve ceiling (AED), AI-journal auto-post ceiling (AED). Partner tier only; same settings core as the Finance UI. Only the fields you provide change.",
  slashAliases: { en: ["/set-autopilot"] },
  inputSchema: {
    type: "object",
    properties: {
      journalAutoConfidence: { type: "number", minimum: 0, maximum: 1 },
      supplierInvoiceAutoMaxAed: { type: "number", minimum: 0, maximum: 10000000 },
      journalAutoMaxAed: { type: "number", minimum: 0, maximum: 10000000 },
      confirm: { type: "boolean" },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...PARTNER_ROLES],
  surfaceOn: ["global"],
  examplePhrases: {
    en: ["set the supplier-invoice auto-approve ceiling to 5000 AED", "raise the AI-journal confidence floor to 0.9"],
  },
  async run(input, ctx) {
    const gate = await requireFinanceLeadership(ctx.persona);
    if ("deny" in gate) return gate.deny;
    if (!isFinanceAutopilotPartnerTier(gate.me))
      return denyForbidden("Editing autopilot thresholds requires partner tier (founding_partner | partner).");

    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const patch: Record<string, number> = {};
    const jc = num(input.journalAutoConfidence);
    const si = num(input.supplierInvoiceAutoMaxAed);
    const jm = num(input.journalAutoMaxAed);
    if (jc !== undefined) patch.journalAutoConfidence = jc;
    if (si !== undefined) patch.supplierInvoiceAutoMaxAed = si;
    if (jm !== undefined) patch.journalAutoMaxAed = jm;
    if (Object.keys(patch).length === 0)
      return denyInvalid("Nothing to change — provide at least one of journalAutoConfidence, supplierInvoiceAutoMaxAed or journalAutoMaxAed.");

    if (!isVerifiedCommit("set_autopilot_settings", input)) {
      const before = await loadFinanceAutopilotSettings(gate.me.orgId);
      const parts: string[] = [];
      if (patch.journalAutoConfidence !== undefined) parts.push(`confidence floor ${before.journalAutoConfidence} → ${patch.journalAutoConfidence}`);
      if (patch.supplierInvoiceAutoMaxAed !== undefined) parts.push(`supplier-invoice ceiling AED ${before.supplierInvoiceAutoMaxAed} → ${patch.supplierInvoiceAutoMaxAed}`);
      if (patch.journalAutoMaxAed !== undefined) parts.push(`AI-journal ceiling AED ${before.journalAutoMaxAed} → ${patch.journalAutoMaxAed}`);
      return {
        ok: true,
        data: { preview: patch, before },
        confirmation: {
          summary: `Update finance autopilot thresholds — ${parts.join("; ")}?`,
          diff: { update: { table: "atelier_finance_autopilot_settings", values: patch } },
          pending: {
            tool: "set_autopilot_settings",
            input: (() => {
              const pin: Record<string, unknown> = { ...patch, confirm: true };
              pin.commitToken = commitTokenFor("set_autopilot_settings", pin);
              return pin;
            })(),
          },
        },
      };
    }
    const out = await updateFinanceAutopilotSettingsCore({ me: gate.me, patch });
    return coreToResult(out, (body) => {
      const data = (body.data ?? {}) as Record<string, unknown>;
      return { settings: data.settings, message: "Finance autopilot thresholds updated ⇒ saved." };
    });
  },
});

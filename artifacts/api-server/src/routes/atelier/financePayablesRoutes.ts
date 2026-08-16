/**
 * Atelier — Finance Payables (P2P) routes (Task #418, Wave 6).
 *
 * All in-memory demo data (vendors, purchase orders, vendor invoices,
 * payment runs, WHT certificates, subcontractor links) was permanently
 * removed per the production no-dummy-data policy (Task #114). The
 * routes keep responding — listings return empty collections, derived
 * summaries compute to zero, by-id lookups 404 — so the frontend fails
 * gracefully. Real persistence + data entry land in a future task;
 * nothing here may reseed dummy data.
 *
 * Persona gating mirrors the Finance Entities pattern.
 */
import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import multer from "multer";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierSelfBilledInvoices,
  atelierPaymentRuns,
  atelierPaymentRunItems,
  atelierBankAccount,
  atelierBankSignatories,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierPartnerFirms,
  atelierLegalEntities,
  atelierExpenses,
  atelierEmployees,
  atelierContractors,
  type PaymentRunSignature,
} from "@workspace/db";
import { runSelfBillingClerk } from "../../lib/atelier-agents/selfBillingClerk.js";
import { nextRunNumber } from "../../lib/atelier-agents/selfBillingClerk.js";
import { runAgentExclusive } from "../../lib/atelier-agents/exclusive-runs.js";
import { notifySupplierOfInvoice } from "../../lib/selfBilledInvoiceEmail.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  CONTRACT_MAX_BYTES,
  loadContractBytes,
  storeContractBytes,
} from "../../lib/atelier-contracts.js";
import { convertToUsd, convertUsdTo } from "../../lib/atelier-fx.js";
import {
  proposeSupplierInvoiceAllocation,
  decideAllocation,
} from "../../lib/atelier-entity-allocation.js";
import { evaluateAutoPost } from "../../lib/atelier-finance-autopolicy.js";
import { loadFinanceAutopilotThresholds } from "../../lib/atelier-finance-autopilot-settings.js";
// Task #1251 — vendor invoice line-item mining trigger.
import { detectVendorKey, triggerVendorInvoiceMining } from "../../lib/atelier-vendor-invoice-mining.js";

export type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function audit(args: {
  entityType: string; entityId: string; actor: Me;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), orgId: args.actor.orgId,
    entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({ error: "recruiter-scope", message: "Recruiter persona may only access /studio surfaces." });
    return true;
  }
  return false;
}

function requireFinanceLeader(me: Me, res: Response): boolean {
  // Maker-checker / signatory mutations require Partner-tier or Finance.
  const ok = me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
  if (!ok) {
    res.status(403).json({ error: "leader-only", message: "Partner-tier or Finance role required." });
    return true;
  }
  return false;
}

/** Shared guard for read routes: persona + recruiter scope. */
function readGate(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return null;
  return me;
}

/** Shared guard for write routes: persona + recruiter scope + leader role. */
function writeGate(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return null;
  return me;
}

// -------
// Task #1091 (blueprint §6 / D2) — the dead vendor master / purchase-order /
// 3-way-match / vendor bank-change stub routes were REMOVED here. A
// two-founder consultancy has no PO discipline to match against; vendor
// registry folds into counterparty resolution, and vendor bank-change
// approval stays prevention-first + founder-manual (not rebuilt). Revisit
// only if real procurement volume appears. (No OpenAPI spec entries
// existed for those.)
//
// Task #1106 — the `/finance/payables/invoices` and
// `/finance/payables/subcontractors` stubs (both live-but-empty) were
// removed together with the Subcontractors pay-when-paid web surface.
// There is no vendor-invoice / PWP-link data model behind them; real
// payables live in Partner invoices, Supplier invoices and Self-billing.
// Revisit only if a genuine subcontractor pay-when-paid workflow appears.
// -------

// -------
// Self-billed invoices (RCTI) — Task #430
// -------

function invoiceWire(inv: typeof atelierSelfBilledInvoices.$inferSelect) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    supplierType: inv.supplierType,
    supplierId: inv.supplierId,
    supplierName: inv.supplierName,
    supplierEmail: inv.supplierEmail,
    weekIso: inv.weekIso,
    currency: inv.currency,
    lines: inv.lines,
    rateSnapshot: inv.rateSnapshot,
    subtotalAmount: inv.subtotalAmount,
    vat: inv.vat,
    vatAmount: inv.vatAmount,
    totalAmount: inv.totalAmount,
    totalUsd: inv.totalUsd,
    status: inv.status,
    reconciliation: inv.reconciliation,
    emailDelivery: inv.emailDelivery ?? [],
    contractorPaymentIds: inv.contractorPaymentIds,
    partnerFirmInvoiceIds: inv.partnerFirmInvoiceIds,
    disputeReason: inv.disputeReason,
    disputedAt: inv.disputedAt?.toISOString() ?? null,
    disputeResolutionNote: inv.disputeResolutionNote,
    disputeResolvedAt: inv.disputeResolvedAt?.toISOString() ?? null,
    rejectedReason: inv.rejectedReason,
    paymentRunId: inv.paymentRunId,
    paidAt: inv.paidAt?.toISOString() ?? null,
    remittanceRef: inv.remittanceRef,
    approvedAt: inv.approvedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/self-billing", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const conds = [eq(atelierSelfBilledInvoices.orgId, me.orgId), isNull(atelierSelfBilledInvoices.deletedAt)];
    if (status) conds.push(eq(atelierSelfBilledInvoices.status, status));
    const rows = await db
      .select()
      .from(atelierSelfBilledInvoices)
      .where(and(...conds))
      .orderBy(desc(atelierSelfBilledInvoices.weekIso), atelierSelfBilledInvoices.supplierName);
    res.json({ items: rows.map(invoiceWire) });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/self-billing/run", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const weeksIso = Array.isArray(req.body?.weeksIso)
      ? (req.body.weeksIso as unknown[]).filter((w): w is string => typeof w === "string" && /^\d{4}-W\d{2}$/.test(w))
      : undefined;
    // Task #1105 — single-flight through the SHARED per-agent lock the cron
    // scheduler also uses. A manual trigger while a run (manual or scheduled)
    // is in flight returns 409 rather than racing to double-materialise.
    const ex = await runAgentExclusive({
      agent: "self_billing_clerk", orgId: me.orgId, userId: me.id,
      label: "Self-Billing Clerk — manual run", resultHref: "/finance/payables/self-billing",
      work: () => runSelfBillingClerk({
        input: { weeksIso: weeksIso?.length ? weeksIso : undefined },
        triggeredByUserId: me.id,
      }),
    });
    if (!ex.ran) {
      res.status(409).json({ error: "already_running", message: "A Self-Billing Clerk run is already in progress — try again once it finishes." });
      return;
    }
    const result = ex.result;
    await audit({
      entityType: "self_billing_clerk", entityId: result.runId, actor: me,
      action: "finance.self_billing.run",
      payload: result.output as unknown as Record<string, unknown>,
      summary: `Self-Billing Clerk run triggered: ${result.output.invoicesCreated} created, ${result.output.invoicesUpdated} refreshed.`,
    });
    res.json({ ok: true, runId: result.runId, summary: result.output });
  } catch (err) { next(err); }
});

async function loadInvoice(me: Me, id: string) {
  const [inv] = await db
    .select()
    .from(atelierSelfBilledInvoices)
    .where(and(
      eq(atelierSelfBilledInvoices.id, id),
      eq(atelierSelfBilledInvoices.orgId, me.orgId),
      isNull(atelierSelfBilledInvoices.deletedAt),
    ));
  return inv ?? null;
}

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
/**
 * Task #1091 — shared self-billing approve core. The REST route and the
 * Riser chat capability (finance.approve_self_billing) BOTH run this so
 * the status transition, audit and supplier email never fork. Returns an
 * HTTP-shaped `{ status, body }` outcome plus the invoice for previews.
 */
export async function approveSelfBillingCore(args: {
  me: Me;
  id: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const inv = await loadInvoice(me, args.id);
  if (!inv) return { status: 404, body: { error: "not-found" } };
  if (inv.status !== "draft")
    return { status: 409, body: { error: "invalid-status", message: `Only draft invoices can be approved (status: ${inv.status}).` } };
  await db.update(atelierSelfBilledInvoices).set({
    status: "approved", approvedByUserId: me.id, approvedAt: new Date(), updatedAt: new Date(),
  }).where(eq(atelierSelfBilledInvoices.id, inv.id));
  await audit({
    entityType: "self_billed_invoice", entityId: inv.id, actor: me,
    action: "finance.self_billing.approve",
    payload: { invoiceNumber: inv.invoiceNumber, totalUsd: inv.totalUsd },
    summary: `Approved self-billed invoice ${inv.invoiceNumber} ($${inv.totalUsd.toFixed(2)}).`,
  });
  // Notify the supplier with the invoice PDF attached. Never blocks
  // the approval — the outcome is recorded on the invoice row.
  const email = await notifySupplierOfInvoice(inv.id, "approval", {
    actor: { name: me.name, email: me.email },
  });
  return { status: 200, body: { ok: true, email, invoiceNumber: inv.invoiceNumber, totalAmount: inv.totalAmount, currency: inv.currency } };
}

/** Task #1091 — shared self-billing reject core (see approveSelfBillingCore). */
export async function rejectSelfBillingCore(args: {
  me: Me;
  id: string;
  reason?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const inv = await loadInvoice(me, args.id);
  if (!inv) return { status: 404, body: { error: "not-found" } };
  if (inv.status !== "draft" && inv.status !== "disputed" && inv.status !== "approved")
    return { status: 409, body: { error: "invalid-status", message: `Cannot reject an invoice in status ${inv.status}.` } };
  if (inv.paymentRunId)
    return { status: 409, body: { error: "in-payment-run", message: "Remove the invoice from its payment run first." } };
  const reason = typeof args.reason === "string" ? args.reason.slice(0, 2000) : null;
  await db.update(atelierSelfBilledInvoices).set({
    status: "rejected", rejectedByUserId: me.id, rejectedAt: new Date(), rejectedReason: reason, updatedAt: new Date(),
  }).where(eq(atelierSelfBilledInvoices.id, inv.id));
  await audit({
    entityType: "self_billed_invoice", entityId: inv.id, actor: me,
    action: "finance.self_billing.reject",
    payload: { invoiceNumber: inv.invoiceNumber, reason },
    summary: `Rejected self-billed invoice ${inv.invoiceNumber}.`,
  });
  return { status: 200, body: { ok: true, invoiceNumber: inv.invoiceNumber } };
}

// @cli-skip: chat parity via finance.approve_self_billing (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/finance/payables/self-billing/:id/approve", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const out = await approveSelfBillingCore({ me, id: req.params.id });
    res.status(out.status).json(out.body);
  } catch (err) { next(err); }
});

// @cli-skip: chat parity via finance.reject_self_billing (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/finance/payables/self-billing/:id/reject", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const out = await rejectSelfBillingCore({ me, id: req.params.id, reason: req.body?.reason });
    res.status(out.status).json(out.body);
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/self-billing/:id/resolve-dispute", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const inv = await loadInvoice(me, req.params.id);
    if (!inv) { res.status(404).json({ error: "not-found" }); return; }
    if (inv.status !== "disputed") {
      res.status(409).json({ error: "invalid-status", message: "Invoice is not disputed." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : null;
    await db.update(atelierSelfBilledInvoices).set({
      status: "draft",
      disputeResolvedByUserId: me.id,
      disputeResolvedAt: new Date(),
      disputeResolutionNote: note,
      updatedAt: new Date(),
    }).where(eq(atelierSelfBilledInvoices.id, inv.id));
    await audit({
      entityType: "self_billed_invoice", entityId: inv.id, actor: me,
      action: "finance.self_billing.resolve_dispute",
      payload: { invoiceNumber: inv.invoiceNumber, note },
      summary: `Resolved dispute on self-billed invoice ${inv.invoiceNumber}; back to draft for re-review.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------
// Payment runs (maker-checker + dual signatories + bank-file)
// Task #430 — real implementation over atelier_payment_runs.
// -------

function runWire(
  run: typeof atelierPaymentRuns.$inferSelect,
  items?: Array<typeof atelierPaymentRunItems.$inferSelect>,
  /** refIds of partner_firm_invoice items that will export with blank bank details */
  missingPayeeBankRefIds?: Set<string>,
) {
  return {
    id: run.id,
    runNumber: run.runNumber,
    bankAccountId: run.bankAccountId,
    bankAccountLabel: run.bankAccountLabel,
    currency: run.currency,
    status: run.status,
    itemCount: run.itemCount,
    totalUsd: run.totalUsd,
    makerUserId: run.makerUserId,
    makerName: run.makerName,
    signatures: run.signatures,
    approvedAt: run.approvedAt?.toISOString() ?? null,
    exportedAt: run.exportedAt?.toISOString() ?? null,
    paidAt: run.paidAt?.toISOString() ?? null,
    cancelledAt: run.cancelledAt?.toISOString() ?? null,
    cancelReason: run.cancelReason,
    notes: run.notes,
    createdAt: run.createdAt.toISOString(),
    items: items?.map((it) => ({
      id: it.id,
      itemType: it.itemType,
      refId: it.refId,
      payeeName: it.payeeName,
      description: it.description,
      amount: it.amount,
      currency: it.currency,
      amountUsd: it.amountUsd,
      status: it.status,
      remittanceRef: it.remittanceRef,
      paidAt: it.paidAt?.toISOString() ?? null,
      // Task #1144 — flag unlinked supplier items that will export with blank
      // bank cells so signatories can spot them before approving the run.
      missingBank: it.itemType === "partner_firm_invoice"
        ? Boolean(missingPayeeBankRefIds?.has(it.refId))
        : false,
    })),
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/payment-runs", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierPaymentRuns)
      .where(and(eq(atelierPaymentRuns.orgId, me.orgId), isNull(atelierPaymentRuns.deletedAt)))
      .orderBy(desc(atelierPaymentRuns.createdAt));
    res.json({ items: rows.map((r) => runWire(r)) });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/build", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const bankAccountId = typeof req.body?.bankAccountId === "string" ? req.body.bankAccountId : "";
    if (!bankAccountId) { res.status(400).json({ error: "bank-account-required" }); return; }
    const [bank] = await db
      .select()
      .from(atelierBankAccount)
      .where(and(
        eq(atelierBankAccount.id, bankAccountId),
        eq(atelierBankAccount.orgId, me.orgId),
        eq(atelierBankAccount.isActive, true),
        isNull(atelierBankAccount.deletedAt),
      ));
    if (!bank) { res.status(404).json({ error: "bank-account-not-found" }); return; }

    const wantInvoiceIds = Array.isArray(req.body?.invoiceIds)
      ? (req.body.invoiceIds as unknown[]).filter((x): x is string => typeof x === "string")
      : null;
    const wantExpenseIds = Array.isArray(req.body?.expenseIds)
      ? (req.body.expenseIds as unknown[]).filter((x): x is string => typeof x === "string")
      : null;

    const wantPartnerInvoiceIds0 = Array.isArray(req.body?.partnerInvoiceIds)
      ? (req.body.partnerInvoiceIds as unknown[]).filter((x): x is string => typeof x === "string")
      : null;

    // Task #1070 (review) — run construction must atomically CLAIM its
    // items or two concurrent builds double-schedule (and double-pay)
    // the same invoice. The whole selection + claim + item creation
    // runs in one transaction behind a per-org advisory lock, and the
    // invoice claims are additionally conditional
    // (status='approved' AND payment_run_id IS NULL) as defense in depth.
    const built = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`atelier_payment_run_build:${me.orgId}`}))`,
    );
    // Eligible invoices: APPROVED, not yet in a run. Disputed / draft /
    // paid / rejected are excluded by construction.
    const invConds = [
      eq(atelierSelfBilledInvoices.orgId, me.orgId),
      eq(atelierSelfBilledInvoices.status, "approved"),
      isNull(atelierSelfBilledInvoices.paymentRunId),
      isNull(atelierSelfBilledInvoices.deletedAt),
    ];
    let invoices = await tx.select().from(atelierSelfBilledInvoices).where(and(...invConds));
    if (wantInvoiceIds) invoices = invoices.filter((i) => wantInvoiceIds.includes(i.id));

    // Eligible reimbursements: APPROVED expenses not yet reimbursed and
    // not already sitting in a live run.
    const liveRuns = await tx
      .select({ id: atelierPaymentRuns.id })
      .from(atelierPaymentRuns)
      .where(and(
        eq(atelierPaymentRuns.orgId, me.orgId),
        inArray(atelierPaymentRuns.status, ["draft", "pending_signatures", "approved", "exported"]),
        isNull(atelierPaymentRuns.deletedAt),
      ));
    const liveRunIds = liveRuns.map((r) => r.id);
    const liveItems = liveRunIds.length
      ? await tx.select({ refId: atelierPaymentRunItems.refId, itemType: atelierPaymentRunItems.itemType })
          .from(atelierPaymentRunItems)
          .where(and(inArray(atelierPaymentRunItems.runId, liveRunIds), eq(atelierPaymentRunItems.status, "pending")))
      : [];
    const lockedExpenseIds = new Set(liveItems.filter((i) => i.itemType === "expense_reimbursement").map((i) => i.refId));

    let expenses = await tx
      .select()
      .from(atelierExpenses)
      .where(and(
        eq(atelierExpenses.orgId, me.orgId),
        eq(atelierExpenses.status, "approved"),
        isNull(atelierExpenses.deletedAt),
      ));
    expenses = expenses.filter((e) => !lockedExpenseIds.has(e.id));
    if (wantExpenseIds) expenses = expenses.filter((e) => wantExpenseIds.includes(e.id));

    // Task #875 — eligible partner-submitted AP invoices: APPROVED, not yet
    // scheduled into a run. Payments only ever go to finance-approved firm
    // bank details, so firms without an IBAN are skipped (surfaced in the
    // response so finance can chase onboarding).
    // Task #1070 — internally-uploaded supplier invoices (source
    // "internal_upload") join under the same rules; the bank-details hold
    // applies whenever the supplier is a registered partner firm
    // (partnerFirmId set). Unregistered suppliers have no firm bank
    // registry — finance keys their details into the bank file directly.
    const wantPartnerInvoiceIds = wantPartnerInvoiceIds0;
    let partnerInvoices = await tx.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      inArray(atelierPartnerFirmInvoices.source, ["partner_submitted", "internal_upload"]),
      eq(atelierPartnerFirmInvoices.status, "approved"),
      isNull(atelierPartnerFirmInvoices.paymentRunId),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    ));
    if (wantPartnerInvoiceIds) partnerInvoices = partnerInvoices.filter((p) => wantPartnerInvoiceIds.includes(p.id));
    const pfIds = [...new Set(partnerInvoices.map((p) => p.partnerFirmId).filter((id) => id))];
    const pfRows = pfIds.length
      ? await tx.select({ id: atelierPartnerFirms.id, bankIban: atelierPartnerFirms.bankIban })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, pfIds)))
      : [];
    const firmHasBank = new Set(pfRows.filter((f) => (f.bankIban ?? "").trim()).map((f) => f.id));
    const bankHeld = (p: typeof atelierPartnerFirmInvoices.$inferSelect) =>
      Boolean(p.partnerFirmId) && !firmHasBank.has(p.partnerFirmId);
    const skippedMissingBank = partnerInvoices.filter(bankHeld).map((p) => p.id);
    partnerInvoices = partnerInvoices.filter((p) => !bankHeld(p));

    // Task #1144 — among the invoices that DO join the run, identify unlinked
    // ones (no partnerFirmId) that lack a complete bank record. The CSV export
    // needs BOTH an IBAN and an account-holder name; missing either produces a
    // blank bank cell. Surface them so signatories can spot the gap before
    // approving. Export behaviour is unchanged.
    const missingPayeeBank = partnerInvoices
      .filter((p) => !p.partnerFirmId && (
        !(p.supplierBankIban ?? "").trim() || !(p.supplierBankHolder ?? "").trim()
      ))
      .map((p) => p.id);

    if (invoices.length === 0 && expenses.length === 0 && partnerInvoices.length === 0) {
      return { error: "no-eligible-items" as const, skippedMissingBank };
    }

    const runId = rid("payrun");
    const totalUsd = +(
      invoices.reduce((s, i) => s + i.totalUsd, 0) +
      expenses.reduce((s, e) => s + (e.usdAmount ?? 0), 0) +
      partnerInvoices.reduce((s, p) => s + (p.usdAmount ?? 0), 0)
    ).toFixed(2);
    const runNumber = await nextRunNumber();
    await tx.insert(atelierPaymentRuns).values({
      id: runId,
      orgId: me.orgId,
      runNumber,
      bankAccountId: bank.id,
      bankAccountLabel: `${bank.bankName} · ${bank.accountLabel} ····${bank.accountNumberLast4}`,
      legalEntityId: bank.legalEntityId ?? null,
      currency: bank.currency,
      status: "pending_signatures",
      itemCount: invoices.length + expenses.length + partnerInvoices.length,
      totalUsd,
      makerUserId: me.id,
      makerName: me.name,
      createdByUserId: me.id,
    });
    for (const inv of invoices) {
      // Conditional claim (defense in depth on top of the advisory lock):
      // only rows still approved + unassigned get scheduled and an item.
      const claimed = await tx.update(atelierSelfBilledInvoices).set({
        status: "scheduled", paymentRunId: runId, updatedAt: new Date(),
      }).where(and(
        eq(atelierSelfBilledInvoices.id, inv.id),
        eq(atelierSelfBilledInvoices.status, "approved"),
        isNull(atelierSelfBilledInvoices.paymentRunId),
      )).returning({ id: atelierSelfBilledInvoices.id });
      if (claimed.length === 0) continue;
      await tx.insert(atelierPaymentRunItems).values({
        id: rid("pri"),
        orgId: me.orgId,
        runId,
        itemType: "self_billed_invoice",
        refId: inv.id,
        payeeName: inv.supplierName,
        description: `${inv.invoiceNumber} · ${inv.weekIso}`,
        amount: inv.totalAmount,
        currency: inv.currency,
        amountUsd: inv.totalUsd,
      });
    }
    for (const e of expenses) {
      await tx.insert(atelierPaymentRunItems).values({
        id: rid("pri"),
        orgId: me.orgId,
        runId,
        itemType: "expense_reimbursement",
        refId: e.id,
        payeeName: e.personId,
        description: `Expense ${e.merchant ?? e.category} · ${e.expenseDate}`,
        amount: e.amount,
        currency: e.currency,
        amountUsd: e.usdAmount ?? 0,
      });
    }
    // Task #875 — directly-submitted partner AP invoices join the run.
    for (const p of partnerInvoices) {
      const claimed = await tx.update(atelierPartnerFirmInvoices).set({
        status: "scheduled", paymentRunId: runId, updatedAt: new Date(),
      }).where(and(
        eq(atelierPartnerFirmInvoices.id, p.id),
        eq(atelierPartnerFirmInvoices.status, "approved"),
        isNull(atelierPartnerFirmInvoices.paymentRunId),
      )).returning({ id: atelierPartnerFirmInvoices.id });
      if (claimed.length === 0) continue;
      await tx.insert(atelierPaymentRunItems).values({
        id: rid("pri"),
        orgId: me.orgId,
        runId,
        itemType: "partner_firm_invoice",
        refId: p.id,
        payeeName: p.partnerFirmName,
        description: `${p.source === "internal_upload" ? "Supplier invoice" : "Partner invoice"} ${p.reference ?? p.id}${p.periodLabel ? ` · ${p.periodLabel}` : ""}`,
        amount: p.costAmount,
        currency: p.costCurrency,
        amountUsd: p.usdAmount ?? 0,
      });
    }
    return { error: null, runId, runNumber, totalUsd, skippedMissingBank, missingPayeeBank, invoices, expenses, partnerInvoices };
    });
    if (built.error === "no-eligible-items") {
      res.status(409).json({ error: "no-eligible-items", message: "No approved self-billed invoices, partner invoices or unreimbursed approved expenses available." });
      return;
    }
    const { runId, runNumber, totalUsd, skippedMissingBank, missingPayeeBank, invoices, expenses, partnerInvoices } = built;
    await audit({
      entityType: "payment_run", entityId: runId, actor: me,
      action: "finance.payment_run.build",
      payload: { runNumber, bankAccountId: bank.id, invoices: invoices.map((i) => i.id), expenses: expenses.map((e) => e.id), partnerInvoices: partnerInvoices.map((p) => p.id), skippedMissingBank, missingPayeeBank, totalUsd },
      summary: `Built payment run ${runNumber}: ${invoices.length} invoice(s) + ${expenses.length} reimbursement(s) + ${partnerInvoices.length} partner invoice(s), $${totalUsd.toFixed(2)}.`,
    });
    const [run] = await db.select().from(atelierPaymentRuns).where(eq(atelierPaymentRuns.id, runId));
    const items = await db.select().from(atelierPaymentRunItems).where(eq(atelierPaymentRunItems.runId, runId));
    // Task #1144 — pass the missing-bank set so runWire can flag each item.
    const missingPayeeBankRefIds = new Set(missingPayeeBank);
    res.status(201).json({ ok: true, run: runWire(run, items, missingPayeeBankRefIds), skippedMissingBank, missingPayeeBank });
  } catch (err) { next(err); }
});

async function loadRun(me: Me, id: string) {
  const [run] = await db
    .select()
    .from(atelierPaymentRuns)
    .where(and(eq(atelierPaymentRuns.id, id), eq(atelierPaymentRuns.orgId, me.orgId), isNull(atelierPaymentRuns.deletedAt)));
  return run ?? null;
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/payment-runs/:id", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    const items = await db.select().from(atelierPaymentRunItems).where(eq(atelierPaymentRunItems.runId, run.id));
    const auditRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(
        eq(atelierAuditEvents.orgId, me.orgId),
        eq(atelierAuditEvents.entityType, "payment_run"),
        eq(atelierAuditEvents.entityId, run.id),
      ))
      .orderBy(desc(atelierAuditEvents.createdAt));

    // Task #1144 — compute which partner_firm_invoice items lack bank details
    // so the run card can warn signatories. Look up the original invoices and
    // check unlinked ones (no partnerFirmId) for a missing supplierBankIban.
    const pfItemRefIds = items
      .filter((it) => it.itemType === "partner_firm_invoice")
      .map((it) => it.refId);
    let missingPayeeBankRefIds = new Set<string>();
    if (pfItemRefIds.length) {
      const pfInvRows = await db
        .select({
          id: atelierPartnerFirmInvoices.id,
          partnerFirmId: atelierPartnerFirmInvoices.partnerFirmId,
          supplierBankIban: atelierPartnerFirmInvoices.supplierBankIban,
          supplierBankHolder: atelierPartnerFirmInvoices.supplierBankHolder,
        })
        .from(atelierPartnerFirmInvoices)
        .where(and(
          eq(atelierPartnerFirmInvoices.orgId, me.orgId),
          inArray(atelierPartnerFirmInvoices.id, pfItemRefIds),
        ));
      missingPayeeBankRefIds = new Set(
        pfInvRows
          .filter((p) => !p.partnerFirmId && (
            !(p.supplierBankIban ?? "").trim() || !(p.supplierBankHolder ?? "").trim()
          ))
          .map((p) => p.id),
      );
    }

    res.json({
      run: runWire(run, items, missingPayeeBankRefIds),
      missingPayeeBank: [...missingPayeeBankRefIds],
      auditEvents: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        actorLabel: a.actorLabel,
        summary: a.payloadSummary,
        at: a.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// @cli-skip: #1091 — signing collects legal signatures against per-signatory bank limits (maker-checker, dual-sign) and needs the full run line-item view; chat deep-links to the payment-run page (finance.approvals_inbox item) instead of committing signatures inline
router.post("/finance/payables/payment-runs/:id/sign", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status !== "pending_signatures") {
      res.status(409).json({ error: "invalid-status", message: `Run is ${run.status}; signatures are only collected while pending.` });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const sigs = await db
      .select()
      .from(atelierBankSignatories)
      .where(and(
        eq(atelierBankSignatories.orgId, me.orgId),
        eq(atelierBankSignatories.bankAccountId, run.bankAccountId),
        eq(atelierBankSignatories.userId, me.id),
        isNull(atelierBankSignatories.deletedAt),
      ));
    const mySig = sigs.find((s) =>
      s.authority !== "view_only" &&
      (!s.effectiveFrom || s.effectiveFrom <= today) &&
      (!s.expiresOn || s.expiresOn >= today),
    );
    if (!mySig) {
      res.status(403).json({ error: "not-a-signatory", message: "You are not an active signatory on this run's bank account." });
      return;
    }
    if (mySig.monetaryLimitAmount != null && run.totalUsd > mySig.monetaryLimitAmount) {
      res.status(403).json({
        error: "over-signing-limit",
        message: `Run total $${run.totalUsd.toFixed(2)} exceeds your signing limit of ${mySig.limitCurrency ?? "USD"} ${mySig.monetaryLimitAmount.toFixed(2)}.`,
      });
      return;
    }
    const existing = (run.signatures ?? []) as PaymentRunSignature[];
    if (existing.some((s) => s.userId === me.id)) {
      res.status(409).json({ error: "already-signed", message: "You have already signed this run — a second, distinct signatory is required." });
      return;
    }
    const signatures: PaymentRunSignature[] = [
      ...existing,
      { signatoryId: mySig.id, userId: me.id, name: me.name, authority: mySig.authority, signedAt: new Date().toISOString() },
    ];
    const approved = signatures.length >= 2;
    await db.update(atelierPaymentRuns).set({
      signatures,
      status: approved ? "approved" : "pending_signatures",
      approvedAt: approved ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(atelierPaymentRuns.id, run.id));
    await audit({
      entityType: "payment_run", entityId: run.id, actor: me,
      action: "finance.payment_run.sign",
      payload: { runNumber: run.runNumber, signatoryId: mySig.id, signaturesCount: signatures.length, approved },
      summary: `${me.name} signed payment run ${run.runNumber} (${signatures.length}/2 signatures${approved ? " — approved" : ""}).`,
    });
    res.json({ ok: true, signatures: signatures.length, approved });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/export", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status !== "approved" && run.status !== "exported") {
      res.status(409).json({ error: "invalid-status", message: "Run must be dual-signed (approved) before export." });
      return;
    }
    const items = await db.select().from(atelierPaymentRunItems)
      .where(and(eq(atelierPaymentRunItems.runId, run.id), eq(atelierPaymentRunItems.status, "pending")));
    // Task #1075 — the bank file carries verified payee bank details for
    // AP invoice items: firm-linked invoices pay to the finance-approved
    // registry IBAN; one-off suppliers pay to the details recorded on the
    // invoice row. Blank cells mean finance still keys them manually
    // (self-billed / reimbursement items, or nothing recorded).
    // Exposure is safe: this route is writeGate'd to fp/partner/finance.
    const apItemIds = items.filter((it) => it.itemType === "partner_firm_invoice").map((it) => it.refId);
    const apRows = apItemIds.length
      ? await db.select({
          id: atelierPartnerFirmInvoices.id,
          partnerFirmId: atelierPartnerFirmInvoices.partnerFirmId,
          supplierBankIban: atelierPartnerFirmInvoices.supplierBankIban,
          supplierBankHolder: atelierPartnerFirmInvoices.supplierBankHolder,
        }).from(atelierPartnerFirmInvoices)
          .where(and(eq(atelierPartnerFirmInvoices.orgId, me.orgId), inArray(atelierPartnerFirmInvoices.id, apItemIds)))
      : [];
    const apById = new Map(apRows.map((r) => [r.id, r]));
    const firmIds = [...new Set(apRows.map((r) => r.partnerFirmId).filter((id) => id))];
    const firmRows = firmIds.length
      ? await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name, bankIban: atelierPartnerFirms.bankIban })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const firmById = new Map(firmRows.map((f) => [f.id, f]));
    const payeeBank = (it: typeof atelierPaymentRunItems.$inferSelect): { iban: string; holder: string } => {
      if (it.itemType !== "partner_firm_invoice") return { iban: "", holder: "" };
      const ap = apById.get(it.refId);
      if (!ap) return { iban: "", holder: "" };
      if (ap.partnerFirmId) {
        const firm = firmById.get(ap.partnerFirmId);
        return { iban: (firm?.bankIban ?? "").trim(), holder: firm?.name ?? it.payeeName };
      }
      const iban = (ap.supplierBankIban ?? "").trim();
      return { iban, holder: iban ? (ap.supplierBankHolder ?? "").trim() : "" };
    };
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      "run_number,item_type,payee,description,amount,currency,amount_usd,payee_iban,payee_account_holder",
      ...items.map((it) => {
        const bank = payeeBank(it);
        return [run.runNumber, it.itemType, esc(it.payeeName), esc(it.description), it.amount.toFixed(2), it.currency, it.amountUsd.toFixed(2), esc(bank.iban), esc(bank.holder)].join(",");
      }),
    ];
    if (run.status === "approved") {
      await db.update(atelierPaymentRuns).set({ status: "exported", exportedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierPaymentRuns.id, run.id));
      await audit({
        entityType: "payment_run", entityId: run.id, actor: me,
        action: "finance.payment_run.export",
        payload: { runNumber: run.runNumber, itemCount: items.length },
        summary: `Exported bank file for payment run ${run.runNumber} (${items.length} item(s)).`,
      });
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${run.runNumber}.csv`));
    res.send(lines.join("\n"));
  } catch (err) { next(err); }
});

// @cli-skip: finance export; Wio Bank bulk-payment CSV with IBAN look-ups
router.post("/finance/payables/payment-runs/:id/export-wio", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status !== "approved" && run.status !== "exported") {
      res.status(409).json({ error: "invalid-status", message: "Run must be dual-signed (approved) before Wio export." });
      return;
    }
    const items = await db.select().from(atelierPaymentRunItems)
      .where(and(eq(atelierPaymentRunItems.runId, run.id), eq(atelierPaymentRunItems.status, "pending")));

    // ── IBAN look-ups per item type ──────────────────────────────────────────
    // IBANs are never stored on run items (sensitive data stays on source
    // records); we re-join at export time under the finance write gate.

    const pfInvRefIds = items.filter((i) => i.itemType === "partner_firm_invoice").map((i) => i.refId);
    const expRefIds   = items.filter((i) => i.itemType === "expense_reimbursement").map((i) => i.refId);
    const sbiRefIds   = items.filter((i) => i.itemType === "self_billed_invoice").map((i) => i.refId);

    // partner_firm_invoice → partnerFirmInvoices → partnerFirms.bankIban (registered firms)
    //   OR supplierBankIban/supplierBankHolder on the invoice itself (one-off suppliers, Task #1075)
    const pfInvRows = pfInvRefIds.length
      ? await db.select({
          id: atelierPartnerFirmInvoices.id,
          partnerFirmId: atelierPartnerFirmInvoices.partnerFirmId,
          supplierBankIban: atelierPartnerFirmInvoices.supplierBankIban,
          supplierBankHolder: atelierPartnerFirmInvoices.supplierBankHolder,
        })
          .from(atelierPartnerFirmInvoices)
          .where(and(eq(atelierPartnerFirmInvoices.orgId, me.orgId), inArray(atelierPartnerFirmInvoices.id, pfInvRefIds)))
      : [];
    const pfInvMap = new Map(pfInvRows.map((r) => [r.id, r]));

    // expense_reimbursement → expenses → persons.iban
    const expRows = expRefIds.length
      ? await db.select({ id: atelierExpenses.id, personId: atelierExpenses.personId })
          .from(atelierExpenses)
          .where(and(eq(atelierExpenses.orgId, me.orgId), inArray(atelierExpenses.id, expRefIds)))
      : [];
    const expPersonId = new Map(expRows.map((r) => [r.id, r.personId]));

    // self_billed_invoice → supplierId/supplierType
    const sbiRows = sbiRefIds.length
      ? await db.select({ id: atelierSelfBilledInvoices.id, supplierId: atelierSelfBilledInvoices.supplierId, supplierType: atelierSelfBilledInvoices.supplierType })
          .from(atelierSelfBilledInvoices)
          .where(and(eq(atelierSelfBilledInvoices.orgId, me.orgId), inArray(atelierSelfBilledInvoices.id, sbiRefIds)))
      : [];
    const sbiInfo = new Map(sbiRows.map((r) => [r.id, { supplierId: r.supplierId, supplierType: r.supplierType }]));

    // Collect all partner firm IDs (from pfInv registered firms + sbi partner_firm rows)
    const sbiPfSupplierIds = sbiRows.filter((r) => r.supplierType === "partner_firm").map((r) => r.supplierId);
    const registeredPfIds = [...pfInvMap.values()].map((r) => r.partnerFirmId).filter((v): v is string => !!v);
    const allPfIds = [...new Set([...registeredPfIds, ...sbiPfSupplierIds].filter((v): v is string => !!v))];
    const pfBankRows = allPfIds.length
      ? await db.select({ id: atelierPartnerFirms.id, bankIban: atelierPartnerFirms.bankIban, bankSwift: atelierPartnerFirms.bankSwift, bankName: atelierPartnerFirms.bankName })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, allPfIds)))
      : [];
    const pfBank = new Map(pfBankRows.map((r) => [r.id, r]));

    // Expense reimbursements → employee IBAN (sole IBAN write path is HR bank-change approve on atelierEmployees).
    // Contractor self-billed invoices have no system IBAN (contractors have no bank/IBAN per pay-hub policy).
    const expEmpIds = [...expPersonId.values()].filter((v): v is string => !!v);
    const empIbanRows = expEmpIds.length
      ? await db.select({ id: atelierEmployees.id, iban: atelierEmployees.iban })
          .from(atelierEmployees)
          .where(and(eq(atelierEmployees.orgId, me.orgId), inArray(atelierEmployees.id, expEmpIds)))
      : [];
    const empIban = new Map(empIbanRows.map((r) => [r.id, r.iban ?? ""]));
    // Contractors have no registered IBAN in the system (contractorRows still used for firm-path lookup only)

    function resolveBank(it: typeof atelierPaymentRunItems.$inferSelect): { iban: string; swift: string; bankName: string } {
      if (it.itemType === "partner_firm_invoice") {
        const inv = pfInvMap.get(it.refId);
        if (inv?.partnerFirmId) {
          // Registered partner firm: use the finance-approved firm bank registry
          const pf = pfBank.get(inv.partnerFirmId);
          return { iban: pf?.bankIban ?? "", swift: pf?.bankSwift ?? "", bankName: pf?.bankName ?? "" };
        }
        // One-off supplier (Task #1075): bank details stored on the invoice itself
        return { iban: inv?.supplierBankIban ?? "", swift: "", bankName: inv?.supplierBankHolder ?? "" };
      }
      if (it.itemType === "expense_reimbursement") {
        const empId = expPersonId.get(it.refId);
        return { iban: empId ? (empIban.get(empId) ?? "") : "", swift: "", bankName: "" };
      }
      if (it.itemType === "self_billed_invoice") {
        const info = sbiInfo.get(it.refId);
        if (!info) return { iban: "", swift: "", bankName: "" };
        if (info.supplierType === "partner_firm") {
          const pf = pfBank.get(info.supplierId);
          return { iban: pf?.bankIban ?? "", swift: pf?.bankSwift ?? "", bankName: pf?.bankName ?? "" };
        }
        // Contractor self-billed: contractors have no system IBAN — blank for manual fill-in
        return { iban: "", swift: "", bankName: "" };
      }
      return { iban: "", swift: "", bankName: "" };
    }

    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const csvLines = [
      "Beneficiary Name,IBAN,Amount,Currency,Reference,SWIFT Code,Bank Name",
      ...items.map((it) => {
        const bank = resolveBank(it);
        const ref = `${run.runNumber} - ${it.description}`.slice(0, 140);
        return [esc(it.payeeName), esc(bank.iban), it.amount.toFixed(2), it.currency, esc(ref), esc(bank.swift), esc(bank.bankName)].join(",");
      }),
    ];
    const missingIban = items.filter((it) => !resolveBank(it).iban).map((it) => it.payeeName);

    if (run.status === "approved") {
      await db.update(atelierPaymentRuns).set({ status: "exported", exportedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierPaymentRuns.id, run.id));
    }
    await audit({
      entityType: "payment_run", entityId: run.id, actor: me,
      action: "finance.payment_run.export_wio",
      payload: { runNumber: run.runNumber, itemCount: items.length, missingIban },
      summary: `Exported Wio bulk payment file for run ${run.runNumber} (${items.length} item(s)${missingIban.length ? `; ${missingIban.length} missing IBAN` : ""}).`,
    });

    const filename = `WIO-${run.runNumber}-${today}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));
    res.send(csvLines.join("\r\n"));
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/mark-paid", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status !== "approved" && run.status !== "exported") {
      res.status(409).json({ error: "invalid-status", message: "Run must be dual-signed (approved/exported) before it can be marked paid." });
      return;
    }
    const refMap: Record<string, string> = {};
    if (req.body?.remittanceRefs && typeof req.body.remittanceRefs === "object") {
      for (const [k, v] of Object.entries(req.body.remittanceRefs as Record<string, unknown>)) {
        if (typeof v === "string") refMap[k] = v.slice(0, 200);
      }
    }
    const defaultRef = typeof req.body?.remittanceRef === "string" ? req.body.remittanceRef.slice(0, 200) : run.runNumber;
    const items = await db.select().from(atelierPaymentRunItems)
      .where(and(eq(atelierPaymentRunItems.runId, run.id), eq(atelierPaymentRunItems.status, "pending")));
    const now = new Date();
    const paidInvoiceIds: string[] = [];
    for (const it of items) {
      const ref = refMap[it.id] ?? refMap[it.refId] ?? defaultRef;
      await db.update(atelierPaymentRunItems).set({
        status: "paid", remittanceRef: ref, paidAt: now, updatedAt: now,
      }).where(eq(atelierPaymentRunItems.id, it.id));
      if (it.itemType === "self_billed_invoice") {
        const [inv] = await db.select().from(atelierSelfBilledInvoices)
          .where(eq(atelierSelfBilledInvoices.id, it.refId));
        if (inv) {
          await db.update(atelierSelfBilledInvoices).set({
            status: "paid", paidAt: now, remittanceRef: ref, updatedAt: now,
          }).where(eq(atelierSelfBilledInvoices.id, inv.id));
          if ((inv.contractorPaymentIds ?? []).length > 0) {
            await db.update(atelierContractorPayments).set({
              status: "paid", paidAt: now, paidByUserId: me.id, updatedAt: now,
            }).where(inArray(atelierContractorPayments.id, inv.contractorPaymentIds));
          }
          if ((inv.partnerFirmInvoiceIds ?? []).length > 0) {
            await db.update(atelierPartnerFirmInvoices).set({
              status: "paid", paidAt: now, paidByUserId: me.id, updatedAt: now,
            }).where(inArray(atelierPartnerFirmInvoices.id, inv.partnerFirmInvoiceIds));
          }
          paidInvoiceIds.push(inv.id);
        }
      } else if (it.itemType === "expense_reimbursement") {
        await db.update(atelierExpenses).set({
          status: "reimbursed", reimbursedAt: now, updatedAt: now,
        }).where(and(eq(atelierExpenses.id, it.refId), eq(atelierExpenses.status, "approved")));
      } else if (it.itemType === "partner_firm_invoice") {
        // Task #875 — partner-submitted AP invoice settled with the run.
        await db.update(atelierPartnerFirmInvoices).set({
          status: "paid", paidAt: now, paidByUserId: me.id, remittanceRef: ref, updatedAt: now,
        }).where(and(eq(atelierPartnerFirmInvoices.id, it.refId), eq(atelierPartnerFirmInvoices.status, "scheduled")));
      }
    }
    await db.update(atelierPaymentRuns).set({ status: "paid", paidAt: now, updatedAt: now })
      .where(eq(atelierPaymentRuns.id, run.id));
    await audit({
      entityType: "payment_run", entityId: run.id, actor: me,
      action: "finance.payment_run.mark_paid",
      payload: { runNumber: run.runNumber, itemCount: items.length, totalUsd: run.totalUsd },
      summary: `Marked payment run ${run.runNumber} paid: ${items.length} item(s), $${run.totalUsd.toFixed(2)}; remittance recorded.`,
    });
    // Remittance advice to each supplier (PDF attached, status recorded
    // per invoice). Sequential — runs are small; failures never block.
    const emails = [];
    for (const invId of paidInvoiceIds) {
      emails.push(
        await notifySupplierOfInvoice(invId, "remittance", {
          actor: { name: me.name, email: me.email },
        }),
      );
    }
    res.json({ ok: true, itemsPaid: items.length, emails });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/cancel", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const run = await loadRun(me, req.params.id);
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status === "paid" || run.status === "cancelled") {
      res.status(409).json({ error: "invalid-status", message: `Run is already ${run.status}.` });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
    const now = new Date();
    const items = await db.select().from(atelierPaymentRunItems)
      .where(and(eq(atelierPaymentRunItems.runId, run.id), eq(atelierPaymentRunItems.status, "pending")));
    for (const it of items) {
      await db.update(atelierPaymentRunItems).set({ status: "removed", updatedAt: now })
        .where(eq(atelierPaymentRunItems.id, it.id));
      if (it.itemType === "self_billed_invoice") {
        // Release the invoice back to approved so it can join a new run.
        await db.update(atelierSelfBilledInvoices).set({
          status: "approved", paymentRunId: null, updatedAt: now,
        }).where(and(eq(atelierSelfBilledInvoices.id, it.refId), eq(atelierSelfBilledInvoices.status, "scheduled")));
      } else if (it.itemType === "partner_firm_invoice") {
        // Task #875 — release the partner invoice back to approved.
        await db.update(atelierPartnerFirmInvoices).set({
          status: "approved", paymentRunId: null, updatedAt: now,
        }).where(and(eq(atelierPartnerFirmInvoices.id, it.refId), eq(atelierPartnerFirmInvoices.status, "scheduled")));
      }
    }
    await db.update(atelierPaymentRuns).set({
      status: "cancelled", cancelledAt: now, cancelledByUserId: me.id, cancelReason: reason, updatedAt: now,
    }).where(eq(atelierPaymentRuns.id, run.id));
    await audit({
      entityType: "payment_run", entityId: run.id, actor: me,
      action: "finance.payment_run.cancel",
      payload: { runNumber: run.runNumber, reason },
      summary: `Cancelled payment run ${run.runNumber}; ${items.length} item(s) released.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/bank-accounts", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierBankAccount)
      .where(and(eq(atelierBankAccount.orgId, me.orgId), eq(atelierBankAccount.isActive, true), isNull(atelierBankAccount.deletedAt)));
    res.json({
      items: rows.map((b) => ({
        id: b.id,
        label: `${b.bankName} · ${b.accountLabel} ····${b.accountNumberLast4}`,
        currency: b.currency,
      })),
    });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/payment-runs/:id/check", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// -------
// WHT register
// -------
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/wht", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [], remittance: [] });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/issue", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/send", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/wht/:id/acknowledge", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// -------
// Audit trail
// -------
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/audit", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// -------
// Task #875 — Partner-submitted AP invoices (finance review surface)
// -------

function partnerInvoiceWire(
  row: typeof atelierPartnerFirmInvoices.$inferSelect,
  hasBankDetails?: boolean,
) {
  return {
    id: row.id,
    partnerFirmId: row.partnerFirmId,
    partnerFirmName: row.partnerFirmName,
    reference: row.reference,
    periodLabel: row.periodLabel,
    invoiceDate: row.invoiceDate,
    amount: row.costAmount,
    currency: row.costCurrency,
    usdAmount: row.usdAmount,
    status: row.status,
    notes: row.notes,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    paymentRunId: row.paymentRunId,
    remittanceRef: row.remittanceRef,
    paidAt: row.paidAt?.toISOString() ?? null,
    ...(hasBankDetails === undefined ? {} : { hasBankDetails }),
  };
}

// @cli-skip: Task #875 finance review surface; UI-only raw-fetch wiring
router.get("/finance/payables/partner-invoices", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      eq(atelierPartnerFirmInvoices.source, "partner_submitted"),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    )).orderBy(desc(atelierPartnerFirmInvoices.createdAt));
    const firmIds = [...new Set(rows.map((r) => r.partnerFirmId))];
    const firms = firmIds.length
      ? await db.select({ id: atelierPartnerFirms.id, bankIban: atelierPartnerFirms.bankIban })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const bankById = new Map(firms.map((f) => [f.id, Boolean((f.bankIban ?? "").trim())]));
    res.json({ items: rows.map((r) => partnerInvoiceWire(r, bankById.get(r.partnerFirmId) ?? false)) });
  } catch (err) { next(err); }
});

async function loadPartnerInvoice(orgId: string, id: string) {
  const [row] = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.id, id),
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    eq(atelierPartnerFirmInvoices.source, "partner_submitted"),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ));
  return row ?? null;
}

// @cli-skip: Task #875 binary download; not CLI-exposable
router.get("/finance/payables/partner-invoices/:id/file", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const row = await loadPartnerInvoice(me.orgId, req.params.id);
    if (!row || !row.blobRef) { res.status(404).json({ error: "not-found" }); return; }
    const bytes = await loadContractBytes(row.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", row.mime ?? "application/pdf");
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", row.fileName ?? `${row.id}.pdf`),
    );
    res.send(bytes);
  } catch (err) { next(err); }
});

/** Legal review transitions for partner-submitted invoices. */
const PARTNER_INVOICE_REVIEW: Record<string, string[]> = {
  start_review: ["submitted"],
  approve: ["submitted", "under_review"],
  reject: ["submitted", "under_review"],
};

// @cli-skip: Task #875 audited finance write; UI-workflow only
router.post("/finance/payables/partner-invoices/:id/review", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const decision = typeof req.body?.decision === "string" ? req.body.decision : "";
    const allowedFrom = PARTNER_INVOICE_REVIEW[decision];
    if (!allowedFrom) { res.status(400).json({ error: "invalid-decision" }); return; }
    const row = await loadPartnerInvoice(me.orgId, req.params.id);
    if (!row) { res.status(404).json({ error: "not-found" }); return; }
    if (!allowedFrom.includes(row.status)) {
      res.status(409).json({ error: "invalid-status", status: row.status });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000).trim() : "";
    const now = new Date();
    if (decision === "start_review") {
      await db.update(atelierPartnerFirmInvoices).set({
        status: "under_review", reviewedByUserId: me.id, updatedAt: now,
      }).where(eq(atelierPartnerFirmInvoices.id, row.id));
    } else if (decision === "approve") {
      // Payments only ever go to finance-approved firm bank details —
      // block approval until onboarding recorded an IBAN for the firm.
      const [firm] = await db.select({ bankIban: atelierPartnerFirms.bankIban })
        .from(atelierPartnerFirms)
        .where(and(eq(atelierPartnerFirms.id, row.partnerFirmId), eq(atelierPartnerFirms.orgId, me.orgId)));
      if (!firm || !(firm.bankIban ?? "").trim()) {
        res.status(409).json({ error: "bank-details-missing", message: "The firm has no finance-approved bank details yet; approve is blocked until onboarding records them." });
        return;
      }
      await db.update(atelierPartnerFirmInvoices).set({
        status: "approved", reviewedByUserId: me.id, reviewedAt: now, updatedAt: now,
      }).where(eq(atelierPartnerFirmInvoices.id, row.id));
    } else {
      if (!reason) { res.status(400).json({ error: "reason-required", message: "A rejection reason is required." }); return; }
      await db.update(atelierPartnerFirmInvoices).set({
        status: "rejected", reviewedByUserId: me.id, reviewedAt: now,
        rejectedAt: now, rejectedReason: reason, updatedAt: now,
      }).where(eq(atelierPartnerFirmInvoices.id, row.id));
    }
    await audit({
      entityType: "partner_firm_invoice", entityId: row.id, actor: me,
      action: `finance.partner_invoice.${decision}`,
      payload: { partnerFirmId: row.partnerFirmId, reference: row.reference, amount: row.costAmount, currency: row.costCurrency, ...(reason ? { reason } : {}) },
      summary: `${decision === "start_review" ? "Started review of" : decision === "approve" ? "Approved" : "Rejected"} partner invoice ${row.reference ?? row.id} from ${row.partnerFirmName}.`,
    });
    const updated = await loadPartnerInvoice(me.orgId, row.id);
    res.json({ ok: true, invoice: updated ? partnerInvoiceWire(updated) : null });
  } catch (err) { next(err); }
});

// -------
// Task #1070 — Internal supplier-invoice upload (source "internal_upload")
// -------
//
// Finance-side upload of supplier invoices received outside the partner
// portal. Rows live in atelier_partner_firm_invoices distinguished by
// source = "internal_upload" so partner-portal submissions stay separate.
// Same status model (submitted → under_review → approved/rejected →
// scheduled → paid), same USD conversion, SHA-256 dedupe and audit trail.
// If the supplier matches a registered partner firm, the row may be
// linked to it (partnerFirmId) and the firm bank-details hold applies at
// approve + payment-run build; unlinked suppliers carry no hold.

const supplierUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONTRACT_MAX_BYTES },
});
function supplierUploadSingle(req: Request, res: Response, cb: () => void): void {
  supplierUpload.single("file")(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: "upload-failed", message: err.message });
      return;
    }
    if (err) { res.status(400).json({ error: "upload-failed" }); return; }
    cb();
  });
}

function looksLikePdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString("latin1").startsWith("%PDF-");
}

function bodyStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// ------------------------------------------------------------
// Task #1075 — one-off supplier bank details (unlinked invoices).
// Registered partner firms keep bank details on the firm registry
// (maker-checker); unlinked suppliers record IBAN + holder on the
// invoice row so payment-run exports carry verified payee details.
// ------------------------------------------------------------

/** Bank-credential exposure rule: IBAN/holder only for fp/partner/finance. */
function canSeeBankDetails(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
}

/** Normalize + shape-check an IBAN. Returns null when invalid. */
function normalizeIban(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const iban = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : null;
}

function maskIban(iban: string): string {
  return iban.length > 8 ? `${iban.slice(0, 4)}····${iban.slice(-4)}` : "····";
}

/** Task #1104 — autopilot attribution surfaced on approved invoices.
 * The attribution is stored on the approve AUDIT event (payload.autopilot,
 * Task #1091), never as invoice columns — this reads the latest approve
 * event per invoice and keeps only autopilot-attributed ones. Rows whose
 * status has since left approved/scheduled simply won't be asked about. */
export type SupplierAutopilotAttribution = {
  agentName: string;
  agentRunId: string | null;
  at: string | null;
};
export async function loadSupplierAutopilotAttribution(
  orgId: string,
  invoiceIds: string[],
): Promise<Map<string, SupplierAutopilotAttribution>> {
  const out = new Map<string, SupplierAutopilotAttribution>();
  if (invoiceIds.length === 0) return out;
  const events = await db.select({
    entityId: atelierAuditEvents.entityId,
    payload: atelierAuditEvents.payload,
    createdAt: atelierAuditEvents.createdAt,
  }).from(atelierAuditEvents).where(and(
    eq(atelierAuditEvents.orgId, orgId),
    eq(atelierAuditEvents.entityType, "partner_firm_invoice"),
    eq(atelierAuditEvents.action, "finance.supplier_invoice.approve"),
    inArray(atelierAuditEvents.entityId, invoiceIds),
  )).orderBy(desc(atelierAuditEvents.createdAt));
  // Latest approve event wins per invoice: if the newest approve was a
  // human click, an OLDER autopilot approve (since un-approved) must not
  // resurface — so track "seen" separately from "attributed".
  const seen = new Set<string>();
  for (const ev of events) {
    if (seen.has(ev.entityId)) continue;
    seen.add(ev.entityId);
    const autopilot = (ev.payload as { autopilot?: { agentName?: unknown; agentRunId?: unknown } | null })?.autopilot;
    if (!autopilot || typeof autopilot !== "object") continue;
    out.set(ev.entityId, {
      agentName: typeof autopilot.agentName === "string" && autopilot.agentName ? autopilot.agentName : "Finance Autopilot",
      agentRunId: typeof autopilot.agentRunId === "string" ? autopilot.agentRunId : null,
      at: ev.createdAt?.toISOString() ?? null,
    });
  }
  return out;
}

function supplierInvoiceWire(
  row: typeof atelierPartnerFirmInvoices.$inferSelect,
  hasBankDetails?: boolean,
  autopilot?: SupplierAutopilotAttribution | null,
  /** Task #1075 — bank-credential exposure rule: pass the viewer so the
   * recorded supplier IBAN/holder are redacted outside fp/partner/finance. */
  viewer?: Me,
) {
  const exposeBank = viewer ? canSeeBankDetails(viewer) : false;
  return {
    id: row.id,
    supplierName: row.partnerFirmName,
    partnerFirmId: row.partnerFirmId || null,
    legalEntityId: row.legalEntityId ?? null,
    reference: row.reference,
    periodLabel: row.periodLabel,
    invoiceDate: row.invoiceDate,
    amount: row.costAmount,
    currency: row.costCurrency,
    usdAmount: row.usdAmount,
    status: row.status,
    notes: row.notes,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    paymentRunId: row.paymentRunId,
    remittanceRef: row.remittanceRef,
    paidAt: row.paidAt?.toISOString() ?? null,
    // Task #1250 — parsed line items + proof-of-payment receipt metadata
    // (blob ref stays server-side; the wire carries descriptive fields only).
    lineItems: row.lineItems ?? null,
    paymentReceipt: row.paymentReceipt
      ? {
          fileName: row.paymentReceipt.fileName,
          sizeBytes: row.paymentReceipt.sizeBytes,
          attachedAt: row.paymentReceipt.attachedAt,
          matchedBy: row.paymentReceipt.matchedBy,
          // Authenticated download path for the stored proof of payment.
          downloadPath: `/finance/payables/supplier-invoices/${row.id}/receipt`,
        }
      : null,
    // Task #1095 — entity-allocation lifecycle.
    allocStatus: row.allocStatus,
    allocRuleId: row.allocRuleId,
    allocJustification: row.allocJustification,
    allocConfidence: row.allocConfidence,
    allocDecidedBy: row.allocDecidedBy,
    allocShared: row.allocShared,
    allocOverrideReason: row.allocOverrideReason,
    // Unlinked suppliers have no firm bank registry — no hold applies.
    hasBankDetails: hasBankDetails ?? !row.partnerFirmId,
    // Task #1075 — recorded one-off supplier bank details. Boolean is safe
    // for everyone; the credentials themselves follow the exposure rule.
    hasSupplierBankDetails: Boolean((row.supplierBankIban ?? "").trim()),
    supplierBankIban: exposeBank ? row.supplierBankIban : null,
    supplierBankHolder: exposeBank ? row.supplierBankHolder : null,
    // Task #1104 — autopilot attribution (from the approve audit event)
    // so founders can spot auto-approved invoices and pull them back.
    autopilot: autopilot ?? null,
  };
}

// @cli-skip: Task #1070 finance review surface; UI-only raw-fetch wiring
router.get("/finance/payables/supplier-invoices", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const conds = [
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      eq(atelierPartnerFirmInvoices.source, "internal_upload"),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    ];
    if (status) conds.push(eq(atelierPartnerFirmInvoices.status, status));
    const rows = await db.select().from(atelierPartnerFirmInvoices)
      .where(and(...conds))
      .orderBy(desc(atelierPartnerFirmInvoices.createdAt));
    const firmIds = [...new Set(rows.map((r) => r.partnerFirmId).filter((id) => id))];
    const firms = firmIds.length
      ? await db.select({ id: atelierPartnerFirms.id, bankIban: atelierPartnerFirms.bankIban })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const bankById = new Map(firms.map((f) => [f.id, Boolean((f.bankIban ?? "").trim())]));
    // Task #1104 — attribution only matters while the approval is live
    // (approved / scheduled); rejected or re-reviewed rows drop the badge.
    const autopilotById = await loadSupplierAutopilotAttribution(
      me.orgId,
      rows.filter((r) => r.status === "approved" || r.status === "scheduled" || r.status === "paid").map((r) => r.id),
    );
    res.json({
      items: rows.map((r) =>
        supplierInvoiceWire(
          r,
          r.partnerFirmId ? (bankById.get(r.partnerFirmId) ?? false) : undefined,
          autopilotById.get(r.id) ?? null,
          me,
        ),
      ),
    });
  } catch (err) { next(err); }
});

// @cli-skip: Task #1145 — bank-detail hint for the upload form (fp/partner/finance only)
router.get("/finance/payables/supplier-invoices/bank-hint", async (req, res, next) => {
  try {
    // Exposure rule: only roles that can see raw IBAN/holder may receive the hint.
    const me = writeGate(req, res);
    if (!me) return;
    if (!canSeeBankDetails(me)) { res.status(403).json({ error: "forbidden" }); return; }
    const raw = typeof req.query.supplierName === "string" ? req.query.supplierName.trim() : "";
    if (!raw) { res.json({ hint: null }); return; }
    // Look up the most recent non-rejected unlinked internal_upload invoice
    // whose normalized name matches. "Unlinked" means partnerFirmId = '' (the
    // sentinel used at insert time — registered firms manage bank details on
    // the firm registry, not per-invoice).
    const [match] = await db
      .select({
        id: atelierPartnerFirmInvoices.id,
        supplierBankIban: atelierPartnerFirmInvoices.supplierBankIban,
        supplierBankHolder: atelierPartnerFirmInvoices.supplierBankHolder,
        submittedAt: atelierPartnerFirmInvoices.submittedAt,
      })
      .from(atelierPartnerFirmInvoices)
      .where(and(
        eq(atelierPartnerFirmInvoices.orgId, me.orgId),
        eq(atelierPartnerFirmInvoices.source, "internal_upload"),
        eq(atelierPartnerFirmInvoices.partnerFirmId, ""),   // unlinked only
        ne(atelierPartnerFirmInvoices.status, "rejected"),
        isNull(atelierPartnerFirmInvoices.deletedAt),
        sql`lower(${atelierPartnerFirmInvoices.partnerFirmName}) = lower(${raw})`,
      ))
      .orderBy(desc(atelierPartnerFirmInvoices.submittedAt))
      .limit(1);

    if (!match || !(match.supplierBankIban ?? "").trim()) {
      res.json({ hint: null });
      return;
    }
    res.json({
      hint: {
        invoiceId: match.id,
        supplierBankIban: match.supplierBankIban,
        supplierBankHolder: match.supplierBankHolder,
        fromDate: match.submittedAt?.toISOString().slice(0, 10) ?? null,
      },
    });
  } catch (err) { next(err); }
});

// @cli-skip: Task #1070 UI helper for the upload form's firm selector
router.get("/finance/payables/supplier-invoices/firms", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const firms = await db.select({
      id: atelierPartnerFirms.id,
      name: atelierPartnerFirms.name,
      bankIban: atelierPartnerFirms.bankIban,
    })
      .from(atelierPartnerFirms)
      .where(and(eq(atelierPartnerFirms.orgId, me.orgId), isNull(atelierPartnerFirms.deletedAt)))
      .orderBy(atelierPartnerFirms.name);
    // Bank-credential exposure rule: never leak the IBAN itself here —
    // only a boolean the form uses to warn about the approval hold.
    res.json({
      items: firms.map((f) => ({ id: f.id, name: f.name, hasBankDetails: Boolean((f.bankIban ?? "").trim()) })),
    });
  } catch (err) { next(err); }
});

/**
 * Task #1090 — shared supplier-invoice creation core. The exact same
 * validation / firm-link / advisory-lock dedupe / insert / audit path
 * runs whether the invoice arrives via the UI multipart upload below
 * or via the Riser chat ingest capability, so chat commits land in the
 * identical payables review states as UI uploads.
 *
 * Returns an HTTP-shaped `{ status, body }` outcome the route streams
 * verbatim; chat callers translate the same statuses (409 duplicate is
 * reported as "already filed", never as an error).
 */
export async function createSupplierInvoiceCore(args: {
  me: Me;
  fileBuffer: Buffer;
  fileName: string;
  supplierName: string;
  amount: number;
  currency: string;
  reference: string;
  periodLabel?: string | null;
  invoiceDate?: string | null;
  notes?: string | null;
  partnerFirmId?: string | null;
  /** Task #1075 — optional one-off supplier bank details (unlinked only).
   * Registered partner firms keep bank details on the firm registry. */
  supplierBankIban?: string | null;
  supplierBankHolder?: string | null;
  /** Task #1250 — printed line items parsed from the document (chat
   * ingest); stored verbatim, null when the invoice has no itemization. */
  lineItems?: Array<{ description: string; qty: number | null; unitAmount: number | null; amount: number | null }> | null;
  /** Task #1250 — proof-of-payment receipt paired at ingest time. When
   * set, the invoice is recorded already-paid (status "paid"): it never
   * enters the review→approve→payment-run path, so the same bill can't
   * be paid twice. Callers MUST have verified the receipt visibly
   * matches the invoice (reference or exact amount) before passing it. */
  paymentReceipt?: {
    fileBuffer: Buffer;
    fileName: string;
    mime?: string | null;
    matchedBy: "reference";
  } | null;
  /** Task #1095 — user picked the entity allocation up-front (chat card). */
  explicitLegalEntityId?: string | null;
  /**
   * Task #1092 — optional legal-entity attribution (incl. in_formation
   * entities: pre-formation cost pools quarantined by the Bookkeeper).
   * Validated (404 on unknown/archived) and fed to the allocation engine
   * as the explicit user choice.
   */
  legalEntityId?: string | null;
  /** Audit provenance: "ui_upload" (default), "chat", or "parsed_doc"
   * (the AI finance-doc pipeline). Only the parsed-doc path can carry the
   * per-field confidences that let the auto-post engine authorise an
   * auto-advance; ui/chat uploads never auto (no confidence signal). */
  via?: "ui_upload" | "chat" | "parsed_doc";
  /** parsed_doc only: per-key-field extraction confidences (0..1). ALL must
   * clear the founder threshold for the invoice to auto-advance. */
  fieldConfidences?: number[];
  /** parsed_doc only: the agent run that parsed/coded the document, for
   * autopilot attribution on the auto-advance. */
  agentRunId?: string | null;
  agentName?: string | null;
  /** Task #1251 — suppress the async tooling-mining trigger so a caller that
   * runs extraction SYNCHRONOUSLY itself (e.g. the backfill script) is the
   * only run. Without this the async trigger + the caller's sync call could
   * race two full split proposals for the same fresh invoice. Default false
   * (normal uploads keep the fire-and-forget trigger). */
  skipToolingMining?: boolean;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  if (!args.fileBuffer || args.fileBuffer.length === 0) {
    return { status: 400, body: { error: "file-required" } };
  }
  if (!looksLikePdf(args.fileBuffer)) {
    return { status: 400, body: { error: "pdf-required", message: "Invoice must be a PDF." } };
  }
  const supplierName = bodyStr(args.supplierName, 200);
  if (!supplierName) return { status: 400, body: { error: "supplier-name-required" } };
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return { status: 400, body: { error: "invalid-amount" } };
  }
  const currency = bodyStr(args.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { status: 400, body: { error: "invalid-currency" } };
  const reference = bodyStr(args.reference, 100);
  if (!reference) return { status: 400, body: { error: "reference-required" } };
  const periodLabel = bodyStr(args.periodLabel ?? "", 60) || null;
  const invoiceDate = bodyStr(args.invoiceDate ?? "", 10) || null;
  const notes = bodyStr(args.notes ?? "", 2000) || null;
  // Optional link to a registered partner firm (org-scoped).
  const wantFirmId = bodyStr(args.partnerFirmId ?? "", 100);
  let firm: { id: string; name: string } | null = null;
  if (wantFirmId) {
    const [f] = await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
      .from(atelierPartnerFirms)
      .where(and(
        eq(atelierPartnerFirms.id, wantFirmId),
        eq(atelierPartnerFirms.orgId, me.orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ));
    if (!f) return { status: 404, body: { error: "partner-firm-not-found" } };
    firm = f;
  }
  // Task #1075 — optional bank details for one-off (unlinked) suppliers.
  // Rejected outright for firm-linked uploads: firm bank details flow only
  // via the maker-checker registry, never per-invoice.
  const rawIban = typeof args.supplierBankIban === "string" ? args.supplierBankIban.trim() : "";
  const supplierBankHolder = bodyStr(args.supplierBankHolder ?? "", 200) || null;
  let supplierBankIban: string | null = null;
  if (rawIban || supplierBankHolder) {
    if (firm) {
      return { status: 400, body: { error: "firm-linked-bank-details", message: "Bank details for registered partner firms are managed on the firm registry, not per invoice." } };
    }
    supplierBankIban = normalizeIban(rawIban);
    if (!supplierBankIban) return { status: 400, body: { error: "invalid-iban", message: "Supplier IBAN is not a valid IBAN." } };
    if (!supplierBankHolder) return { status: 400, body: { error: "holder-required", message: "Account holder name is required with the IBAN." } };
  }

  // Task #1092 — optional entity attribution (non-archived org entity;
  // in_formation is explicitly allowed for pre-formation pools).
  const wantEntityId = bodyStr(args.legalEntityId ?? "", 100);
  let taggedEntityId: string | null = null;
  if (wantEntityId) {
    const [ent] = await db.select({
      id: atelierLegalEntities.id,
      status: atelierLegalEntities.status,
      formation: atelierLegalEntities.formation,
    })
      .from(atelierLegalEntities)
      .where(and(
        eq(atelierLegalEntities.id, wantEntityId),
        eq(atelierLegalEntities.orgId, me.orgId),
      ));
    if (!ent || ent.status === "archived") {
      return { status: 404, body: { error: "entity-not-found" } };
    }
    // A settled pre-formation pool is closed for new costs.
    if (ent.status === "in_formation" && ent.formation?.settlement) {
      return { status: 400, body: { error: "entity-pool-settled" } };
    }
    taggedEntityId = ent.id;
  }

  const now = new Date();
  // Hash BEFORE storing anything — the blob is only persisted once
  // dedupe has passed (no orphan blobs on 409).
  const sha256 = createHash("sha256").update(args.fileBuffer).digest("hex");
  const fx = await convertToUsd(amount, currency, now);
  const id = rid("spi");

  // Duplicate detection: same file bytes (sha256) or same
  // supplier+reference among live (non-rejected) AP rows of any
  // source — flagged as 409 with the existing row so a second
  // payable is never created silently. The check + insert run in
  // one transaction behind a per-org advisory lock, so two
  // concurrent uploads of the same invoice serialize instead of
  // both observing "no duplicate" and double-inserting. Rejected
  // rows deliberately don't block re-upload.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`atelier_supplier_invoice_upload:${me.orgId}`}))`,
    );
    const [dupe] = await tx.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      inArray(atelierPartnerFirmInvoices.source, ["partner_submitted", "internal_upload"]),
      ne(atelierPartnerFirmInvoices.status, "rejected"),
      isNull(atelierPartnerFirmInvoices.deletedAt),
      or(
        eq(atelierPartnerFirmInvoices.sha256, sha256),
        and(
          sql`lower(${atelierPartnerFirmInvoices.partnerFirmName}) = lower(${firm?.name ?? supplierName})`,
          sql`lower(${atelierPartnerFirmInvoices.reference}) = lower(${reference})`,
        ),
      ),
    )).limit(1);
    if (dupe) return { dupe } as const;
    const { blobRef } = await storeContractBytes(args.fileBuffer);
    // Task #1250 — paired proof-of-payment receipt: store the receipt
    // blob and record the invoice already-paid, all in the same insert,
    // so there is never a moment where the bill looks payable.
    let paymentReceipt: typeof atelierPartnerFirmInvoices.$inferInsert["paymentReceipt"] = null;
    if (args.paymentReceipt) {
      const stored = await storeContractBytes(args.paymentReceipt.fileBuffer);
      paymentReceipt = {
        fileName: args.paymentReceipt.fileName.slice(0, 300),
        mime: args.paymentReceipt.mime ?? null,
        sizeBytes: args.paymentReceipt.fileBuffer.length,
        sha256: createHash("sha256").update(args.paymentReceipt.fileBuffer).digest("hex"),
        blobRef: stored.blobRef,
        attachedAt: now.toISOString(),
        attachedByUserId: me.id,
        matchedBy: args.paymentReceipt.matchedBy,
      };
    }
    await tx.insert(atelierPartnerFirmInvoices).values({
      id,
      orgId: me.orgId,
      // Unlinked suppliers store "" — the column is NOT NULL and ""
      // is the sentinel for "not a registered partner firm".
      partnerFirmId: firm?.id ?? "",
      partnerFirmName: firm?.name ?? supplierName,
      // Task #1092 — explicit tag stamped up-front so pre-formation
      // quarantine holds even if the allocation proposal fails soft.
      legalEntityId: taggedEntityId,
      engagementId: null,
      weekIso: periodLabel ?? invoiceDate ?? now.toISOString().slice(0, 10),
      hours: 0,
      costAmount: amount,
      costCurrency: currency,
      fxRate: fx.rate,
      usdAmount: +fx.usdAmount.toFixed(2),
      // Task #1250 — a receipt-paired invoice is recorded already-paid so
      // it never enters review/approval/payment-run (no double payment).
      status: paymentReceipt ? "paid" : "submitted",
      ...(paymentReceipt ? { paidAt: now, paidByUserId: me.id, paymentReceipt } : {}),
      ...(args.lineItems && args.lineItems.length > 0 ? { lineItems: args.lineItems } : {}),
      source: "internal_upload",
      reference,
      periodLabel,
      invoiceDate,
      submittedByUserId: me.id,
      submittedAt: now,
      fileName: args.fileName.slice(0, 300),
      mime: "application/pdf",
      sizeBytes: args.fileBuffer.length,
      sha256,
      blobRef,
      notes,
      supplierBankIban,
      supplierBankHolder,
    });
    return { dupe: null } as const;
  });
  if (outcome.dupe) {
    const dupe = outcome.dupe;
    return {
      status: 409,
      body: {
        error: "duplicate-invoice",
        matchedBy: dupe.sha256 === sha256 ? "file" : "reference",
        existing: supplierInvoiceWire(dupe, undefined, null, me),
        message: dupe.sha256 === sha256
          ? `This exact PDF was already uploaded (${dupe.reference ?? dupe.id}, status ${dupe.status}).`
          : `An invoice with reference ${reference} from ${dupe.partnerFirmName} already exists (status ${dupe.status}).`,
      },
    };
  }
  // Task #1095 — entity-allocation prefill (deterministic; AI fallback
  // gets the notes/reference text when the rules can't decide). Run this
  // FIRST so the auto-post engine below can see whether allocation
  // resolved cleanly (an unresolved allocation blocks auto-advance).
  await proposeSupplierInvoiceAllocation(id, {
    actorId: me.id,
    explicitEntityId: args.explicitLegalEntityId ?? taggedEntityId ?? null,
    aiText: [`supplier: ${firm?.name ?? supplierName}`, `reference: ${reference}`, notes ? `notes: ${notes}` : null]
      .filter(Boolean).join("\n"),
  }).catch(() => {});

  // Task #1251 — tooling vendor (Replit/Anthropic/Perplexity): mine the
  // stored PDF for per-project line items + propose cost splits. Fire and
  // forget so a slow/failed extraction never blocks the upload response;
  // failures land as an extraction status "failed" on the row.
  if (!args.skipToolingMining && detectVendorKey(firm?.name ?? supplierName)) {
    triggerVendorInvoiceMining(id);
  }

  // Task #1091 — auto-post policy (blueprint §4). The intake decision
  // (auto → approved/"ready to pay" vs founder review) is authorised
  // SOLELY by the shared engine, with thresholds from the founder-editable
  // settings (never hardcoded here). ui_upload / chat carry NO field
  // confidences, so the engine returns auto:false and the invoice stays
  // "submitted" for review — behaviour identical to before. Only the
  // parsed-doc pipeline supplies confidences that can clear the bar.
  const via = args.via ?? "ui_upload";
  const thresholds = await loadFinanceAutopilotThresholds(me.orgId);
  const amountAed = await convertUsdTo(+fx.usdAmount.toFixed(2), "AED", now).catch(() => null);
  const policy = evaluateAutoPost({
    kind: "supplier_invoice",
    thresholds,
    amountAedEquivalent: amountAed ? amountAed.amount : null,
    // Field confidences ONLY exist on the parsed-doc path.
    confidences: via === "parsed_doc" ? (args.fieldConfidences ?? []) : [],
    knownVendor: Boolean(firm?.id),
  });

  // Re-read to observe the allocation outcome the proposal just wrote.
  let row = (await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, id)))[0];

  // Auto-advance is gated by the engine AND by allocation being
  // automatically resolvable (a proposed single-entity allocation). If the
  // allocation needs a human ("needs_input"), the invoice STAYS in review
  // even when the engine said auto — money never moves on a guessed entity.
  let autoAdvanced = false;
  const autoReasons = [...policy.reasons];
  // Task #1250 — a receipt-paired invoice is already paid: never
  // auto-advance it into the approval/payment path.
  if (policy.auto && args.paymentReceipt) {
    autoReasons.push("already paid at ingest (proof-of-payment receipt attached) — no approval path");
  }
  if (policy.auto && !args.paymentReceipt) {
    const allocResolvable = row.allocStatus === "proposed" || row.allocStatus === "approved" || row.allocStatus === "overridden";
    if (!allocResolvable) {
      autoReasons.push(`held for review: allocation ${row.allocStatus ?? "unset"} needs a human decision`);
    } else {
      // Reuse the SAME transition the manual review "approve" performs —
      // bank-details hold, allocation decide, status → approved — so the
      // auto path and the human path never fork. Attributed to autopilot.
      const advanced = await reviewSupplierInvoiceCore({
        me, id, decision: "approve",
        autopilot: { agentRunId: args.agentRunId ?? null, agentName: args.agentName ?? "Finance Autopilot", reasons: autoReasons },
      });
      if (advanced.status === 200) {
        autoAdvanced = true;
        row = (await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, id)))[0];
      } else {
        // e.g. bank-details-missing (409) — legitimately can't auto-advance.
        autoReasons.push(`held for review: ${String((advanced.body as { error?: string }).error ?? "auto-advance blocked")}`);
      }
    }
  }

  await audit({
    entityType: "partner_firm_invoice", entityId: id, actor: me,
    action: "finance.supplier_invoice.upload",
    payload: {
      supplierName: firm?.name ?? supplierName, partnerFirmId: firm?.id ?? null,
      reference, amount, currency, periodLabel, sha256, via,
      ...(args.paymentReceipt ? { paidOnIngest: true, receiptFileName: args.paymentReceipt.fileName, receiptMatchedBy: args.paymentReceipt.matchedBy } : {}),
      ...(args.lineItems && args.lineItems.length > 0 ? { lineItemCount: args.lineItems.length } : {}),
      ...(supplierBankIban ? { supplierBank: { ibanMasked: maskIban(supplierBankIban), holder: supplierBankHolder } } : {}),
      autopilot: { auto: policy.auto, autoAdvanced, finalStatus: row.status, reasons: autoReasons },
    },
    summary: `${me.name} uploaded supplier invoice ${reference} from ${firm?.name ?? supplierName} (${currency} ${amount.toFixed(2)})${autoAdvanced ? " — auto-approved by autopilot" : ""}.`,
  });
  return { status: 201, body: { ok: true, item: supplierInvoiceWire(row, undefined, null, me), autoAdvanced } };
}

/** Task #1090 — chat firm-linking parity: org-scoped case-insensitive
 * exact name match against the partner-firm registry (no fuzzy guessing —
 * an unmatched supplier stays unlinked, same as leaving the UI selector
 * blank). */
export async function findPartnerFirmByName(
  orgId: string,
  name: string,
): Promise<{ id: string; name: string; hasBankDetails: boolean } | null> {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const firms = await db.select({
    id: atelierPartnerFirms.id,
    name: atelierPartnerFirms.name,
    bankIban: atelierPartnerFirms.bankIban,
  })
    .from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.orgId, orgId), isNull(atelierPartnerFirms.deletedAt)));
  const hit = firms.find((f) => f.name.trim().toLowerCase() === wanted);
  return hit
    ? { id: hit.id, name: hit.name, hasBankDetails: Boolean((hit.bankIban ?? "").trim()) }
    : null;
}

// @cli-skip: Task #1070 multipart upload; chat parity via ingest_supplier_invoice capability (Task #1090)
router.post("/finance/payables/supplier-invoices", (req, res, next) => {
  // Gate BEFORE multipart parsing: unauthorized callers must never cause
  // the request body to be buffered into memory.
  const gated = writeGate(req, res);
  if (!gated) return;
  supplierUploadSingle(req, res, async () => {
    try {
      const me = writeGate(req, res);
      if (!me) return;
      const file = req.file;
      if (!file || file.size === 0) { res.status(400).json({ error: "file-required" }); return; }
      const out = await createSupplierInvoiceCore({
        me,
        fileBuffer: file.buffer,
        fileName: file.originalname,
        supplierName: typeof req.body?.supplierName === "string" ? req.body.supplierName : "",
        amount: Number(req.body?.amount),
        currency: typeof req.body?.currency === "string" ? req.body.currency : "",
        reference: typeof req.body?.reference === "string" ? req.body.reference : "",
        periodLabel: typeof req.body?.periodLabel === "string" ? req.body.periodLabel : null,
        invoiceDate: typeof req.body?.invoiceDate === "string" ? req.body.invoiceDate : null,
        notes: typeof req.body?.notes === "string" ? req.body.notes : null,
        partnerFirmId: typeof req.body?.partnerFirmId === "string" ? req.body.partnerFirmId : null,
        legalEntityId: typeof req.body?.legalEntityId === "string" ? req.body.legalEntityId : null,
        supplierBankIban: typeof req.body?.supplierBankIban === "string" ? req.body.supplierBankIban : null,
        supplierBankHolder: typeof req.body?.supplierBankHolder === "string" ? req.body.supplierBankHolder : null,
        via: "ui_upload",
      });
      res.status(out.status).json(out.body);
    } catch (err) { next(err); }
  });
});

async function loadSupplierInvoice(orgId: string, id: string) {
  const [row] = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.id, id),
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    eq(atelierPartnerFirmInvoices.source, "internal_upload"),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ));
  return row ?? null;
}

// @cli-skip: Task #1070 binary download; not CLI-exposable
router.get("/finance/payables/supplier-invoices/:id/file", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const row = await loadSupplierInvoice(me.orgId, req.params.id);
    if (!row || !row.blobRef) { res.status(404).json({ error: "not-found" }); return; }
    const bytes = await loadContractBytes(row.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", row.mime ?? "application/pdf");
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", row.fileName ?? `${row.id}.pdf`),
    );
    res.send(bytes);
  } catch (err) { next(err); }
});

// @cli-skip: Task #1250 binary download (proof-of-payment receipt); not CLI-exposable
router.get("/finance/payables/supplier-invoices/:id/receipt", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const row = await loadSupplierInvoice(me.orgId, req.params.id);
    if (!row || !row.paymentReceipt?.blobRef) { res.status(404).json({ error: "not-found" }); return; }
    const bytes = await loadContractBytes(row.paymentReceipt.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", row.paymentReceipt.mime ?? "application/pdf");
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", row.paymentReceipt.fileName ?? `${row.id}-receipt.pdf`),
    );
    res.send(bytes);
  } catch (err) { next(err); }
});

/** Review transitions — same machine as partner-submitted invoices. */
const SUPPLIER_INVOICE_REVIEW: Record<string, string[]> = {
  start_review: ["submitted"],
  approve: ["submitted", "under_review"],
  reject: ["submitted", "under_review"],
  // Task #1104 — pull an approved (typically autopilot-approved) invoice
  // back to review BEFORE a payment run claims it. Once scheduled/paid the
  // reversal is a run cancellation / credit note, never a status rewind.
  unapprove: ["approved"],
};

/**
 * Task #1091 — shared supplier-invoice review core. The REST route and
 * the Riser chat capability (finance.review_supplier_invoice) BOTH run
 * this so the transition machine, bank-details hold, entity-allocation
 * decision and audit never fork. Returns an HTTP-shaped `{ status, body }`
 * outcome; the caller reads `body.invoice` for the preview/recap.
 *
 * Allocation constraint parity: when the row's allocation still needs a
 * human decision (or the caller overrides the proposed entity), the
 * caller must surface that in preview and pass `legalEntityId`
 * (+ `allocationOverrideReason` when overriding) — exactly the fields the
 * UI review form sends.
 */
export async function reviewSupplierInvoiceCore(args: {
  me: Me;
  id: string;
  decision: string;
  reason?: string | null;
  legalEntityId?: string | null;
  allocationOverrideReason?: string | null;
  /** Task #1075 — record one-off supplier bank details at approve time
   * (unlinked invoices only). Both must be supplied together. */
  supplierBankIban?: string | null;
  supplierBankHolder?: string | null;
  /** Task #1091 — set when the auto-post engine authorised this approve
   * (never a human click). Records autopilot attribution in the audit. */
  autopilot?: { agentRunId: string | null; agentName: string; reasons: string[] } | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const decision = args.decision;
  const allowedFrom = SUPPLIER_INVOICE_REVIEW[decision];
  if (!allowedFrom) return { status: 400, body: { error: "invalid-decision" } };
  const row = await loadSupplierInvoice(me.orgId, args.id);
  if (!row) return { status: 404, body: { error: "not-found" } };
  // Task #1104 — un-approve has a hard reversibility boundary: once a
  // payment run has picked the invoice up, say so explicitly instead of
  // a generic invalid-status.
  if (decision === "unapprove" && (row.paymentRunId || row.status === "scheduled" || row.status === "paid")) {
    return { status: 409, body: {
      error: "in-payment-run",
      message: row.status === "paid"
        ? "This invoice has already been paid — reversal now needs a credit note, not an un-approve."
        : "This invoice is already in a payment run — remove it by cancelling the run; it can no longer be un-approved directly.",
    } };
  }
  if (!allowedFrom.includes(row.status))
    return { status: 409, body: { error: "invalid-status", status: row.status } };
  const reason = typeof args.reason === "string" ? args.reason.slice(0, 2000).trim() : "";
  const now = new Date();
  if (decision === "start_review") {
    await db.update(atelierPartnerFirmInvoices).set({
      status: "under_review", reviewedByUserId: me.id, updatedAt: now,
    }).where(eq(atelierPartnerFirmInvoices.id, row.id));
  } else if (decision === "approve") {
    // Bank-details hold applies when the supplier is a registered
    // partner firm — payments only ever go to finance-approved firm
    // bank details. Unregistered suppliers carry no firm registry;
    // their details are keyed into the bank file at run time.
    if (row.partnerFirmId) {
      const [firm] = await db.select({ bankIban: atelierPartnerFirms.bankIban })
        .from(atelierPartnerFirms)
        .where(and(eq(atelierPartnerFirms.id, row.partnerFirmId), eq(atelierPartnerFirms.orgId, me.orgId)));
      if (!firm || !(firm.bankIban ?? "").trim())
        return { status: 409, body: { error: "bank-details-missing", message: "The linked partner firm has no finance-approved bank details yet; approve is blocked until onboarding records them." } };
    }
    // Task #1075 — optionally record one-off supplier bank details in the
    // same act as approval (unlinked suppliers only; firm-linked invoices
    // pay to registry details).
    const rawIban = typeof args.supplierBankIban === "string" ? args.supplierBankIban.trim() : "";
    const bankHolder = bodyStr(args.supplierBankHolder ?? "", 200) || null;
    if (rawIban || bankHolder) {
      if (row.partnerFirmId)
        return { status: 400, body: { error: "firm-linked-bank-details", message: "Bank details for registered partner firms are managed on the firm registry, not per invoice." } };
      const iban = normalizeIban(rawIban);
      if (!iban) return { status: 400, body: { error: "invalid-iban", message: "Supplier IBAN is not a valid IBAN." } };
      if (!bankHolder) return { status: 400, body: { error: "holder-required", message: "Account holder name is required with the IBAN." } };
      await db.update(atelierPartnerFirmInvoices).set({
        supplierBankIban: iban, supplierBankHolder: bankHolder, updatedAt: now,
      }).where(eq(atelierPartnerFirmInvoices.id, row.id));
      await audit({
        entityType: "partner_firm_invoice", entityId: row.id, actor: me,
        action: "finance.supplier_invoice.bank_details",
        payload: { supplierName: row.partnerFirmName, reference: row.reference, ibanMasked: maskIban(iban), holder: bankHolder },
        summary: `${me.name} recorded bank details for one-off supplier ${row.partnerFirmName} (${maskIban(iban)}).`,
      });
    }
    // Task #1095 — approving the invoice approves (or overrides) its
    // entity allocation in the same act. A different `legalEntityId`
    // than the proposal requires `allocationOverrideReason`.
    if (row.allocStatus === "proposed" || row.allocStatus === "needs_input" || typeof args.legalEntityId === "string") {
      const decided = await decideAllocation({
        kind: "supplier_invoice",
        id: row.id,
        orgId: me.orgId,
        actor: { id: me.id, name: me.name },
        entityId: typeof args.legalEntityId === "string" && args.legalEntityId ? args.legalEntityId : null,
        overrideReason: typeof args.allocationOverrideReason === "string" ? args.allocationOverrideReason : null,
      });
      if (!decided.ok && decided.error !== "entity_required") {
        // needs_input with nothing picked stays queued; real mistakes 400.
        return { status: 400, body: { error: decided.error, message: decided.message } };
      }
      // The autopilot path must NEVER approve on an unresolved allocation
      // (a human clicking approve without picking is the legacy fall-
      // through, but money can't move on a guessed entity under autopilot).
      if (args.autopilot && !decided.ok && decided.error === "entity_required") {
        return { status: 409, body: { error: "allocation-needs-input", message: "Autopilot cannot approve: entity allocation needs a human decision." } };
      }
    }
    await db.update(atelierPartnerFirmInvoices).set({
      status: "approved", reviewedByUserId: me.id, reviewedAt: now, updatedAt: now,
    }).where(eq(atelierPartnerFirmInvoices.id, row.id));
  } else if (decision === "unapprove") {
    // Race-safe against payment-run pickup: the run builder claims rows
    // conditionally on status='approved' AND paymentRunId IS NULL, so this
    // update carries the same predicate — whichever transaction lands
    // second sees zero rows and backs off.
    const pulled = await db.update(atelierPartnerFirmInvoices).set({
      status: "under_review", reviewedByUserId: me.id, reviewedAt: null, updatedAt: now,
    }).where(and(
      eq(atelierPartnerFirmInvoices.id, row.id),
      eq(atelierPartnerFirmInvoices.status, "approved"),
      isNull(atelierPartnerFirmInvoices.paymentRunId),
    )).returning({ id: atelierPartnerFirmInvoices.id });
    if (pulled.length === 0) {
      return { status: 409, body: { error: "in-payment-run", message: "This invoice was just picked up by a payment run — remove it by cancelling the run; it can no longer be un-approved directly." } };
    }
  } else {
    if (!reason) return { status: 400, body: { error: "reason-required", message: "A rejection reason is required." } };
    await db.update(atelierPartnerFirmInvoices).set({
      status: "rejected", reviewedByUserId: me.id, reviewedAt: now,
      rejectedAt: now, rejectedReason: reason, updatedAt: now,
    }).where(eq(atelierPartnerFirmInvoices.id, row.id));
  }
  await audit({
    entityType: "partner_firm_invoice", entityId: row.id, actor: me,
    action: `finance.supplier_invoice.${decision}`,
    payload: {
      supplierName: row.partnerFirmName, reference: row.reference, amount: row.costAmount, currency: row.costCurrency,
      ...(reason ? { reason } : {}),
      ...(args.autopilot ? { autopilot: { agentRunId: args.autopilot.agentRunId, agentName: args.autopilot.agentName, reasons: args.autopilot.reasons } } : {}),
    },
    summary: `${args.autopilot ? `${args.autopilot.agentName} auto-approved` : decision === "start_review" ? "Started review of" : decision === "approve" ? "Approved" : decision === "unapprove" ? "Un-approved (returned to review)" : "Rejected"} supplier invoice ${row.reference ?? row.id} from ${row.partnerFirmName}.`,
  });
  const updated = await loadSupplierInvoice(me.orgId, row.id);
  return { status: 200, body: { ok: true, invoice: updated ? supplierInvoiceWire(updated, undefined, null, me) : null } };
}

// Task #1075 — record/update bank details for a one-off (unlinked)
// supplier invoice before it enters a payment run. Firm-linked invoices
// are rejected (registry is authoritative); once scheduled/paid the
// payee details are frozen with the run.
// @cli-skip: Task #1075 audited finance write; UI-workflow only
router.put("/finance/payables/supplier-invoices/:id/bank-details", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const row = await loadSupplierInvoice(me.orgId, req.params.id);
    if (!row) { res.status(404).json({ error: "not-found" }); return; }
    if (row.partnerFirmId) {
      res.status(400).json({ error: "firm-linked-bank-details", message: "Bank details for registered partner firms are managed on the firm registry, not per invoice." });
      return;
    }
    if (row.status === "scheduled" || row.status === "paid" || row.paymentRunId) {
      res.status(409).json({ error: "in-payment-run", message: "This invoice is already in a payment run — its payee details are frozen; cancel the run to change them." });
      return;
    }
    const iban = normalizeIban(req.body?.iban);
    if (!iban) { res.status(400).json({ error: "invalid-iban", message: "Supplier IBAN is not a valid IBAN." }); return; }
    const holder = bodyStr(req.body?.holder, 200);
    if (!holder) { res.status(400).json({ error: "holder-required", message: "Account holder name is required." }); return; }
    await db.update(atelierPartnerFirmInvoices).set({
      supplierBankIban: iban, supplierBankHolder: holder, updatedAt: new Date(),
    }).where(eq(atelierPartnerFirmInvoices.id, row.id));
    await audit({
      entityType: "partner_firm_invoice", entityId: row.id, actor: me,
      action: "finance.supplier_invoice.bank_details",
      payload: { supplierName: row.partnerFirmName, reference: row.reference, ibanMasked: maskIban(iban), holder },
      summary: `${me.name} recorded bank details for one-off supplier ${row.partnerFirmName} (${maskIban(iban)}).`,
    });
    const updated = await loadSupplierInvoice(me.orgId, row.id);
    res.json({ ok: true, invoice: updated ? supplierInvoiceWire(updated, undefined, null, me) : null });
  } catch (err) { next(err); }
});

// @cli-skip: chat parity via finance.review_supplier_invoice (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/finance/payables/supplier-invoices/:id/review", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const out = await reviewSupplierInvoiceCore({
      me, id: req.params.id,
      decision: typeof req.body?.decision === "string" ? req.body.decision : "",
      reason: req.body?.reason,
      legalEntityId: typeof req.body?.legalEntityId === "string" ? req.body.legalEntityId : null,
      allocationOverrideReason: typeof req.body?.allocationOverrideReason === "string" ? req.body.allocationOverrideReason : null,
      supplierBankIban: typeof req.body?.supplierBankIban === "string" ? req.body.supplierBankIban : null,
      supplierBankHolder: typeof req.body?.supplierBankHolder === "string" ? req.body.supplierBankHolder : null,
    });
    res.status(out.status).json(out.body);
  } catch (err) { next(err); }
});

// -------
// Dashboard tile + inbox producers (Wave-1 wiring)
// -------
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/dashboard/expected-disbursements", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/dashboard/stalled-approvals", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

export default router;

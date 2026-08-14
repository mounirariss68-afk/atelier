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
  atelierExpenses,
  type PaymentRunSignature,
} from "@workspace/db";
import { runSelfBillingClerk } from "../../lib/atelier-agents/selfBillingClerk.js";
import { nextRunNumber } from "../../lib/atelier-agents/selfBillingClerk.js";
import { notifySupplierOfInvoice } from "../../lib/selfBilledInvoiceEmail.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  CONTRACT_MAX_BYTES,
  loadContractBytes,
  storeContractBytes,
} from "../../lib/atelier-contracts.js";
import { convertToUsd } from "../../lib/atelier-fx.js";

type Me = typeof atelierUsers.$inferSelect;
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

// ============================================================
// Vendors
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/vendors", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/vendors/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change/:changeId/oob-confirm", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/vendors/:id/bank-change/:changeId/decide", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "vendor-not-found" });
});

// ============================================================
// Purchase Orders + GRNs
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/po", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/po/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Vendor invoices + 3-way match
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/invoices", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/invoices/:id", (req, res) => {
  if (!readGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/match", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/approve", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/invoices/:id/override", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Self-billed invoices (RCTI) — Task #430
// ============================================================

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
    const result = await runSelfBillingClerk({
      input: { weeksIso: weeksIso?.length ? weeksIso : undefined },
      triggeredByUserId: me.id,
    });
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
router.post("/finance/payables/self-billing/:id/approve", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const inv = await loadInvoice(me, req.params.id);
    if (!inv) { res.status(404).json({ error: "not-found" }); return; }
    if (inv.status !== "draft") {
      res.status(409).json({ error: "invalid-status", message: `Only draft invoices can be approved (status: ${inv.status}).` });
      return;
    }
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
    res.json({ ok: true, email });
  } catch (err) { next(err); }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/self-billing/:id/reject", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const inv = await loadInvoice(me, req.params.id);
    if (!inv) { res.status(404).json({ error: "not-found" }); return; }
    if (inv.status !== "draft" && inv.status !== "disputed" && inv.status !== "approved") {
      res.status(409).json({ error: "invalid-status", message: `Cannot reject an invoice in status ${inv.status}.` });
      return;
    }
    if (inv.paymentRunId) {
      res.status(409).json({ error: "in-payment-run", message: "Remove the invoice from its payment run first." });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
    await db.update(atelierSelfBilledInvoices).set({
      status: "rejected", rejectedByUserId: me.id, rejectedAt: new Date(), rejectedReason: reason, updatedAt: new Date(),
    }).where(eq(atelierSelfBilledInvoices.id, inv.id));
    await audit({
      entityType: "self_billed_invoice", entityId: inv.id, actor: me,
      action: "finance.self_billing.reject",
      payload: { invoiceNumber: inv.invoiceNumber, reason },
      summary: `Rejected self-billed invoice ${inv.invoiceNumber}.`,
    });
    res.json({ ok: true });
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

// ============================================================
// Payment runs (maker-checker + dual signatories + bank-file)
// Task #430 — real implementation over atelier_payment_runs.
// ============================================================

function runWire(run: typeof atelierPaymentRuns.$inferSelect, items?: Array<typeof atelierPaymentRunItems.$inferSelect>) {
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
    return { error: null, runId, runNumber, totalUsd, skippedMissingBank, invoices, expenses, partnerInvoices };
    });
    if (built.error === "no-eligible-items") {
      res.status(409).json({ error: "no-eligible-items", message: "No approved self-billed invoices, partner invoices or unreimbursed approved expenses available." });
      return;
    }
    const { runId, runNumber, totalUsd, skippedMissingBank, invoices, expenses, partnerInvoices } = built;
    await audit({
      entityType: "payment_run", entityId: runId, actor: me,
      action: "finance.payment_run.build",
      payload: { runNumber, bankAccountId: bank.id, invoices: invoices.map((i) => i.id), expenses: expenses.map((e) => e.id), partnerInvoices: partnerInvoices.map((p) => p.id), skippedMissingBank, totalUsd },
      summary: `Built payment run ${runNumber}: ${invoices.length} invoice(s) + ${expenses.length} reimbursement(s) + ${partnerInvoices.length} partner invoice(s), $${totalUsd.toFixed(2)}.`,
    });
    const [run] = await db.select().from(atelierPaymentRuns).where(eq(atelierPaymentRuns.id, runId));
    const items = await db.select().from(atelierPaymentRunItems).where(eq(atelierPaymentRunItems.runId, runId));
    res.status(201).json({ ok: true, run: runWire(run, items), skippedMissingBank });
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
    res.json({
      run: runWire(run, items),
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

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
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
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      "run_number,item_type,payee,description,amount,currency,amount_usd",
      ...items.map((it) =>
        [run.runNumber, it.itemType, esc(it.payeeName), esc(it.description), it.amount.toFixed(2), it.currency, it.amountUsd.toFixed(2)].join(","),
      ),
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

// ============================================================
// WHT register
// ============================================================
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

// ============================================================
// Subcontractors
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/subcontractors", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ vendors: [], links: [] });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/payables/subcontractors/links/:id/ar-receipt", (req, res) => {
  if (!writeGate(req, res)) return;
  res.status(404).json({ error: "not-found" });
});

// ============================================================
// Audit trail
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/payables/audit", (req, res) => {
  if (!readGate(req, res)) return;
  res.json({ items: [] });
});

// ============================================================
// Task #875 — Partner-submitted AP invoices (finance review surface)
// ============================================================

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

// ============================================================
// Task #1070 — Internal supplier-invoice upload (source "internal_upload")
// ============================================================
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

function supplierInvoiceWire(
  row: typeof atelierPartnerFirmInvoices.$inferSelect,
  hasBankDetails?: boolean,
) {
  return {
    id: row.id,
    supplierName: row.partnerFirmName,
    partnerFirmId: row.partnerFirmId || null,
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
    // Unlinked suppliers have no firm bank registry — no hold applies.
    hasBankDetails: hasBankDetails ?? !row.partnerFirmId,
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
    res.json({
      items: rows.map((r) =>
        supplierInvoiceWire(r, r.partnerFirmId ? (bankById.get(r.partnerFirmId) ?? false) : undefined),
      ),
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

// @cli-skip: Task #1070 multipart upload; not CLI-exposable
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
      if (!looksLikePdf(file.buffer)) {
        res.status(400).json({ error: "pdf-required", message: "Invoice must be a PDF." });
        return;
      }
      const supplierName = bodyStr(req.body?.supplierName, 200);
      if (!supplierName) { res.status(400).json({ error: "supplier-name-required" }); return; }
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
        res.status(400).json({ error: "invalid-amount" });
        return;
      }
      const currency = bodyStr(req.body?.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) { res.status(400).json({ error: "invalid-currency" }); return; }
      const reference = bodyStr(req.body?.reference, 100);
      if (!reference) { res.status(400).json({ error: "reference-required" }); return; }
      const periodLabel = bodyStr(req.body?.periodLabel, 60) || null;
      const invoiceDate = bodyStr(req.body?.invoiceDate, 10) || null;
      const notes = bodyStr(req.body?.notes, 2000) || null;
      // Optional link to a registered partner firm (org-scoped).
      const wantFirmId = bodyStr(req.body?.partnerFirmId, 100);
      let firm: { id: string; name: string } | null = null;
      if (wantFirmId) {
        const [f] = await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
          .from(atelierPartnerFirms)
          .where(and(
            eq(atelierPartnerFirms.id, wantFirmId),
            eq(atelierPartnerFirms.orgId, me.orgId),
            isNull(atelierPartnerFirms.deletedAt),
          ));
        if (!f) { res.status(404).json({ error: "partner-firm-not-found" }); return; }
        firm = f;
      }

      const now = new Date();
      // Hash BEFORE storing anything — the blob is only persisted once
      // dedupe has passed (no orphan blobs on 409).
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
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
        const { blobRef } = await storeContractBytes(file.buffer);
        await tx.insert(atelierPartnerFirmInvoices).values({
          id,
          orgId: me.orgId,
          // Unlinked suppliers store "" — the column is NOT NULL and ""
          // is the sentinel for "not a registered partner firm".
          partnerFirmId: firm?.id ?? "",
          partnerFirmName: firm?.name ?? supplierName,
          engagementId: null,
          weekIso: periodLabel ?? invoiceDate ?? now.toISOString().slice(0, 10),
          hours: 0,
          costAmount: amount,
          costCurrency: currency,
          fxRate: fx.rate,
          usdAmount: +fx.usdAmount.toFixed(2),
          status: "submitted",
          source: "internal_upload",
          reference,
          periodLabel,
          invoiceDate,
          submittedByUserId: me.id,
          submittedAt: now,
          fileName: file.originalname.slice(0, 300),
          mime: "application/pdf",
          sizeBytes: file.size,
          sha256,
          blobRef,
          notes,
        });
        return { dupe: null } as const;
      });
      if (outcome.dupe) {
        const dupe = outcome.dupe;
        res.status(409).json({
          error: "duplicate-invoice",
          matchedBy: dupe.sha256 === sha256 ? "file" : "reference",
          existing: supplierInvoiceWire(dupe),
          message: dupe.sha256 === sha256
            ? `This exact PDF was already uploaded (${dupe.reference ?? dupe.id}, status ${dupe.status}).`
            : `An invoice with reference ${reference} from ${dupe.partnerFirmName} already exists (status ${dupe.status}).`,
        });
        return;
      }
      await audit({
        entityType: "partner_firm_invoice", entityId: id, actor: me,
        action: "finance.supplier_invoice.upload",
        payload: { supplierName: firm?.name ?? supplierName, partnerFirmId: firm?.id ?? null, reference, amount, currency, periodLabel, sha256 },
        summary: `${me.name} uploaded supplier invoice ${reference} from ${firm?.name ?? supplierName} (${currency} ${amount.toFixed(2)}).`,
      });
      const [row] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, id));
      res.status(201).json({ ok: true, item: supplierInvoiceWire(row) });
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

/** Review transitions — same machine as partner-submitted invoices. */
const SUPPLIER_INVOICE_REVIEW: Record<string, string[]> = {
  start_review: ["submitted"],
  approve: ["submitted", "under_review"],
  reject: ["submitted", "under_review"],
};

// @cli-skip: Task #1070 audited finance write; UI-workflow only
router.post("/finance/payables/supplier-invoices/:id/review", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const decision = typeof req.body?.decision === "string" ? req.body.decision : "";
    const allowedFrom = SUPPLIER_INVOICE_REVIEW[decision];
    if (!allowedFrom) { res.status(400).json({ error: "invalid-decision" }); return; }
    const row = await loadSupplierInvoice(me.orgId, req.params.id);
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
      // Bank-details hold applies when the supplier is a registered
      // partner firm — payments only ever go to finance-approved firm
      // bank details. Unregistered suppliers carry no firm registry;
      // their details are keyed into the bank file at run time.
      if (row.partnerFirmId) {
        const [firm] = await db.select({ bankIban: atelierPartnerFirms.bankIban })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.id, row.partnerFirmId), eq(atelierPartnerFirms.orgId, me.orgId)));
        if (!firm || !(firm.bankIban ?? "").trim()) {
          res.status(409).json({ error: "bank-details-missing", message: "The linked partner firm has no finance-approved bank details yet; approve is blocked until onboarding records them." });
          return;
        }
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
      action: `finance.supplier_invoice.${decision}`,
      payload: { supplierName: row.partnerFirmName, reference: row.reference, amount: row.costAmount, currency: row.costCurrency, ...(reason ? { reason } : {}) },
      summary: `${decision === "start_review" ? "Started review of" : decision === "approve" ? "Approved" : "Rejected"} supplier invoice ${row.reference ?? row.id} from ${row.partnerFirmName}.`,
    });
    const updated = await loadSupplierInvoice(me.orgId, row.id);
    res.json({ ok: true, invoice: updated ? supplierInvoiceWire(updated) : null });
  } catch (err) { next(err); }
});

// ============================================================
// Dashboard tile + inbox producers (Wave-1 wiring)
// ============================================================
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

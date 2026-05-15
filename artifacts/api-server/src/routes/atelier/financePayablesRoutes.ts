/**
 * Atelier — Finance Payables (P2P) routes (Task #418, Wave 6).
 *
 * Read-only API plus a small number of state-mutating endpoints for the
 * procure-to-pay hardening: vendor master with bank-detail change
 * controls (maker-checker + OOB), purchase orders + GRNs, vendor
 * invoices with 3-way match, payment runs (maker-checker + dual
 * signatories + simulated bank-file), WHT register, subcontractor
 * pay-when-paid.
 *
 * Mutations are in-memory only (no DB); the seed module is the source
 * of truth and the demo state survives only the lifetime of the API
 * process. Persona gating mirrors the Finance Entities pattern.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { atelierUsers } from "@workspace/db";

// We re-declare the seed inline rather than reaching across packages.
// The shapes match `artifacts/atelier/src/data/finance-payables-seed.ts`
// 1:1; the page hook reads through this API and never imports the seed
// directly.
import {
  listVendors,
  listPurchaseOrders,
  listVendorInvoices,
  listPaymentRuns,
  listWhtCertificates,
  listSubcontractorLinks,
  topExpectedDisbursements,
  stalledApprovalItems,
  type Vendor,
  type PurchaseOrder,
  type VendorInvoice,
  type PaymentRun,
  type WhtCertificate,
  type SubcontractorLink,
  type BankChangeRequest,
} from "../../data/finance-payables-seed.js";
import {
  recomputeAndApplyMatch,
  canApproveForPayment,
  applyApproveForPayment,
  buildPaymentRun,
  releasePayWhenPaid,
  appendAudit,
  listAudit,
} from "../../data/finance-payables-engine.js";

type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

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

// ============================================================
// Vendors
// ============================================================
router.get("/finance/payables/vendors", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  res.json({ items: listVendors() });
});

router.get("/finance/payables/vendors/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const v = listVendors().find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: "not-found" });
  res.json({ vendor: v });
});

/** Initiate a vendor bank-detail change request (maker step). The change
 *  starts in `pending_oob` and must be confirmed out-of-band, then
 *  approved by a different Finance leader. */
router.post("/finance/payables/vendors/:id/bank-change", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const body = req.body ?? {};
  const accountId = body.bankAccountId as string | undefined;
  const fieldChanged = body.fieldChanged as BankChangeRequest["fieldChanged"] | undefined;
  const newValue = body.newValue as string | undefined;
  const reason = body.reason as string | undefined;
  const oobMethod = (body.oobMethod as BankChangeRequest["oobConfirmation"]["method"] | undefined) ?? "phone_callback";
  const contactName = (body.contactName as string | undefined) ?? "vendor primary contact";
  const contactNumber = (body.contactNumber as string | null | undefined) ?? null;
  if (!accountId || !fieldChanged || !newValue || !reason) {
    return res.status(400).json({ error: "missing-fields", required: ["bankAccountId", "fieldChanged", "newValue", "reason"] });
  }
  const vendor = listVendors().find((v) => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor-not-found" });
  const ba = vendor.bankAccounts.find((b) => b.id === accountId);
  if (!ba) return res.status(404).json({ error: "bank-account-not-found" });
  if (ba.pendingChange) return res.status(409).json({ error: "change-in-flight", changeId: ba.pendingChange.id });
  const oldValue =
    fieldChanged === "iban" ? ba.iban : fieldChanged === "swift" ? ba.swift : fieldChanged === "bank" ? ba.bank : ba.accountHolder;
  const change: BankChangeRequest = {
    id: `bcr_${vendor.id}_${Date.now().toString(36)}`,
    fieldChanged,
    oldValue,
    newValue,
    requestedBy: me.name,
    requestedAt: new Date().toISOString().slice(0, 10),
    reason,
    oobConfirmation: { method: oobMethod, contactName, contactNumber, confirmedAt: null, confirmedBy: null },
    status: "pending_oob",
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
  };
  ba.pendingChange = change;
  appendAudit({
    actor: me.name,
    kind: "bank_change_initiated",
    subjectKind: "vendor",
    subjectId: vendor.id,
    detail: `Initiated ${fieldChanged} change on ${ba.bank} (${accountId}): "${oldValue}" → "${newValue}". Reason: ${reason}`,
  });
  res.json({ vendor, change });
});

/** Confirm OOB step. Must NOT be the same actor as the requester. */
router.post("/finance/payables/vendors/:id/bank-change/:changeId/oob-confirm", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const vendor = listVendors().find((v) => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor-not-found" });
  for (const ba of vendor.bankAccounts) {
    if (ba.pendingChange?.id === req.params.changeId) {
      if (ba.pendingChange.requestedBy === me.name) {
        return res.status(409).json({ error: "requester-cannot-confirm-oob" });
      }
      ba.pendingChange.oobConfirmation.confirmedAt = new Date().toISOString().slice(0, 10);
      ba.pendingChange.oobConfirmation.confirmedBy = me.name;
      ba.pendingChange.status = "pending_checker";
      appendAudit({
        actor: me.name,
        kind: "bank_change_oob_confirmed",
        subjectKind: "vendor",
        subjectId: vendor.id,
        detail: `OOB confirmed for change ${ba.pendingChange.id} via ${ba.pendingChange.oobConfirmation.method}`,
      });
      return res.json({ vendor, change: ba.pendingChange });
    }
  }
  return res.status(404).json({ error: "change-request-not-found" });
});

/** Bank-detail change-control: maker-checker decision (approve/reject).
 *  The decider must not be the original requester. */
router.post("/finance/payables/vendors/:id/bank-change/:changeId/decide", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const decision = (req.body?.decision as "approve" | "reject") ?? null;
  const reason = (req.body?.reason as string | undefined) ?? null;
  if (decision !== "approve" && decision !== "reject") {
    return res.status(400).json({ error: "invalid-decision" });
  }
  const vendor: Vendor | undefined = listVendors().find((v) => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: "vendor-not-found" });
  let changed = false;
  for (const ba of vendor.bankAccounts) {
    if (ba.pendingChange && ba.pendingChange.id === req.params.changeId) {
      // Maker-checker rule: the requester cannot also be the approver.
      if (ba.pendingChange.requestedBy === me.name) {
        return res.status(409).json({ error: "maker-cannot-be-checker" });
      }
      // OOB confirmation must be present before approval.
      if (decision === "approve" && !ba.pendingChange.oobConfirmation.confirmedAt) {
        return res.status(409).json({ error: "oob-not-confirmed" });
      }
      if (decision === "approve") {
        ba.pendingChange.status = "approved";
        ba.pendingChange.approvedBy = me.name;
        ba.pendingChange.approvedAt = new Date().toISOString().slice(0, 10);
        // Apply the change.
        if (ba.pendingChange.fieldChanged === "iban") ba.iban = ba.pendingChange.newValue;
        else if (ba.pendingChange.fieldChanged === "swift") ba.swift = ba.pendingChange.newValue;
        else if (ba.pendingChange.fieldChanged === "bank") ba.bank = ba.pendingChange.newValue;
        else if (ba.pendingChange.fieldChanged === "accountHolder") ba.accountHolder = ba.pendingChange.newValue;
        appendAudit({
          actor: me.name,
          kind: "bank_change_decided",
          subjectKind: "vendor",
          subjectId: vendor.id,
          detail: `APPROVED change ${ba.pendingChange.id} (${ba.pendingChange.fieldChanged}) — applied to ${ba.id}.`,
        });
        ba.pendingChange = null;
      } else {
        ba.pendingChange.status = "rejected";
        ba.pendingChange.rejectedReason = reason ?? "rejected";
        appendAudit({
          actor: me.name,
          kind: "bank_change_decided",
          subjectKind: "vendor",
          subjectId: vendor.id,
          detail: `REJECTED change ${ba.pendingChange.id} — ${ba.pendingChange.rejectedReason}`,
        });
      }
      changed = true;
      break;
    }
  }
  if (!changed) return res.status(404).json({ error: "change-request-not-found" });
  res.json({ vendor });
});

// ============================================================
// Purchase Orders + GRNs
// ============================================================
router.get("/finance/payables/po", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  res.json({ items: listPurchaseOrders() });
});

router.get("/finance/payables/po/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const po: PurchaseOrder | undefined = listPurchaseOrders().find((p) => p.id === req.params.id);
  if (!po) return res.status(404).json({ error: "not-found" });
  res.json({ po });
});

// ============================================================
// Vendor invoices + 3-way match
// ============================================================
router.get("/finance/payables/invoices", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  res.json({ items: listVendorInvoices() });
});

router.get("/finance/payables/invoices/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const inv: VendorInvoice | undefined = listVendorInvoices().find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "not-found" });
  res.json({ invoice: inv });
});

/** Re-run the 3-way match engine on this invoice and apply the result.
 *  Computes price/qty deltas from the linked PO + GRNs and either moves
 *  the invoice to `matched` or `exception`. */
router.post("/finance/payables/invoices/:id/match", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const out = recomputeAndApplyMatch(req.params.id);
  if (!out) return res.status(404).json({ error: "not-found" });
  appendAudit({
    actor: me.name,
    kind: "invoice_match_recomputed",
    subjectKind: "invoice",
    subjectId: out.invoice.id,
    detail: `Match → ${out.computation.outcome} (price Δ ${(out.computation.poDeltaPct * 100).toFixed(2)}%, qty Δ ${(out.computation.grnDeltaPct * 100).toFixed(0)}%)`,
  });
  res.json({ invoice: out.invoice, computation: out.computation });
});

/** Approve a matched (or overridden) invoice for payment. Subcontractor
 *  invoices whose linked AR receipt has not cleared land on `on_hold_pwp`
 *  rather than `approved_for_payment`. */
router.post("/finance/payables/invoices/:id/approve", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const inv = listVendorInvoices().find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "not-found" });
  const gate = canApproveForPayment(inv);
  if (!gate.ok) return res.status(409).json({ error: gate.reason, detail: gate.detail });
  applyApproveForPayment(inv);
  appendAudit({
    actor: me.name,
    kind: "invoice_approved",
    subjectKind: "invoice",
    subjectId: inv.id,
    detail: `Approved for payment → status ${inv.status} (${inv.netPayableUsd.toLocaleString()} USD)`,
  });
  res.json({ invoice: inv });
});

/** 3-way match override: supply a reason; only Finance leaders may override. */
router.post("/finance/payables/invoices/:id/override", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const reason = (req.body?.reason as string | undefined) ?? "";
  if (!reason.trim()) return res.status(400).json({ error: "reason-required" });
  const inv = listVendorInvoices().find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "not-found" });
  if (inv.status !== "exception") return res.status(409).json({ error: "not-in-exception" });
  inv.match.outcome = "tolerance_override";
  inv.match.overrideBy = me.name;
  inv.match.overrideReason = reason;
  applyApproveForPayment(inv);
  appendAudit({
    actor: me.name,
    kind: "invoice_overridden",
    subjectKind: "invoice",
    subjectId: inv.id,
    detail: `Tolerance override applied — reason: ${reason}. New status: ${inv.status}.`,
  });
  res.json({ invoice: inv });
});

// ============================================================
// Payment runs (maker-checker + dual signatories + bank-file)
// ============================================================
router.get("/finance/payables/payment-runs", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  res.json({ items: listPaymentRuns() });
});

/** Build a new draft payment run from currently-eligible invoices.
 *  Selects all `approved_for_payment` invoices (excluding pay-when-paid
 *  holds and invoices already in an open run), batches by entity ·
 *  bank-account · currency, and picks the required dual signatories
 *  from the entity's bank-account signatory matrix. */
router.post("/finance/payables/payment-runs/build", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const scheduledFor = (req.body?.scheduledFor as string | undefined) ?? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const result = buildPaymentRun({ scheduledFor, makerName: me.name });
  if (!result.run) {
    return res.status(409).json({ error: result.reason ?? "no-run-built", excluded: result.excluded });
  }
  appendAudit({
    actor: me.name,
    kind: "payment_run_built",
    subjectKind: "payment_run",
    subjectId: result.run.id,
    detail: `Built ${result.run.number} (${result.run.invoiceCount} invoice(s) / $${result.run.totalUsd.toLocaleString()}); excluded ${result.excluded.length}.`,
  });
  res.json({ run: result.run, eligibleCount: result.eligibleCount, excluded: result.excluded });
});

router.get("/finance/payables/payment-runs/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const run = listPaymentRuns().find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "not-found" });
  res.json({ run });
});

/** Maker-checker step: the checker (must not be the maker) approves
 *  the run, advancing it to `pending_signatories`. */
router.post("/finance/payables/payment-runs/:id/check", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const run: PaymentRun | undefined = listPaymentRuns().find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "not-found" });
  if (run.status !== "draft" && run.status !== "pending_checker") {
    return res.status(409).json({ error: "wrong-state", state: run.status });
  }
  if (run.makerName === me.name) {
    return res.status(409).json({ error: "maker-cannot-be-checker" });
  }
  run.checkerName = me.name;
  run.checkedAt = new Date().toISOString().slice(0, 10);
  run.status = "pending_signatories";
  appendAudit({
    actor: me.name,
    kind: "payment_run_checked",
    subjectKind: "payment_run",
    subjectId: run.id,
    detail: `Checker approved (maker was ${run.makerName}).`,
  });
  res.json({ run });
});

/** Signatory step: each required signatory signs in turn. When all signs
 *  are present, the run advances to `approved` and a simulated bank-file
 *  payload is generated. */
router.post("/finance/payables/payment-runs/:id/sign", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const run = listPaymentRuns().find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "not-found" });
  if (run.status !== "pending_signatories") return res.status(409).json({ error: "wrong-state", state: run.status });
  const sig = run.requiredSignatures.find((s) => s.signatoryName === me.name && !s.signedAt);
  if (!sig) return res.status(409).json({ error: "not-a-required-signatory-or-already-signed" });
  sig.signedAt = new Date().toISOString().slice(0, 10);
  appendAudit({
    actor: me.name,
    kind: "payment_run_signed",
    subjectKind: "payment_run",
    subjectId: run.id,
    detail: `Signed by ${sig.signatoryName} (authority ${sig.authorityLevel}).`,
  });
  if (run.requiredSignatures.every((s) => s.signedAt)) {
    run.status = "approved";
    // Simulated bank-file output.
    const filename = `${run.number}_BANKFILE.xml`;
    const lines = run.batches.reduce((acc, b) => acc + b.count, 0);
    run.bankFile = {
      filename,
      format: "SEPA-XML",
      lines,
      previewBytes: `<PaymentRun id=\"${run.id}\" total=\"${run.totalUsd.toFixed(2)}\" lines=\"${lines}\"/>`,
    };
  }
  res.json({ run });
});

/** Mark exported (i.e. file dispatched to bank): only after all signs. */
router.post("/finance/payables/payment-runs/:id/export", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const run = listPaymentRuns().find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "not-found" });
  if (run.status !== "approved") return res.status(409).json({ error: "wrong-state", state: run.status });
  run.status = "exported";
  appendAudit({
    actor: me.name,
    kind: "payment_run_exported",
    subjectKind: "payment_run",
    subjectId: run.id,
    detail: `Exported bank file ${run.bankFile?.filename ?? "(none)"}.`,
  });
  res.json({ run });
});

// ============================================================
// WHT register
// ============================================================
router.get("/finance/payables/wht", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const certs: WhtCertificate[] = listWhtCertificates();
  // Per-jurisdiction remittance summary feeding the compliance calendar.
  const summary: Record<string, { jurisdiction: string; period: string; dueAt: string; whtUsd: number; certCount: number }> = {};
  for (const c of certs) {
    const key = `${c.jurisdiction}::${c.remittancePeriod}`;
    if (!summary[key]) {
      summary[key] = { jurisdiction: c.jurisdiction, period: c.remittancePeriod, dueAt: c.remittanceDueAt, whtUsd: 0, certCount: 0 };
    }
    summary[key].whtUsd += c.whtUsd;
    summary[key].certCount += 1;
  }
  res.json({ items: certs, remittance: Object.values(summary).sort((a, b) => a.dueAt.localeCompare(b.dueAt)) });
});

router.post("/finance/payables/wht/:id/issue", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const c: WhtCertificate | undefined = listWhtCertificates().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not-found" });
  if (c.status !== "pending") return res.status(409).json({ error: "wrong-state" });
  c.status = "issued";
  c.issuedAt = new Date().toISOString().slice(0, 10);
  c.certificateNumber = c.certificateNumber ?? `${c.jurisdiction}-WHT-${c.remittancePeriod}-${c.id.slice(-3)}`;
  res.json({ certificate: c });
});

router.post("/finance/payables/wht/:id/send", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const c = listWhtCertificates().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not-found" });
  if (c.status !== "issued") return res.status(409).json({ error: "wrong-state" });
  c.status = "sent_to_vendor";
  c.sentAt = new Date().toISOString().slice(0, 10);
  res.json({ certificate: c });
});

router.post("/finance/payables/wht/:id/acknowledge", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const c = listWhtCertificates().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not-found" });
  if (c.status !== "sent_to_vendor") return res.status(409).json({ error: "wrong-state" });
  c.status = "acknowledged";
  c.acknowledgedAt = new Date().toISOString().slice(0, 10);
  res.json({ certificate: c });
});

// ============================================================
// Subcontractors
// ============================================================
router.get("/finance/payables/subcontractors", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const links: SubcontractorLink[] = listSubcontractorLinks();
  const vendors = listVendors().filter((v) => v.isSubcontractor);
  res.json({ vendors, links });
});

/** Mark a pay-when-paid AR receipt as received (or partial). When the
 *  receipt is fully received, any subcontractor invoice on that link
 *  with status `on_hold_pwp` is auto-released to `approved_for_payment`. */
router.post("/finance/payables/subcontractors/links/:id/ar-receipt", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res) || requireFinanceLeader(me, res)) return;
  const status = (req.body?.status as "received" | "partial" | undefined) ?? "received";
  const at = (req.body?.receivedAt as string | undefined) ?? new Date().toISOString().slice(0, 10);
  const out = releasePayWhenPaid(req.params.id, at, status);
  appendAudit({
    actor: me.name,
    kind: "pwp_released",
    subjectKind: "subcontractor_link",
    subjectId: req.params.id,
    detail: `AR receipt marked ${status} on ${at}; released invoices: ${out.releasedInvoiceIds.join(", ") || "(none)"}.`,
  });
  res.json({ ok: true, releasedInvoiceIds: out.releasedInvoiceIds });
});

// ============================================================
// Audit trail
// ============================================================
router.get("/finance/payables/audit", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const subjectId = req.query.subjectId as string | undefined;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  res.json({ items: listAudit({ subjectId, limit }) });
});

// ============================================================
// Dashboard tile + inbox producers (Wave-1 wiring)
// ============================================================
router.get("/finance/payables/dashboard/expected-disbursements", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const n = Math.max(1, Math.min(20, Number(req.query.n) || 5));
  res.json({ items: topExpectedDisbursements(n) });
});

router.get("/finance/payables/dashboard/stalled-approvals", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me || denyRecruiter(me, res)) return;
  const days = Math.max(1, Number(req.query.days) || 5);
  res.json({ items: stalledApprovalItems(days) });
});

export default router;

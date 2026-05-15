/**
 * Atelier — Finance Payables (P2P) engines (Task #418, Wave 6).
 *
 * Pure-function business logic that complements the seed module:
 *   - compute3WayMatch(): re-derives an invoice's match outcome from
 *     the linked PO + GRNs + invoice header. Used at the
 *     `received → matched | exception` transition.
 *   - canApproveForPayment(): predicate that gates the
 *     `matched → approved_for_payment` transition (only matched or
 *     explicitly overridden invoices may move forward; subcontractor
 *     invoices land on `on_hold_pwp` until the linked AR receipt
 *     clears).
 *   - buildPaymentRun(): from the current invoice/run/vendor state,
 *     selects all `approved_for_payment` invoices that are not already
 *     in an open run and not held under pay-when-paid, batches them by
 *     (entity · bank-account · currency), and picks the required bank
 *     signatories from the entity's bank-account signatory matrix.
 *   - releasePayWhenPaid(): when a subcontractor link's AR receipt
 *     clears, lift the `on_hold_pwp` status on its linked invoice.
 *
 * An in-memory audit trail records each maker-checker / OOB / signatory
 * action; the routes module appends to it and exposes it under
 * /finance/payables/audit.
 */
import {
  listVendors,
  listPurchaseOrders,
  listVendorInvoices,
  listPaymentRuns,
  listSubcontractorLinks,
  type VendorInvoice,
  type PurchaseOrder,
  type PaymentRun,
  type PaymentRunBatch,
  type PaymentRunSignoff,
  type MatchOutcome,
} from "./finance-payables-seed.js";

// ============================================================
// Tolerances
// ============================================================
/** Price tolerance: ±2% AND ≤ $100 absolute delta. */
export const PRICE_TOLERANCE_PCT = 0.02;
export const PRICE_TOLERANCE_ABS_USD = 100;

// ============================================================
// 3-way match engine
// ============================================================
export interface MatchComputation {
  outcome: MatchOutcome;
  poDeltaPct: number;
  grnDeltaPct: number;
  notes: string | null;
  expectedAmountUsd: number;
  receivedQuantityTotal: number;
  invoicedQuantityTotal: number;
}

export function compute3WayMatch(invoice: VendorInvoice, po: PurchaseOrder | null): MatchComputation {
  if (!po) {
    return {
      outcome: "no_po",
      poDeltaPct: 0,
      grnDeltaPct: 0,
      notes: "Non-PO invoice — requires explicit Finance-leader approval.",
      expectedAmountUsd: 0,
      receivedQuantityTotal: 0,
      invoicedQuantityTotal: 0,
    };
  }
  // GRN aggregate quantity (per line, summed across all GRNs).
  const grnByLine = new Map<string, number>();
  for (const grn of po.goodsReceipts) {
    for (const l of grn.lines) {
      grnByLine.set(l.poLineId, (grnByLine.get(l.poLineId) ?? 0) + l.quantity);
    }
  }
  const recvTotal = po.lines.reduce((n, l) => n + (grnByLine.get(l.id) ?? l.receivedQuantity), 0);
  const invoicedTotal = po.lines.reduce((n, l) => n + l.invoicedQuantity, 0);

  // Expected amount = sum(invoicedQuantity * unitPriceUsd). The "expected"
  // for THIS invoice is approximated as the PO unit-price times the
  // already-invoiced qty (a real ERP would track per-invoice line splits;
  // for the demo, we approximate against the PO total when invoicedQty
  // equals the line qty, otherwise pro-rata).
  const expected = po.lines.reduce((n, l) => n + l.invoicedQuantity * l.unitPriceUsd, 0);
  const priceDelta = expected === 0 ? 0 : (invoice.amountUsd - expected) / expected;
  const absPriceDelta = Math.abs(invoice.amountUsd - expected);

  // No GRN at all? Goods/services not yet receipted.
  if (po.goodsReceipts.length === 0) {
    return {
      outcome: "no_grn",
      poDeltaPct: priceDelta,
      grnDeltaPct: 1,
      notes: "No goods receipt recorded against this PO; cannot 3-way match.",
      expectedAmountUsd: expected,
      receivedQuantityTotal: recvTotal,
      invoicedQuantityTotal: invoicedTotal,
    };
  }
  // Quantity invoiced exceeds quantity received?
  if (invoicedTotal > recvTotal) {
    return {
      outcome: "qty_mismatch",
      poDeltaPct: priceDelta,
      grnDeltaPct: (invoicedTotal - recvTotal) / Math.max(1, recvTotal),
      notes: `Invoiced qty ${invoicedTotal} exceeds receipted qty ${recvTotal}.`,
      expectedAmountUsd: expected,
      receivedQuantityTotal: recvTotal,
      invoicedQuantityTotal: invoicedTotal,
    };
  }
  // Price outside tolerance?
  const withinPct = Math.abs(priceDelta) <= PRICE_TOLERANCE_PCT;
  const withinAbs = absPriceDelta <= PRICE_TOLERANCE_ABS_USD;
  if (!withinPct || !withinAbs) {
    return {
      outcome: "price_mismatch",
      poDeltaPct: priceDelta,
      grnDeltaPct: 0,
      notes: `Invoice $${invoice.amountUsd.toLocaleString()} vs expected $${expected.toLocaleString()} (${(priceDelta * 100).toFixed(2)}%, $${absPriceDelta.toFixed(0)} abs) — outside tolerance ±${(PRICE_TOLERANCE_PCT * 100).toFixed(0)}% / $${PRICE_TOLERANCE_ABS_USD}.`,
      expectedAmountUsd: expected,
      receivedQuantityTotal: recvTotal,
      invoicedQuantityTotal: invoicedTotal,
    };
  }
  return {
    outcome: "match",
    poDeltaPct: priceDelta,
    grnDeltaPct: 0,
    notes: null,
    expectedAmountUsd: expected,
    receivedQuantityTotal: recvTotal,
    invoicedQuantityTotal: invoicedTotal,
  };
}

/** Recompute the match for an invoice in place and update its status to
 *  match the new outcome. Returns the new computation. */
export function recomputeAndApplyMatch(invoiceId: string): { invoice: VendorInvoice; computation: MatchComputation } | null {
  const inv = listVendorInvoices().find((i) => i.id === invoiceId);
  if (!inv) return null;
  if (inv.status === "paid" || inv.status === "rejected") {
    // Terminal — don't touch.
    return { invoice: inv, computation: { outcome: inv.match.outcome, poDeltaPct: inv.match.poDeltaPct, grnDeltaPct: inv.match.grnDeltaPct, notes: inv.match.notes, expectedAmountUsd: 0, receivedQuantityTotal: 0, invoicedQuantityTotal: 0 } };
  }
  const po = inv.poId ? (listPurchaseOrders().find((p) => p.id === inv.poId) ?? null) : null;
  const c = compute3WayMatch(inv, po);
  // Preserve an existing tolerance_override; otherwise apply.
  if (inv.match.outcome !== "tolerance_override") {
    inv.match.outcome = c.outcome;
    inv.match.poDeltaPct = c.poDeltaPct;
    inv.match.grnDeltaPct = c.grnDeltaPct;
    inv.match.notes = c.notes;
    if (c.outcome === "match") {
      if (inv.status === "received" || inv.status === "exception") inv.status = "matched";
    } else {
      if (inv.status === "received" || inv.status === "matched") inv.status = "exception";
    }
  }
  return { invoice: inv, computation: c };
}

// ============================================================
// Approval gate
// ============================================================
export type ApprovalDenyReason =
  | "wrong-state"
  | "match-required"
  | "vendor-blocked"
  | "vendor-on-hold";

export function canApproveForPayment(invoice: VendorInvoice): { ok: true } | { ok: false; reason: ApprovalDenyReason; detail: string } {
  if (invoice.status !== "matched" && invoice.status !== "exception") {
    return { ok: false, reason: "wrong-state", detail: `Invoice is ${invoice.status}; only matched/exception invoices can be approved.` };
  }
  if (invoice.match.outcome !== "match" && invoice.match.outcome !== "tolerance_override") {
    return { ok: false, reason: "match-required", detail: `Match outcome is "${invoice.match.outcome}". Either run /match again or post a tolerance_override.` };
  }
  const vendor = listVendors().find((v) => v.id === invoice.vendorId);
  if (vendor && vendor.status === "blocked") {
    return { ok: false, reason: "vendor-blocked", detail: `Vendor ${vendor.shortName} is blocked.` };
  }
  if (vendor && vendor.status === "on_hold") {
    return { ok: false, reason: "vendor-on-hold", detail: `Vendor ${vendor.shortName} is on hold; clear before approval.` };
  }
  return { ok: true };
}

/** Apply the approval transition. Subcontractor invoices whose linked
 *  AR receipt is not yet `received` land on `on_hold_pwp` instead. */
export function applyApproveForPayment(invoice: VendorInvoice): VendorInvoice {
  if (invoice.subcontractorLinkId) {
    const link = listSubcontractorLinks().find((l) => l.id === invoice.subcontractorLinkId);
    if (link && link.arReceiptStatus !== "received") {
      invoice.status = "on_hold_pwp";
      return invoice;
    }
  }
  invoice.status = "approved_for_payment";
  return invoice;
}

// ============================================================
// Pay-when-paid release
// ============================================================
export function releasePayWhenPaid(linkId: string, receivedAt: string, receiptStatus: "received" | "partial"): { releasedInvoiceIds: string[] } {
  const link = listSubcontractorLinks().find((l) => l.id === linkId);
  if (!link) return { releasedInvoiceIds: [] };
  link.arReceiptStatus = receiptStatus;
  link.arReceivedAt = receivedAt;
  if (receiptStatus !== "received") return { releasedInvoiceIds: [] };
  const released: string[] = [];
  for (const inv of listVendorInvoices()) {
    if (inv.subcontractorLinkId === linkId && inv.status === "on_hold_pwp") {
      inv.status = "approved_for_payment";
      released.push(inv.id);
    }
  }
  return { releasedInvoiceIds: released };
}

// ============================================================
// Payment-run builder
// ============================================================
/** Bank-account signatory matrix per (entity · currency). For the demo
 *  we hard-code the per-entity dual-signatory pairs to avoid a cross-
 *  module dependency on the entities seed. Each entity needs at least
 *  one A-authority signature; runs > $50k require an A + a B. */
const ENTITY_SIGNATORIES: Record<string, PaymentRunSignoff[]> = {
  fe_aico_uk: [
    { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
    { signatoryId: "sig_omar_h", signatoryName: "Omar Habib", authorityLevel: "B", signedAt: null },
  ],
  fe_aico_ksa: [
    { signatoryId: "sig_layla_m", signatoryName: "Layla Al-Mutairi", authorityLevel: "A", signedAt: null },
    { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
  ],
  fe_aico_uae: [
    { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
    { signatoryId: "sig_faisal_a", signatoryName: "Faisal Al-Suwaidi", authorityLevel: "A", signedAt: null },
  ],
  fe_aico_uae_branch: [
    { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
    { signatoryId: "sig_faisal_a", signatoryName: "Faisal Al-Suwaidi", authorityLevel: "A", signedAt: null },
  ],
  fe_aico_jv_neom: [
    { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
    { signatoryId: "sig_neom_rep", signatoryName: "NEOM JV Representative", authorityLevel: "A", signedAt: null },
  ],
};

/** Per-entity primary operating bank-account id. */
const ENTITY_OPERATING_BANK: Record<string, string> = {
  fe_aico_uk: "ba_aico_uk_op",
  fe_aico_ksa: "ba_aico_ksa_op",
  fe_aico_uae: "ba_aico_uae_op",
  fe_aico_uae_branch: "ba_aico_uae_branch_op",
  fe_aico_jv_neom: "ba_aico_jv_neom_op",
};

export interface BuildOptions {
  scheduledFor: string;
  makerName: string;
  /** Optional max — runs above this require an extra B-authority sign. */
  highValueThresholdUsd?: number;
}

export function buildPaymentRun(opts: BuildOptions): { run: PaymentRun | null; reason?: string; eligibleCount: number; excluded: Array<{ invoiceId: string; reason: string }> } {
  const allRuns = listPaymentRuns();
  // Invoices already locked into a non-terminal run.
  const lockedInvoiceIds = new Set<string>();
  for (const r of allRuns) {
    if (r.status === "paid" || r.status === "rejected") continue;
    for (const b of r.batches) for (const id of b.invoiceIds) lockedInvoiceIds.add(id);
  }
  const links = listSubcontractorLinks();
  const linkById = new Map(links.map((l) => [l.id, l]));

  const eligible: VendorInvoice[] = [];
  const excluded: Array<{ invoiceId: string; reason: string }> = [];
  for (const inv of listVendorInvoices()) {
    if (lockedInvoiceIds.has(inv.id)) {
      excluded.push({ invoiceId: inv.id, reason: "already in an open run" });
      continue;
    }
    if (inv.status === "on_hold_pwp") {
      excluded.push({ invoiceId: inv.id, reason: "pay-when-paid: AR receipt not yet cleared" });
      continue;
    }
    if (inv.status !== "approved_for_payment") continue;
    if (inv.subcontractorLinkId) {
      const link = linkById.get(inv.subcontractorLinkId);
      if (link && link.arReceiptStatus !== "received") {
        excluded.push({ invoiceId: inv.id, reason: "pay-when-paid: AR not received" });
        continue;
      }
    }
    eligible.push(inv);
  }
  if (eligible.length === 0) {
    return { run: null, reason: "no-eligible-invoices", eligibleCount: 0, excluded };
  }

  // Group by (entity · currency) — bank-account follows from the entity's
  // operating account in that currency (in the demo, one operating account
  // per entity).
  const byKey = new Map<string, { entityId: string; currency: string; invoices: VendorInvoice[] }>();
  for (const inv of eligible) {
    const key = `${inv.buyerEntityId}::${inv.currency}`;
    const slot = byKey.get(key) ?? { entityId: inv.buyerEntityId, currency: inv.currency, invoices: [] };
    slot.invoices.push(inv);
    byKey.set(key, slot);
  }

  const seq = String(allRuns.length + 1).padStart(3, "0");
  const newId = `pr_b_${seq}`;
  const newNumber = `PR-${opts.scheduledFor.slice(0, 7).replace("-", "")}-B${seq}`;

  const batches: PaymentRunBatch[] = [];
  let bIdx = 1;
  let totalUsd = 0;
  let totalCount = 0;
  for (const slot of byKey.values()) {
    const total = slot.invoices.reduce((n, i) => n + i.netPayableUsd, 0);
    const batch: PaymentRunBatch = {
      id: `${newId}b${bIdx++}`,
      entityId: slot.entityId,
      bankAccountId: ENTITY_OPERATING_BANK[slot.entityId] ?? `ba_${slot.entityId}_op`,
      currency: slot.currency,
      invoiceIds: slot.invoices.map((i) => i.id),
      totalUsd: total,
      count: slot.invoices.length,
    };
    batches.push(batch);
    totalUsd += total;
    totalCount += slot.invoices.length;
  }

  // Required signatories: union across every entity in the run; if any
  // batch is high-value, ensure at least one B-authority signature is
  // present in addition to A-authority.
  const threshold = opts.highValueThresholdUsd ?? 50_000;
  const sigs: PaymentRunSignoff[] = [];
  const seen = new Set<string>();
  const isHighValue = batches.some((b) => b.totalUsd >= threshold);
  for (const b of batches) {
    const matrix = ENTITY_SIGNATORIES[b.entityId] ?? [];
    for (const s of matrix) {
      // Always include A-authority signers; only include B-authority for
      // high-value runs.
      if (s.authorityLevel === "B" && !isHighValue) continue;
      if (seen.has(s.signatoryId)) continue;
      seen.add(s.signatoryId);
      sigs.push({ ...s, signedAt: null });
    }
  }
  // If there's only an A and high-value, ensure a B is added (already
  // handled), but if no B exists in the matrix, add Omar Habib (CFO).
  if (isHighValue && !sigs.some((s) => s.authorityLevel === "B")) {
    if (opts.makerName !== "Omar Habib") {
      sigs.push({ signatoryId: "sig_omar_h", signatoryName: "Omar Habib", authorityLevel: "B", signedAt: null });
    }
  }

  // Move the eligible invoices to `scheduled` while in the run.
  for (const inv of eligible) inv.status = "scheduled";

  const run: PaymentRun = {
    id: newId,
    number: newNumber,
    scheduledFor: opts.scheduledFor,
    status: "draft",
    createdBy: opts.makerName,
    createdAt: new Date().toISOString().slice(0, 10),
    makerName: opts.makerName,
    checkerName: null,
    checkedAt: null,
    requiredSignatures: sigs,
    batches,
    totalUsd,
    invoiceCount: totalCount,
    bankFile: null,
    notes: `Built ${new Date().toISOString().slice(0, 10)} by ${opts.makerName} from ${totalCount} eligible invoice(s).`,
  };
  // Append to the seed list (in-memory).
  allRuns.push(run);
  return { run, eligibleCount: eligible.length, excluded };
}

// ============================================================
// Audit trail (in-memory)
// ============================================================
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  kind:
    | "bank_change_initiated"
    | "bank_change_oob_confirmed"
    | "bank_change_decided"
    | "invoice_match_recomputed"
    | "invoice_approved"
    | "invoice_overridden"
    | "payment_run_built"
    | "payment_run_checked"
    | "payment_run_signed"
    | "payment_run_exported"
    | "pwp_released"
    | "wht_issued"
    | "wht_sent"
    | "wht_acknowledged";
  subjectKind: "vendor" | "invoice" | "payment_run" | "subcontractor_link" | "wht_certificate";
  subjectId: string;
  detail: string;
}

const AUDIT: AuditEntry[] = [];
let _auditSeq = 0;

export function appendAudit(e: Omit<AuditEntry, "id" | "at">): AuditEntry {
  _auditSeq += 1;
  const entry: AuditEntry = {
    ...e,
    id: `aud_${String(_auditSeq).padStart(5, "0")}`,
    at: new Date().toISOString(),
  };
  AUDIT.unshift(entry);
  if (AUDIT.length > 500) AUDIT.length = 500;
  return entry;
}

export function listAudit(filter?: { subjectId?: string; kind?: AuditEntry["kind"]; limit?: number }): AuditEntry[] {
  let out = AUDIT.slice();
  if (filter?.subjectId) out = out.filter((e) => e.subjectId === filter.subjectId);
  if (filter?.kind) out = out.filter((e) => e.kind === filter.kind);
  if (filter?.limit) out = out.slice(0, filter.limit);
  return out;
}

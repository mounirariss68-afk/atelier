/**
 * Task #363 — L2C Wave 4 cash receipts + cash application routes.
 *
 *   POST   /wallet/cash/receipt                          create cash receipt from bank txn
 *   GET    /wallet/cash/receipts                         list receipts (filter by state)
 *   POST   /wallet/cash/match                            run Cash Application Matcher (proposals)
 *   POST   /wallet/cash/apply                            apply receipt → invoice (atomic)
 *   POST   /wallet/cash/apply/:id/reverse                reverse a prior application
 *
 * Restricted personas + board_observer denied.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierBankTransaction,
  atelierCashReceipt,
  atelierCashApplication,
  atelierInvoice,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { runCashApplicationMatcher, runCashFlowForecaster } from "../../lib/atelier-agents/runner.js";
import { runBookkeeper } from "../../lib/atelier-agents/bookkeeper.js";
import { proposeOutflowCandidates, entityCompatible } from "../../lib/atelier-cash-ops.js";
import { evaluateAutoPost } from "../../lib/atelier-finance-autopolicy.js";
import { loadFinanceAutopilotThresholds } from "../../lib/atelier-finance-autopilot-settings.js";
import {
  atelierBankAccount,
  atelierCashForecastSnapshot,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierExpenses,
} from "@workspace/db";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensure(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function denyAll(req: Request, res: Response): boolean {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return true; }
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Cash capabilities are denied for this persona." });
    return true;
  }
  return false;
}
function isFinanceLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
/** Resolve a bank txn's legal entity, falling back to its bank account tag. */
async function resolveTxnEntity(txn: { legalEntityId: string | null; bankAccountId: string }): Promise<string | null> {
  if (txn.legalEntityId) return txn.legalEntityId;
  const [acct] = await db.select({ legalEntityId: atelierBankAccount.legalEntityId })
    .from(atelierBankAccount).where(eq(atelierBankAccount.id, txn.bankAccountId));
  return acct?.legalEntityId ?? null;
}
async function audit(args: {
  entityType: string; entityId: string; actor: typeof atelierUsers.$inferSelect;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

// ─────────────────────── receipts ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/receipts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const rows = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.orgId, me.orgId), isNull(atelierCashReceipt.deletedAt)))
    .orderBy(desc(atelierCashReceipt.receivedAt)).limit(200);
  return res.json({ ok: true, data: { rows } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/receipt", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankTransactionId?: string; customerId?: string; notes?: string };
  if (!b.bankTransactionId) return res.status(400).json({ error: "invalid_input" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, b.bankTransactionId), eq(atelierBankTransaction.orgId, me.orgId)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.amount <= 0) return res.status(400).json({ error: "invalid_input", message: "Bank txn must be a positive (receipt) row." });
  const dup = await db.select({ id: atelierCashReceipt.id }).from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.orgId, me.orgId), eq(atelierCashReceipt.bankTransactionId, b.bankTransactionId)));
  if (dup.length > 0) return res.status(409).json({ error: "duplicate", id: dup[0].id });
  const id = rid("rcpt");
  await db.insert(atelierCashReceipt).values({
    id, orgId: me.orgId, bankTransactionId: b.bankTransactionId, customerId: b.customerId ?? null,
    totalAmount: txn.amount, appliedAmount: 0, currency: txn.currency,
    receivedAt: txn.postedDate, notes: b.notes ?? null, createdByUserId: me.id,
  });
  await audit({ entityType: "cash_receipt", entityId: id, actor: me,
    action: "cash_receipt.create",
    payload: { bankTransactionId: b.bankTransactionId, amount: txn.amount },
    summary: `Receipt ${txn.currency} ${txn.amount} from ${txn.counterpartyNameRaw ?? "—"}` });
  return res.json({ ok: true, data: { id } });
});

// ─────────────────────── matcher ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/match", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { cashReceiptId?: string };
  if (!b.cashReceiptId) return res.status(400).json({ error: "invalid_input" });
  const [r] = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.id, b.cashReceiptId), eq(atelierCashReceipt.orgId, me.orgId)));
  if (!r) return res.status(404).json({ error: "not_found" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(eq(atelierBankTransaction.id, r.bankTransactionId));
  // Open invoices = total > amountPaid
  const openInvoices = (await db.select().from(atelierInvoice)
    .where(and(eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt))))
    .filter((i) => i.total - i.amountPaid > 0.01);
  const out = await runCashApplicationMatcher({
    receipt: {
      id: r.id, totalAmount: r.totalAmount - r.appliedAmount, currency: r.currency,
      counterpartyNameRaw: txn?.counterpartyNameRaw ?? null,
      referenceRaw: txn?.referenceRaw ?? null,
      postedDate: r.receivedAt,
    },
    openInvoices: openInvoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber,
      billToName: (i.billTo as { name?: string } | null)?.name ?? null,
      currency: i.currency, total: i.total, amountPaid: i.amountPaid, dueDate: i.dueDate,
    })),
    triggeredByUserId: me.id, actorLabel: me.name,
  });
  return res.json({ ok: true, data: out.output, runId: out.runId });
});

// ─────────────────────── apply ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/apply", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as {
    cashReceiptId?: string;
    applications?: Array<{ invoiceId: string; appliedAmount: number; rationale?: string }>;
  };
  if (!b.cashReceiptId || !Array.isArray(b.applications) || b.applications.length === 0)
    return res.status(400).json({ error: "invalid_input" });
  const [receipt] = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.id, b.cashReceiptId), eq(atelierCashReceipt.orgId, me.orgId)));
  if (!receipt) return res.status(404).json({ error: "not_found" });
  const totalRequested = b.applications.reduce((s, a) => s + (Number(a.appliedAmount) || 0), 0);
  const remaining = round2(receipt.totalAmount - receipt.appliedAmount);
  if (totalRequested - remaining > 0.01) {
    return res.status(400).json({ error: "over_apply", remaining, totalRequested });
  }
  const invoices = await db.select().from(atelierInvoice).where(and(
    eq(atelierInvoice.orgId, me.orgId),
    inArray(atelierInvoice.id, b.applications.map((a) => a.invoiceId)),
  ));
  if (invoices.length !== b.applications.length) return res.status(404).json({ error: "invoice_not_found" });
  const created: string[] = [];
  for (const a of b.applications) {
    const inv = invoices.find((i) => i.id === a.invoiceId)!;
    const outstanding = round2(inv.total - inv.amountPaid);
    if (a.appliedAmount > outstanding + 0.01) {
      return res.status(400).json({ error: "over_apply_invoice", invoiceId: inv.id, outstanding });
    }
    const appId = rid("capp");
    await db.insert(atelierCashApplication).values({
      id: appId, orgId: me.orgId, cashReceiptId: receipt.id, invoiceId: inv.id,
      appliedAmount: a.appliedAmount, currency: receipt.currency,
      appliedByUserId: me.id, rationaleText: a.rationale ?? null, createdByUserId: me.id,
    });
    await db.update(atelierInvoice).set({
      amountPaid: round2(inv.amountPaid + a.appliedAmount),
      status: round2(inv.amountPaid + a.appliedAmount) >= inv.total - 0.01 ? "paid" : inv.status,
      paidAt: round2(inv.amountPaid + a.appliedAmount) >= inv.total - 0.01 ? new Date() : inv.paidAt,
      updatedAt: new Date(),
    }).where(eq(atelierInvoice.id, inv.id));
    created.push(appId);
    await audit({ entityType: "cash_application", entityId: appId, actor: me,
      action: "cash_apply.commit",
      payload: { receiptId: receipt.id, invoiceId: inv.id, applied: a.appliedAmount },
      summary: `Applied ${receipt.currency} ${a.appliedAmount} to ${inv.invoiceNumber ?? inv.id}` });
  }
  await db.update(atelierCashReceipt).set({
    appliedAmount: round2(receipt.appliedAmount + totalRequested), updatedAt: new Date(),
  }).where(eq(atelierCashReceipt.id, receipt.id));
  return res.json({ ok: true, data: { applicationIds: created } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/apply/:id/reverse", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const id = req.params.id;
  const reason = (req.body as { reason?: string }).reason;
  if (!reason || reason.length < 4) return res.status(400).json({ error: "invalid_input", message: "Reason required (≥4 chars)." });
  const [orig] = await db.select().from(atelierCashApplication)
    .where(and(eq(atelierCashApplication.id, id), eq(atelierCashApplication.orgId, me.orgId)));
  if (!orig) return res.status(404).json({ error: "not_found" });
  if (orig.reversesApplicationId) return res.status(409).json({ error: "is_reversal" });
  const already = await db.select({ id: atelierCashApplication.id }).from(atelierCashApplication)
    .where(eq(atelierCashApplication.reversesApplicationId, id));
  if (already.length > 0) return res.status(409).json({ error: "already_reversed", id: already[0].id });
  const revId = rid("capp");
  await db.insert(atelierCashApplication).values({
    id: revId, orgId: me.orgId, cashReceiptId: orig.cashReceiptId, invoiceId: orig.invoiceId,
    appliedAmount: -orig.appliedAmount, currency: orig.currency,
    appliedByUserId: me.id, reversesApplicationId: orig.id, reversalReason: reason,
    rationaleText: `Reversal: ${reason}`, createdByUserId: me.id,
  });
  // Roll back invoice + receipt totals.
  const [inv] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, orig.invoiceId));
  if (inv) {
    const newPaid = round2(inv.amountPaid - orig.appliedAmount);
    await db.update(atelierInvoice).set({
      amountPaid: newPaid,
      status: newPaid < inv.total - 0.01 && inv.status === "paid" ? "issued" : inv.status,
      paidAt: newPaid < inv.total - 0.01 ? null : inv.paidAt,
      updatedAt: new Date(),
    }).where(eq(atelierInvoice.id, inv.id));
  }
  const [r] = await db.select().from(atelierCashReceipt).where(eq(atelierCashReceipt.id, orig.cashReceiptId));
  if (r) {
    await db.update(atelierCashReceipt).set({
      appliedAmount: round2(r.appliedAmount - orig.appliedAmount), updatedAt: new Date(),
    }).where(eq(atelierCashReceipt.id, r.id));
  }
  await audit({ entityType: "cash_application", entityId: revId, actor: me,
    action: "cash_apply.reverse",
    payload: { reversesId: orig.id, amount: orig.appliedAmount, reason },
    summary: `Reversed cash application ${orig.id} (${reason})` });
  return res.json({ ok: true, data: { reversalId: revId } });
});

// ════════════════════════ Task #431 — live cash ops ════════════════════════

// ─────────────────────── triage queue ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/triage", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const stateFilter = String(req.query.state ?? "");
  const states = stateFilter
    ? stateFilter.split(",").filter((s) => ["unmatched", "proposed", "matched", "parked", "journaled"].includes(s))
    : ["unmatched", "proposed", "parked"];
  const rows = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, me.orgId),
    isNull(atelierBankTransaction.deletedAt),
    inArray(atelierBankTransaction.matchedState, states.length > 0 ? states : ["proposed"]),
  )).orderBy(desc(atelierBankTransaction.postedDate)).limit(300);
  return res.json({ ok: true, data: { rows } });
});

// Task #1082 — targeted single-transaction lookup for GL drill-through
// deep-links: resolved (matched/journaled) txns fall out of the default
// triage queue, and the list endpoints are windowed, so the cash page needs
// an id-based lookup that works regardless of state or age.
// @cli-skip: internal deep-link resolver, no standalone CLI value
router.get("/triage/:id", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const [txn] = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.id, req.params.id),
    eq(atelierBankTransaction.orgId, me.orgId),
    isNull(atelierBankTransaction.deletedAt),
  ));
  if (!txn) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true, data: { txn } });
});

// Re-run matching for a single txn (after correcting counterparty data etc).
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/rematch", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  if (txn.amount >= 0) return res.status(400).json({ error: "invalid_input", message: "Rematch is for outflows; inflows use /wallet/cash/match." });
  const candidates = await proposeOutflowCandidates({
    orgId: me.orgId, counterpartyNameRaw: txn.counterpartyNameRaw, amountAbs: Math.abs(txn.amount),
    entityId: await resolveTxnEntity(txn),
  });
  await db.update(atelierBankTransaction).set({
    matchProposal: { type: "outflow", candidates, proposedAt: new Date().toISOString() },
    matchedState: candidates.length > 0 ? "proposed" : "unmatched",
    parkedReason: null, parkedByUserId: null,
    updatedAt: new Date(),
  }).where(eq(atelierBankTransaction.id, txn.id));
  return res.json({ ok: true, data: { candidates } });
});

// ─────────────────────── inflow confirm (AR update + GL via Bookkeeper) ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/confirm", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { invoiceId?: string; candidateIndex?: number; appliedAmount?: number; rationale?: string };
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  if (txn.amount <= 0) return res.status(400).json({ error: "invalid_input", message: "Confirm is for inflows; use outflow-confirm or journal for outflows." });
  const proposal = txn.matchProposal as {
    cashReceiptId?: string;
    recommended?: string | { invoiceId: string | null };
    candidates?: Array<{ invoiceId?: string | null }>;
  } | null;
  const recommendedInvoiceId =
    (typeof proposal?.recommended === "object" && proposal.recommended?.invoiceId)
      ? proposal.recommended.invoiceId
      : (proposal?.candidates?.[0]?.invoiceId ?? null);
  // Task #1077 — pick a ranked candidate by index (recon exceptions panel).
  // Resolved server-side against the CURRENT stored proposal so a stale UI
  // index can't silently apply the wrong invoice.
  let candidateInvoiceId: string | null = null;
  if (b.candidateIndex !== undefined) {
    if (!Number.isInteger(b.candidateIndex) || b.candidateIndex < 0
      || !proposal?.candidates || b.candidateIndex >= proposal.candidates.length) {
      return res.status(400).json({ error: "invalid_input", message: "candidateIndex out of range for the stored match proposal." });
    }
    candidateInvoiceId = proposal.candidates[b.candidateIndex]?.invoiceId ?? null;
    if (!candidateInvoiceId) return res.status(400).json({ error: "invalid_input", message: "Selected candidate has no invoiceId." });
    if (b.invoiceId && b.invoiceId !== candidateInvoiceId)
      return res.status(400).json({ error: "invalid_input", message: "invoiceId and candidateIndex disagree; send one or the other." });
  }
  // Correction UX: an explicit invoiceId in the body overrides the proposal.
  const invoiceId = b.invoiceId ?? candidateInvoiceId ?? recommendedInvoiceId ?? null;
  if (!invoiceId) return res.status(400).json({ error: "invalid_input", message: "No invoiceId (no proposal recommendation and none supplied)." });
  // Resolve (or create) the receipt row.
  let receiptId = proposal?.cashReceiptId ?? null;
  if (!receiptId) {
    const existing = await db.select({ id: atelierCashReceipt.id }).from(atelierCashReceipt)
      .where(and(eq(atelierCashReceipt.orgId, me.orgId), eq(atelierCashReceipt.bankTransactionId, txn.id)));
    if (existing.length > 0) receiptId = existing[0].id;
    else {
      receiptId = rid("rcpt");
      await db.insert(atelierCashReceipt).values({
        id: receiptId, orgId: me.orgId, bankTransactionId: txn.id,
        totalAmount: txn.amount, appliedAmount: 0, currency: txn.currency,
        receivedAt: txn.postedDate, createdByUserId: me.id,
      });
    }
  }
  const [receipt] = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.id, receiptId), eq(atelierCashReceipt.orgId, me.orgId)));
  if (!receipt) return res.status(404).json({ error: "receipt_not_found" });
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt)));
  if (!inv) return res.status(404).json({ error: "invoice_not_found" });
  const txnEntity = await resolveTxnEntity(txn);
  if (!entityCompatible(txnEntity, inv.legalEntityId))
    return res.status(400).json({ error: "entity_mismatch", message: "Invoice belongs to a different legal entity than this bank transaction." });
  const outstanding = round2(inv.total - inv.amountPaid);
  const remaining = round2(receipt.totalAmount - receipt.appliedAmount);
  const applied = round2(Math.min(b.appliedAmount ?? remaining, remaining, outstanding));
  if (applied <= 0) return res.status(400).json({ error: "nothing_to_apply", remaining, outstanding });
  const appId = rid("capp");
  await db.insert(atelierCashApplication).values({
    id: appId, orgId: me.orgId, cashReceiptId: receipt.id, invoiceId: inv.id,
    appliedAmount: applied, currency: receipt.currency,
    appliedByUserId: me.id,
    rationaleText: b.rationale ?? (b.invoiceId && b.invoiceId !== recommendedInvoiceId
      ? "Manual correction of matcher proposal" : "Confirmed matcher proposal"),
    createdByUserId: me.id,
  });
  const newPaid = round2(inv.amountPaid + applied);
  await db.update(atelierInvoice).set({
    amountPaid: newPaid,
    status: newPaid >= inv.total - 0.01 ? "paid" : inv.status,
    paidAt: newPaid >= inv.total - 0.01 ? new Date() : inv.paidAt,
    updatedAt: new Date(),
  }).where(eq(atelierInvoice.id, inv.id));
  await db.update(atelierCashReceipt).set({
    appliedAmount: round2(receipt.appliedAmount + applied), updatedAt: new Date(),
  }).where(eq(atelierCashReceipt.id, receipt.id));
  await db.update(atelierBankTransaction).set({
    matchedState: "matched", matchedRefKind: "invoice_application", matchedRefId: appId,
    parkedReason: null, parkedByUserId: null, updatedAt: new Date(),
  }).where(eq(atelierBankTransaction.id, txn.id));
  // Task #1091 — cash-application auto-post policy (blueprint §4).
  // IMPORTANT: today the cash-application MATCHER only PROPOSES candidates
  // (runCashApplicationMatcher writes matchProposal; it never applies), and
  // application is ALWAYS a human confirm through this endpoint. So there is
  // no unattended auto-apply path to gate — the engine call here classifies
  // whether this confirm matched the engine's auto-eligible shape (exact
  // single candidate, no operator override) and records that reason for the
  // audit/review-&-revise contract. If a future agent gains an auto-apply
  // path, it MUST call evaluateAutoPost({kind:"cash_application", ...}) and
  // treat auto:true as the ONLY authorization to skip this human confirm.
  const candidateCount = proposal?.candidates?.length ?? 0;
  const cashThresholds = await loadFinanceAutopilotThresholds(me.orgId);
  const cashPolicy = evaluateAutoPost({
    kind: "cash_application",
    thresholds: cashThresholds,
    exactSingleCandidate: candidateCount === 1 && (!b.invoiceId || b.invoiceId === recommendedInvoiceId),
  });
  await audit({ entityType: "bank_transaction", entityId: txn.id, actor: me,
    action: "cash_triage.confirm_inflow",
    payload: { receiptId: receipt.id, invoiceId: inv.id, applied, applicationId: appId,
      autopilot: { auto: cashPolicy.auto, reasons: cashPolicy.reasons } },
    summary: `Confirmed receipt ${receipt.currency} ${applied} → invoice ${inv.invoiceNumber ?? inv.id}` });
  // GL via Bookkeeper: deterministic + idempotent per source row, so a
  // failed posting can safely be retried from the GL screen.
  let glPosting: { status: "posted" | "failed"; message?: string } = { status: "posted" };
  try {
    const entityId = txn.legalEntityId ?? undefined;
    await runBookkeeper({
      orgId: me.orgId,
      input: { periodLabel: txn.postedDate.slice(0, 7), entityId },
      triggeredByUserId: me.id,
    });
  } catch (err) {
    glPosting = { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
  return res.json({ ok: true, data: { applicationId: appId, applied, invoiceStatus: newPaid >= inv.total - 0.01 ? "paid" : inv.status, glPosting } });
});

// ─────────────────────── outflow confirm (match to source) ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/outflow-confirm", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { refKind?: string; refId?: string };
  if (!b.refKind || !b.refId || !["contractor_payment", "partner_firm_invoice", "expense"].includes(b.refKind))
    return res.status(400).json({ error: "invalid_input", message: "refKind (contractor_payment|partner_firm_invoice|expense) + refId required" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  if (txn.amount >= 0) return res.status(400).json({ error: "invalid_input", message: "Outflow-confirm is for negative rows." });
  const txnEntity = await resolveTxnEntity(txn);
  const entityMismatch = () => res.status(400).json({ error: "entity_mismatch", message: "Source row belongs to a different legal entity than this bank transaction." });
  // Validate the source row exists (org-scoped) and is entity-compatible.
  let label = "";
  if (b.refKind === "contractor_payment") {
    const [r] = await db.select().from(atelierContractorPayments)
      .where(and(eq(atelierContractorPayments.id, b.refId), eq(atelierContractorPayments.orgId, me.orgId), isNull(atelierContractorPayments.deletedAt)));
    if (!r) return res.status(404).json({ error: "source_not_found" });
    if (!entityCompatible(txnEntity, r.legalEntityId)) return entityMismatch();
    label = `${r.payeeName} ${r.weekIso}`;
    if (r.status !== "paid") {
      await db.update(atelierContractorPayments).set({ status: "paid", paidAt: new Date(), paidByUserId: me.id, updatedAt: new Date() })
        .where(eq(atelierContractorPayments.id, r.id));
    }
  } else if (b.refKind === "partner_firm_invoice") {
    const [r] = await db.select().from(atelierPartnerFirmInvoices)
      .where(and(eq(atelierPartnerFirmInvoices.id, b.refId), eq(atelierPartnerFirmInvoices.orgId, me.orgId), isNull(atelierPartnerFirmInvoices.deletedAt)));
    if (!r) return res.status(404).json({ error: "source_not_found" });
    if (!entityCompatible(txnEntity, r.legalEntityId)) return entityMismatch();
    label = `${r.partnerFirmName} ${r.weekIso}`;
    if (r.status !== "paid") {
      await db.update(atelierPartnerFirmInvoices).set({ status: "paid", paidAt: new Date(), paidByUserId: me.id, updatedAt: new Date() })
        .where(eq(atelierPartnerFirmInvoices.id, r.id));
    }
  } else {
    const [r] = await db.select().from(atelierExpenses)
      .where(and(eq(atelierExpenses.id, b.refId), eq(atelierExpenses.orgId, me.orgId), isNull(atelierExpenses.deletedAt)));
    if (!r) return res.status(404).json({ error: "source_not_found" });
    label = `${r.merchant ?? "expense"} ${r.expenseDate}`;
  }
  await db.update(atelierBankTransaction).set({
    matchedState: "matched", matchedRefKind: b.refKind, matchedRefId: b.refId,
    parkedReason: null, parkedByUserId: null, updatedAt: new Date(),
  }).where(eq(atelierBankTransaction.id, txn.id));
  await audit({ entityType: "bank_transaction", entityId: txn.id, actor: me,
    action: "cash_triage.confirm_outflow",
    payload: { refKind: b.refKind, refId: b.refId, amount: txn.amount },
    summary: `Matched outflow ${txn.currency} ${Math.abs(txn.amount)} to ${b.refKind} (${label})` });
  // GL posting for the source row (Bookkeeper is idempotent per source).
  let glPosting: { status: "posted" | "failed"; message?: string } = { status: "posted" };
  try {
    await runBookkeeper({
      orgId: me.orgId,
      input: { periodLabel: txn.postedDate.slice(0, 7), entityId: txn.legalEntityId ?? undefined },
      triggeredByUserId: me.id,
    });
  } catch (err) {
    glPosting = { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
  return res.json({ ok: true, data: { matchedRefKind: b.refKind, matchedRefId: b.refId, glPosting } });
});

// ─────────────────────── outflow manual journal ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/journal", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { expenseAccountCode?: string; memo?: string };
  if (!b.expenseAccountCode) return res.status(400).json({ error: "invalid_input", message: "expenseAccountCode required" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  if (txn.amount >= 0) return res.status(400).json({ error: "invalid_input", message: "Journal is for outflows." });
  let entityId = txn.legalEntityId;
  if (!entityId) {
    const [acct] = await db.select().from(atelierBankAccount).where(eq(atelierBankAccount.id, txn.bankAccountId));
    entityId = acct?.legalEntityId ?? null;
  }
  if (!entityId) return res.status(400).json({ error: "no_entity", message: "Bank account has no legal entity; tag the account first." });
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, me.orgId),
    eq(atelierGlAccount.legalEntityId, entityId),
    eq(atelierGlAccount.active, true),
    isNull(atelierGlAccount.deletedAt),
    inArray(atelierGlAccount.code, [b.expenseAccountCode, "1000"]),
  ));
  const expAcct = accounts.find((a) => a.code === b.expenseAccountCode);
  const cashAcct = accounts.find((a) => a.code === "1000");
  if (!expAcct) return res.status(400).json({ error: "missing_account", accountCode: b.expenseAccountCode });
  if (!cashAcct) return res.status(400).json({ error: "missing_account", accountCode: "1000", message: "Seed the chart of accounts first." });
  const amt = round2(Math.abs(txn.amount));
  const memo = b.memo ?? `Bank outflow: ${txn.counterpartyNameRaw ?? txn.referenceRaw ?? txn.id}`;
  const entryId = rid("gljrn");
  await db.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: me.orgId, legalEntityId: entityId!,
      periodLabel: txn.postedDate.slice(0, 7), entryDate: txn.postedDate, kind: "manual",
      sourceKind: "bank_transaction", sourceRef: txn.id, memo,
      currency: "USD", totalDebit: amt, totalCredit: amt, createdByUserId: me.id,
    });
    await tx.insert(atelierGlJournalLine).values({
      id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
      accountId: expAcct.id, accountCode: expAcct.code, accountName: expAcct.name,
      debit: amt, credit: 0, memo,
    });
    await tx.insert(atelierGlJournalLine).values({
      id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
      accountId: cashAcct.id, accountCode: cashAcct.code, accountName: cashAcct.name,
      debit: 0, credit: amt, memo: "Cash out",
    });
    await tx.update(atelierBankTransaction).set({
      matchedState: "journaled", glJournalEntryId: entryId,
      parkedReason: null, parkedByUserId: null, updatedAt: new Date(),
    }).where(eq(atelierBankTransaction.id, txn.id));
  });
  await audit({ entityType: "gl_journal_entry", entityId: entryId, actor: me,
    action: "cash_triage.journal",
    payload: { bankTransactionId: txn.id, expenseAccountCode: b.expenseAccountCode, amount: amt },
    summary: `Journaled bank outflow $${amt} → ${expAcct.code} ${expAcct.name}` });
  return res.status(201).json({ ok: true, data: { journalEntryId: entryId } });
});

// ─────────────────────── classify (Task #1071 exception resolution) ───────────────────────
// Resolve a bank row that has no invoice/source counterpart by marking it
// as a bank fee, internal transfer or other non-matchable item.
const CLASSIFICATIONS = new Set(["bank_fee", "internal_transfer", "other"]);
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/classify", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { classification?: string; note?: string };
  if (!b.classification || !CLASSIFICATIONS.has(b.classification))
    return res.status(400).json({ error: "invalid_input", message: "classification (bank_fee|internal_transfer|other) required" });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  await db.update(atelierBankTransaction).set({
    matchedState: "matched", matchedRefKind: "other", matchedRefId: null,
    kind: b.classification === "bank_fee" ? "fee" : txn.kind,
    notes: `classified:${b.classification}${note ? ` — ${note}` : ""}`,
    parkedReason: null, parkedByUserId: null, updatedAt: new Date(),
  }).where(eq(atelierBankTransaction.id, txn.id));
  await audit({ entityType: "bank_transaction", entityId: txn.id, actor: me,
    action: "cash_triage.classify",
    payload: { classification: b.classification, note, amount: txn.amount },
    summary: `Classified bank txn ${txn.currency} ${txn.amount} as ${b.classification.replace("_", " ")}` });
  return res.json({ ok: true, data: { classification: b.classification } });
});

// ─────────────────────── park ───────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/triage/:id/park", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const reason = (req.body as { reason?: string }).reason;
  if (!reason || reason.trim().length < 4) return res.status(400).json({ error: "invalid_input", message: "Reason required (≥4 chars)." });
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.id, req.params.id), eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)));
  if (!txn) return res.status(404).json({ error: "not_found" });
  if (txn.matchedState === "matched" || txn.matchedState === "journaled")
    return res.status(409).json({ error: "already_resolved", state: txn.matchedState });
  await db.update(atelierBankTransaction).set({
    matchedState: "parked", parkedReason: reason.trim(), parkedByUserId: me.id, updatedAt: new Date(),
  }).where(eq(atelierBankTransaction.id, txn.id));
  await audit({ entityType: "bank_transaction", entityId: txn.id, actor: me,
    action: "cash_triage.park",
    payload: { reason: reason.trim(), amount: txn.amount },
    summary: `Parked bank txn ${txn.currency} ${txn.amount}: ${reason.trim()}` });
  return res.json({ ok: true });
});

// ─────────────────────── forecast ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/forecast/latest", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const [latest] = await db.select({ snapshotId: atelierCashForecastSnapshot.snapshotId, snapshotAt: atelierCashForecastSnapshot.snapshotAt })
    .from(atelierCashForecastSnapshot)
    .where(eq(atelierCashForecastSnapshot.orgId, me.orgId))
    .orderBy(desc(atelierCashForecastSnapshot.snapshotAt)).limit(1);
  if (!latest) return res.json({ ok: true, data: { snapshotId: null, weeks: [] } });
  const weeks = await db.select().from(atelierCashForecastSnapshot).where(and(
    eq(atelierCashForecastSnapshot.orgId, me.orgId),
    eq(atelierCashForecastSnapshot.snapshotId, latest.snapshotId),
  )).orderBy(atelierCashForecastSnapshot.weekIndex);
  return res.json({ ok: true, data: { snapshotId: latest.snapshotId, snapshotAt: latest.snapshotAt, weeks } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/forecast/run", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const out = await runCashFlowForecaster({
    asOf: new Date().toISOString().slice(0, 10),
    currency: "USD", openingBalance: 0, orgId: me.orgId,
    triggeredByUserId: me.id, actorLabel: me.name,
  });
  return res.json({ ok: true, data: out.output, runId: out.runId });
});

// ─────────────────────── working capital ───────────────────────
// @cli-skip: pending Task #340 read-parity migration
router.get("/working-capital", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  // Cash position = per-account opening balance + posted txn sum.
  const accts = await db.select().from(atelierBankAccount).where(and(
    eq(atelierBankAccount.orgId, me.orgId), isNull(atelierBankAccount.deletedAt), eq(atelierBankAccount.isActive, true),
  ));
  const txnSums = await db.select({
    bankAccountId: atelierBankTransaction.bankAccountId,
    total: sql<number>`coalesce(sum(${atelierBankTransaction.amount}), 0)`,
  }).from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)))
    .groupBy(atelierBankTransaction.bankAccountId);
  const sumByAcct = new Map(txnSums.map((t) => [t.bankAccountId, Number(t.total)]));
  const cashByAccount = accts.map((a) => ({
    id: a.id, label: `${a.bankName} ${a.accountLabel}`, legalEntityId: a.legalEntityId,
    currency: a.currency, balance: round2(a.openingBalance + (sumByAcct.get(a.id) ?? 0)),
  }));
  const cashTotal = round2(cashByAccount.reduce((s, a) => s + a.balance, 0));
  // AR = open invoices.
  const invoices = (await db.select().from(atelierInvoice)
    .where(and(eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt))))
    .filter((i) => i.status !== "draft" && i.status !== "void" && i.total - i.amountPaid > 0.01);
  const today = new Date().toISOString().slice(0, 10);
  const arOpen = round2(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0));
  const arOverdue = round2(invoices.filter((i) => i.dueDate && i.dueDate < today)
    .reduce((s, i) => s + (i.total - i.amountPaid), 0));
  // Unapplied receipts.
  const receipts = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.orgId, me.orgId), isNull(atelierCashReceipt.deletedAt)));
  const unapplied = round2(receipts.reduce((s, r) => s + Math.max(0, r.totalAmount - r.appliedAmount), 0));
  // AP-like: approved-but-unpaid outflows.
  const cps = await db.select().from(atelierContractorPayments).where(and(
    eq(atelierContractorPayments.orgId, me.orgId), isNull(atelierContractorPayments.deletedAt),
    eq(atelierContractorPayments.status, "partner_approved"),
  ));
  const pfis = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, me.orgId), isNull(atelierPartnerFirmInvoices.deletedAt),
    eq(atelierPartnerFirmInvoices.status, "partner_approved"),
  ));
  const exps = await db.select().from(atelierExpenses).where(and(
    eq(atelierExpenses.orgId, me.orgId), isNull(atelierExpenses.deletedAt),
    eq(atelierExpenses.status, "approved"),
  ));
  const apContractor = round2(cps.reduce((s, r) => s + r.usdAmount, 0));
  const apPartnerFirm = round2(pfis.reduce((s, r) => s + r.usdAmount, 0));
  const apExpenses = round2(exps.filter((e) => e.fundingSource === "personal_claim").reduce((s, r) => s + r.usdAmount, 0));
  const apTotal = round2(apContractor + apPartnerFirm + apExpenses);
  // Triage queue counts.
  const triage = await db.select({
    state: atelierBankTransaction.matchedState,
    n: sql<number>`count(*)`,
  }).from(atelierBankTransaction)
    .where(and(eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)))
    .groupBy(atelierBankTransaction.matchedState);
  const triageCounts = Object.fromEntries(triage.map((t) => [t.state, Number(t.n)]));
  return res.json({
    ok: true,
    data: {
      asOf: today,
      cash: { total: cashTotal, byAccount: cashByAccount },
      ar: { open: arOpen, overdue: arOverdue, invoiceCount: invoices.length },
      unappliedReceipts: unapplied,
      ap: { total: apTotal, contractorPayments: apContractor, partnerFirmInvoices: apPartnerFirm, reimbursableExpenses: apExpenses },
      netWorkingCapital: round2(cashTotal + arOpen - apTotal),
      triageCounts,
    },
  });
});

export default router;

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
import { runCashApplicationMatcher } from "../../lib/atelier-agents/runner.js";

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
router.get("/receipts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const rows = await db.select().from(atelierCashReceipt)
    .where(and(eq(atelierCashReceipt.orgId, me.orgId), isNull(atelierCashReceipt.deletedAt)))
    .orderBy(desc(atelierCashReceipt.receivedAt)).limit(200);
  return res.json({ ok: true, data: { rows } });
});

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

export default router;

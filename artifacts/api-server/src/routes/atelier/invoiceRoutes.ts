/**
 * Task #362 — Atelier L2C Wave 3 routes.
 *
 * Surfaces:
 *   GET    /wallet/invoices                        list (scoped + filtered)
 *   GET    /wallet/invoices/:id                    invoice + lines + submissions + dunning
 *   POST   /wallet/invoices                        create draft (engagementId, jurisdiction, billTo)
 *   POST   /wallet/invoices/:id/compose            seed lines from time + expenses
 *   POST   /wallet/invoices/:id/lines              add fee/adjustment line
 *   POST   /wallet/invoices/:id/issue              mint invoice_number + e-invoice submit
 *   POST   /wallet/invoices/:id/void               irreversible void (founding_partner)
 *   POST   /wallet/invoices/:id/payment            record cash receipt
 *   GET    /wallet/ar/aging                        AR aging buckets
 *   GET    /wallet/dunning/ladders                 list templates
 *   POST   /wallet/dunning/:invoiceId/send         send next ladder step (partner approver)
 *   POST   /wallet/dunning/:invoiceId/promise      record promise-to-pay
 *   POST   /wallet/dunning/:invoiceId/promise/:pid/keep
 *   POST   /wallet/dunning/:invoiceId/promise/:pid/break
 *
 * Wave 1 (#360) and Wave 2 (#361) are NOT shipped: bill_to is a free-text
 * fallback and `compose` draws from time + expenses only (no milestones / WIP).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEngagements,
  atelierAccounts,
  atelierExpenses,
  atelierTimesheetEntries,
  atelierAuditEvents,
  atelierInvoice,
  atelierInvoiceLine,
  atelierInvoiceSequence,
  atelierEinvoiceSubmission,
  atelierDunningLadder,
  atelierDunningEvent,
  atelierPromiseToPay,
} from "@workspace/db";
import { assertAuditAction } from "./auditContract.js";
import {
  channelForJurisdiction,
  submitEinvoice,
} from "../../lib/atelier-einvoice.js";
import {
  isRestrictedPersona,
  isBoardObserver,
} from "./personaRoles.js";

const router: IRouter = Router();

// ─────────────── persona deny gates ───────────────
// Restricted personas (contractor, partner_firm_resource, recruiter) are
// blocked from every Wave 3 surface. board_observer is denied on
// invoice / dunning detail (per-line + per-customer) but allowed on the
// AR rollup view (`ar_aging_report`).
function denyRestricted(req: Request, res: Response): boolean {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return true; }
  if (isRestrictedPersona(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Wave 3 capabilities are denied for this persona." });
    return true;
  }
  return false;
}
function denyBoardObserver(req: Request, res: Response): boolean {
  const me = req.atelierPersona;
  if (me && isBoardObserver(me.role)) {
    res.status(403).json({ error: "forbidden", message: "board_observer cannot read invoice / dunning detail (rollup-only access)." });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- helpers
function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function isPartnerTier(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function isFinanceLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return isPartnerTier(me) || me.role === "finance";
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

const VAT_RATE_BY_JURISDICTION: Record<string, number> = {
  AE: 5,
  SA: 15,
  EU: 20,
  GLOBAL: 0,
};

const JURISDICTIONS = new Set(["AE", "SA", "EU", "GLOBAL"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function recomputeTotals(
  lines: Array<{ amount: number }>,
  vatRatePct: number,
): { subtotal: number; vat: number; total: number } {
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vat = round2((subtotal * vatRatePct) / 100);
  const total = round2(subtotal + vat);
  return { subtotal, vat, total };
}

async function loadFull(orgId: string, invoiceId: string) {
  const [inv] = await db
    .select()
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, invoiceId),
      eq(atelierInvoice.orgId, orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) return null;
  const lines = await db
    .select()
    .from(atelierInvoiceLine)
    .where(eq(atelierInvoiceLine.invoiceId, invoiceId))
    .orderBy(atelierInvoiceLine.ord);
  const submissions = await db
    .select()
    .from(atelierEinvoiceSubmission)
    .where(eq(atelierEinvoiceSubmission.invoiceId, invoiceId));
  const dunningEvents = await db
    .select()
    .from(atelierDunningEvent)
    .where(eq(atelierDunningEvent.invoiceId, invoiceId))
    .orderBy(desc(atelierDunningEvent.sentAt));
  const promises = await db
    .select()
    .from(atelierPromiseToPay)
    .where(eq(atelierPromiseToPay.invoiceId, invoiceId))
    .orderBy(desc(atelierPromiseToPay.createdAt));
  return { invoice: inv, lines, submissions, dunningEvents, promises };
}

// =============================================================== list/get
router.get("/wallet/invoices", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const status = String(req.query.status ?? "all");
  const where = [isNull(atelierInvoice.deletedAt), eq(atelierInvoice.orgId, me.orgId)];
  if (status !== "all") where.push(eq(atelierInvoice.status, status));
  const rows = await db
    .select()
    .from(atelierInvoice)
    .where(and(...where))
    .orderBy(desc(atelierInvoice.createdAt))
    .limit(500);
  res.json({ invoices: rows });
});

router.get("/wallet/invoices/:id", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const full = await loadFull(me.orgId, req.params.id);
  if (!full) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(full);
});

// =============================================================== create draft
router.post("/wallet/invoices", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me) && me.role !== "senior_manager") {
    res.status(403).json({ error: "forbidden", message: "Only partner-tier, finance, or senior_manager may draft invoices." });
    return;
  }
  const b = req.body ?? {};
  const jurisdiction = String(b.jurisdiction ?? "GLOBAL").toUpperCase();
  if (!JURISDICTIONS.has(jurisdiction)) {
    res.status(400).json({ error: "invalid_input", message: `Unknown jurisdiction "${jurisdiction}"` });
    return;
  }
  const id = rid("inv");
  const billTo = (b.billTo && typeof b.billTo === "object") ? b.billTo : {};
  const vatRatePct = typeof b.vatRatePct === "number" ? b.vatRatePct : VAT_RATE_BY_JURISDICTION[jurisdiction] ?? 0;
  await db.insert(atelierInvoice).values({
    id,
    orgId: me.orgId,
    engagementId: b.engagementId ?? null,
    accountId: b.accountId ?? null,
    jurisdiction,
    currency: String(b.currency ?? "USD"),
    status: "draft",
    billTo,
    vatRatePct,
    notes: b.notes ?? null,
    dueDate: b.dueDate ?? null,
    createdByUserId: me.id,
  });
  await audit({
    entityType: "invoice",
    entityId: id,
    actor: me,
    action: "wallet.invoice.drafted",
    payload: { jurisdiction, engagementId: b.engagementId ?? null },
    summary: `Drafted invoice (${jurisdiction})`,
  });
  const full = await loadFull(me.orgId, id);
  res.status(201).json(full);
});

// =============================================================== compose lines (time + expenses)
router.post("/wallet/invoices/:id/compose", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me) && me.role !== "senior_manager") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const invoiceId = req.params.id;
  const [inv] = await db
    .select()
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, invoiceId),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (inv.status !== "draft") {
    res.status(400).json({ error: "invalid_state", message: "Compose only allowed in draft state." });
    return;
  }
  if (!inv.engagementId) {
    res.status(400).json({ error: "invalid_input", message: "engagementId required to compose lines." });
    return;
  }
  const b = req.body ?? {};
  const fromDate = String(b.fromDate ?? "1900-01-01");
  const toDate = String(b.toDate ?? "2999-12-31");
  const defaultRate = typeof b.defaultRateUsd === "number" ? b.defaultRateUsd : 250;

  // Existing lines first (so we can append + reorder).
  const existing = await db
    .select()
    .from(atelierInvoiceLine)
    .where(eq(atelierInvoiceLine.invoiceId, invoiceId));
  // Naive de-dup: skip already-billed source refs.
  const billedRefs = new Set(existing.map((l) => l.sourceRef).filter(Boolean) as string[]);

  // Time entries — billable, approved, in window.
  const timeRows = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(
      and(
        eq(atelierTimesheetEntries.engagementId, inv.engagementId),
        eq(atelierTimesheetEntries.billable, true),
        eq(atelierTimesheetEntries.status, "approved"),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    );
  const timeInWindow = timeRows.filter(
    (t) => t.workDate >= fromDate && t.workDate <= toDate && !billedRefs.has(t.id),
  );

  // Expenses — client_billable, approved, in window.
  const expRows = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, inv.engagementId),
        eq(atelierExpenses.clientBillable, true),
        eq(atelierExpenses.status, "approved"),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  const expInWindow = expRows.filter(
    (e) => e.expenseDate >= fromDate && e.expenseDate <= toDate && !billedRefs.has(e.id),
  );

  let ord = existing.length;
  const newLines: Array<typeof atelierInvoiceLine.$inferInsert> = [];

  // Aggregate time per person+date as a single line for readability.
  const timeByPerson = new Map<string, { hours: number; ids: string[] }>();
  for (const t of timeInWindow) {
    const k = t.personId;
    const v = timeByPerson.get(k) ?? { hours: 0, ids: [] };
    v.hours += t.hours;
    v.ids.push(t.id);
    timeByPerson.set(k, v);
  }
  for (const [personId, agg] of timeByPerson) {
    const amount = round2(agg.hours * defaultRate);
    newLines.push({
      id: rid("invl"),
      orgId: me.orgId,
      invoiceId,
      ord: ord++,
      description: `Professional services — ${personId} (${agg.hours.toFixed(2)} hrs)`,
      qty: agg.hours,
      unitPrice: defaultRate,
      amount,
      sourceKind: "time",
      sourceRef: agg.ids.join(","),
    });
  }
  for (const e of expInWindow) {
    const markup = 1 + (e.markupPct ?? 0) / 100;
    const amount = round2(e.usdAmount * markup);
    newLines.push({
      id: rid("invl"),
      orgId: me.orgId,
      invoiceId,
      ord: ord++,
      description: `Reimbursable: ${e.merchant ?? e.category} (${e.expenseDate})`,
      qty: 1,
      unitPrice: amount,
      amount,
      sourceKind: "expense",
      sourceRef: e.id,
    });
  }

  if (newLines.length > 0) {
    await db.insert(atelierInvoiceLine).values(newLines);
    await audit({
      entityType: "invoice",
      entityId: invoiceId,
      actor: me,
      action: "wallet.invoice.line_added",
      payload: { lineCount: newLines.length, source: "compose", fromDate, toDate },
      summary: `Composed ${newLines.length} lines from time+expenses`,
    });
  }

  // Recompute totals.
  const allLines = [...existing, ...newLines.map((l) => ({ amount: l.amount as number }))];
  const tot = recomputeTotals(allLines, inv.vatRatePct);
  await db
    .update(atelierInvoice)
    .set({ subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total, updatedAt: new Date() })
    .where(eq(atelierInvoice.id, invoiceId));

  res.json({ added: newLines.length, ...(await loadFull(me.orgId, invoiceId)) });
});

// =============================================================== add manual line
router.post("/wallet/invoices/:id/lines", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me) && me.role !== "senior_manager") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [inv] = await db
    .select()
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, req.params.id),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) { res.status(404).json({ error: "not_found" }); return; }
  if (inv.status !== "draft") { res.status(400).json({ error: "invalid_state" }); return; }
  const b = req.body ?? {};
  const qty = Number(b.qty ?? 1);
  const unitPrice = Number(b.unitPrice ?? 0);
  const amount = round2(qty * unitPrice);
  const lineId = rid("invl");
  const existingCount = await db.select({ c: sql<number>`count(*)::int` })
    .from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, inv.id));
  await db.insert(atelierInvoiceLine).values({
    id: lineId,
    orgId: me.orgId,
    invoiceId: inv.id,
    ord: existingCount[0]?.c ?? 0,
    description: String(b.description ?? "Fee"),
    qty,
    unitPrice,
    amount,
    sourceKind: String(b.sourceKind ?? "fee"),
    sourceRef: b.sourceRef ?? null,
  });
  const all = await db.select({ amount: atelierInvoiceLine.amount })
    .from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, inv.id));
  const tot = recomputeTotals(all, inv.vatRatePct);
  await db.update(atelierInvoice)
    .set({ subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total, updatedAt: new Date() })
    .where(eq(atelierInvoice.id, inv.id));
  await audit({
    entityType: "invoice", entityId: inv.id, actor: me,
    action: "wallet.invoice.line_added",
    payload: { lineId, amount }, summary: `Added line ($${amount})`,
  });
  res.json(await loadFull(me.orgId, inv.id));
});

// =============================================================== issue (mint number + e-invoice)
router.post("/wallet/invoices/:id/issue", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerTier(me)) {
    res.status(403).json({ error: "forbidden", message: "Partner-tier required to issue invoices." });
    return;
  }
  const invoiceId = req.params.id;

  const result = await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(atelierInvoice)
      .where(and(
        eq(atelierInvoice.id, invoiceId),
        eq(atelierInvoice.orgId, me.orgId),
        isNull(atelierInvoice.deletedAt),
      ))
      .for("update");
    if (!inv) return { error: "not_found" as const };
    if (inv.status !== "draft") return { error: "invalid_state" as const };
    const lines = await tx.select().from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, inv.id));
    if (lines.length === 0) return { error: "empty_invoice" as const };
    const billToOk = inv.billTo && (inv.billTo.name || inv.billTo.contactEmail);
    if (!billToOk) return { error: "invalid_input" as const, msg: "bill_to.name or bill_to.contactEmail required to issue." };
    // ZATCA Phase-2 precheck: KSA invoices require buyer VRN.
    if (inv.jurisdiction === "SA" && !inv.billTo?.vatId) {
      return { error: "zatca_vrn_required" as const, msg: "ZATCA submission blocked: buyer VRN (bill_to.vatId) required for SA invoices." };
    }

    // Mint gap-free number under SELECT FOR UPDATE — partitioned per
    // (org, jurisdiction, calendar year) so numbers reset annually.
    const yearPart = new Date().getUTCFullYear();
    const seqRows = await tx
      .select()
      .from(atelierInvoiceSequence)
      .where(and(
        eq(atelierInvoiceSequence.orgId, inv.orgId),
        eq(atelierInvoiceSequence.jurisdiction, inv.jurisdiction),
        eq(atelierInvoiceSequence.yearPart, yearPart),
      ))
      .for("update");
    let seqRow = seqRows[0];
    if (!seqRow) {
      await tx.insert(atelierInvoiceSequence).values({
        orgId: inv.orgId,
        jurisdiction: inv.jurisdiction,
        yearPart,
        prefix: `${inv.jurisdiction}-INV-${yearPart}`,
        lastSeq: 0,
      });
      seqRow = { orgId: inv.orgId, jurisdiction: inv.jurisdiction, yearPart, prefix: `${inv.jurisdiction}-INV-${yearPart}`, lastSeq: 0, updatedAt: new Date() };
    }
    const next = seqRow.lastSeq + 1;
    const invoiceNumber = `${seqRow.prefix}-${String(next).padStart(6, "0")}`;
    await tx.update(atelierInvoiceSequence)
      .set({ lastSeq: next, updatedAt: new Date() })
      .where(and(
        eq(atelierInvoiceSequence.orgId, inv.orgId),
        eq(atelierInvoiceSequence.jurisdiction, inv.jurisdiction),
        eq(atelierInvoiceSequence.yearPart, yearPart),
      ));

    const tot = recomputeTotals(lines, inv.vatRatePct);
    const issuedAt = new Date();
    const dueDate = inv.dueDate ?? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    await tx.update(atelierInvoice)
      .set({
        invoiceNumber, status: "issued", issuedAt, dueDate,
        subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total,
        updatedAt: new Date(),
      })
      .where(eq(atelierInvoice.id, inv.id));

    return { ok: true as const, invoiceNumber, issuedAt, lines, inv: { ...inv, invoiceNumber, issuedAt, status: "issued", subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total } };
  });

  if ("error" in result && result.error) {
    const status = result.error === "not_found" ? 404 : result.error === "zatca_vrn_required" ? 422 : 400;
    res.status(status).json({ error: result.error, message: (result as { msg?: string }).msg });
    return;
  }
  if (!("ok" in result) || !result.ok) {
    res.status(500).json({ error: "issue_failed" });
    return;
  }

  // Outside the tx: e-invoice channel submission (stub).
  const channel = channelForJurisdiction(result.inv.jurisdiction);
  if (channel) {
    const sub = await submitEinvoice({ invoice: result.inv as typeof atelierInvoice.$inferSelect, lines: result.lines });
    await db.insert(atelierEinvoiceSubmission).values({
      id: rid("eis"),
      orgId: result.inv.orgId,
      invoiceId: result.inv.id,
      channel: sub.channel,
      status: sub.status,
      submissionPayloadRef: sub.submissionPayloadRef,
      responsePayloadRef: sub.responsePayloadRef,
      clearanceUuid: sub.clearanceUuid,
      qrCodePayload: sub.qrCodePayload,
      submittedAt: new Date(),
      clearedAt: sub.status === "cleared" ? new Date() : null,
      rejectedAt: sub.status === "rejected" ? new Date() : null,
      rejectedReason: sub.rejectedReason,
    });
    await audit({
      entityType: "invoice", entityId: result.inv.id, actor: me,
      action: sub.status === "cleared" ? "einvoice.cleared" : "einvoice.rejected",
      payload: { channel: sub.channel, clearanceUuid: sub.clearanceUuid },
      summary: `${sub.channel.toUpperCase()} ${sub.status}`,
    });
  }

  await audit({
    entityType: "invoice", entityId: result.inv.id, actor: me,
    action: "wallet.invoice.issued",
    payload: { invoiceNumber: result.invoiceNumber, total: result.inv.total },
    summary: `Issued ${result.invoiceNumber} ($${result.inv.total})`,
  });
  res.json(await loadFull(me.orgId, result.inv.id));
});

// =============================================================== void (irreversible)
router.post("/wallet/invoices/:id/void", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "founding_partner") {
    res.status(403).json({ error: "forbidden", message: "founding_partner required to void." });
    return;
  }
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) { res.status(400).json({ error: "invalid_input", message: "reason required" }); return; }
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, req.params.id),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) { res.status(404).json({ error: "not_found" }); return; }
  // Void is a correction path on already-issued invoices. Drafts can be
  // discarded directly without leaving a void record in the audit trail.
  if (inv.status !== "issued") {
    res.status(400).json({ error: "invalid_state", message: "Only issued invoices can be voided. Drafts can be deleted." });
    return;
  }
  await db.update(atelierInvoice)
    .set({ status: "void", voidedAt: new Date(), voidedReason: reason, updatedAt: new Date() })
    .where(eq(atelierInvoice.id, inv.id));
  await audit({
    entityType: "invoice", entityId: inv.id, actor: me,
    action: "wallet.invoice.voided",
    payload: { reason, invoiceNumber: inv.invoiceNumber }, summary: `Voided: ${reason}`,
  });
  res.json(await loadFull(me.orgId, inv.id));
});

// =============================================================== record payment
router.post("/wallet/invoices/:id/payment", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me)) { res.status(403).json({ error: "forbidden" }); return; }
  const amount = Number(req.body?.amount ?? 0);
  if (!(amount > 0)) { res.status(400).json({ error: "invalid_input", message: "amount > 0 required" }); return; }
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, req.params.id),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) { res.status(404).json({ error: "not_found" }); return; }
  if (inv.status !== "issued") { res.status(400).json({ error: "invalid_state" }); return; }
  const newPaid = round2(inv.amountPaid + amount);
  const fullyPaid = newPaid + 0.005 >= inv.total;
  await db.update(atelierInvoice).set({
    amountPaid: newPaid,
    status: fullyPaid ? "paid" : "issued",
    paidAt: fullyPaid ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(atelierInvoice.id, inv.id));
  await audit({
    entityType: "invoice", entityId: inv.id, actor: me,
    action: "wallet.invoice.payment_recorded",
    payload: { amount, newPaid, fullyPaid }, summary: `Payment $${amount}`,
  });
  res.json(await loadFull(me.orgId, inv.id));
});

// =============================================================== AR aging
router.get("/wallet/ar/aging", async (req, res) => {
  // AR aging is the rollup view — board_observer is allowed here per L2C
  // §C.3 ("ar_aging_report" rollup-only access). Restricted personas
  // (contractor / partner_firm_resource / recruiter) remain denied.
  if (denyRestricted(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const groupBy = String(req.query.group ?? "customer");
  if (!["customer", "engagement", "partner"].includes(groupBy)) {
    res.status(400).json({ error: "invalid_input", message: "group must be customer | engagement | partner" });
    return;
  }
  const rows = await db.select().from(atelierInvoice).where(
    and(
      isNull(atelierInvoice.deletedAt),
      eq(atelierInvoice.orgId, me.orgId),
      inArray(atelierInvoice.status, ["issued", "paid"]),
    ),
  );
  const today = new Date();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  type AgedRow = {
    invoice: typeof atelierInvoice.$inferSelect;
    daysOverdue: number;
    outstanding: number;
    bucket: keyof typeof buckets;
  };
  const aged: AgedRow[] = [];
  // DSO numerator: outstanding receivable. Denominator: revenue in last 90d.
  let revenue90d = 0;
  const ninetyAgo = today.getTime() - 90 * 86400_000;
  for (const r of rows) {
    const outstanding = round2(r.total - r.amountPaid);
    if (r.issuedAt && new Date(r.issuedAt).getTime() >= ninetyAgo) revenue90d += r.total;
    if (outstanding <= 0 || r.status === "paid") continue;
    const due = r.dueDate ? new Date(r.dueDate) : today;
    const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400_000));
    let bucket: keyof typeof buckets;
    if (days === 0) bucket = "current";
    else if (days <= 30) bucket = "d1_30";
    else if (days <= 60) bucket = "d31_60";
    else if (days <= 90) bucket = "d61_90";
    else bucket = "d90_plus";
    buckets[bucket] += outstanding;
    aged.push({ invoice: r, daysOverdue: days, outstanding, bucket });
  }
  aged.sort((a, b) => b.daysOverdue - a.daysOverdue);

  // Grouped rollup.
  type Group = { key: string; label: string; totalUsd: number; invoiceCount: number; oldestDays: number };
  const groups = new Map<string, Group>();
  for (const a of aged) {
    let key = "—";
    let label = "—";
    if (groupBy === "customer") {
      const billTo = a.invoice.billTo as { name?: string } | null;
      key = billTo?.name ?? "—";
      label = billTo?.name ?? "Unknown customer";
    } else if (groupBy === "engagement") {
      key = a.invoice.engagementId ?? "—";
      label = a.invoice.engagementId ?? "No engagement";
    } else {
      key = a.invoice.createdByUserId ?? "—";
      label = a.invoice.createdByUserId ?? "—";
    }
    const g = groups.get(key) ?? { key, label, totalUsd: 0, invoiceCount: 0, oldestDays: 0 };
    g.totalUsd = round2(g.totalUsd + a.outstanding);
    g.invoiceCount += 1;
    g.oldestDays = Math.max(g.oldestDays, a.daysOverdue);
    groups.set(key, g);
  }

  const totalOutstanding = round2(Object.values(buckets).reduce((s, v) => s + v, 0));
  const dso = revenue90d > 0 ? Math.round((totalOutstanding / revenue90d) * 90) : 0;
  const delinquentCount = aged.filter((a) => a.daysOverdue > 0).length;

  // board_observer only sees the rollup — no per-invoice rows leaked.
  const includeRows = !isBoardObserver(me.role);

  res.json({
    buckets: Object.entries(buckets).map(([k, v]) => ({ bucket: k, totalUsd: round2(v) })),
    totalOutstandingUsd: totalOutstanding,
    invoiceCount: aged.length,
    delinquentCount,
    dso,
    groupBy,
    groups: Array.from(groups.values()).sort((a, b) => b.totalUsd - a.totalUsd),
    rows: includeRows ? aged.slice(0, 200) : [],
  });
});

// =============================================================== dunning ladders
router.get("/wallet/dunning/ladders", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const ladders = await db.select().from(atelierDunningLadder).where(isNull(atelierDunningLadder.deletedAt));
  res.json({ ladders });
});

// =============================================================== next-action (recommend ladder step)
router.get("/wallet/dunning/next-action", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const invoiceId = req.query.invoiceId ? String(req.query.invoiceId) : undefined;
  const where = [
    isNull(atelierInvoice.deletedAt),
    eq(atelierInvoice.orgId, me.orgId),
    eq(atelierInvoice.status, "issued"),
  ];
  if (invoiceId) where.push(eq(atelierInvoice.id, invoiceId));
  const invoices = await db.select().from(atelierInvoice).where(and(...where));
  const today = new Date();
  type NextAction = {
    invoiceId: string;
    invoiceNumber: string | null;
    customerName: string;
    daysOverdue: number;
    outstanding: number;
    nextStep: { stepIndex: number; template: string; channel: string; requireApproval: boolean } | null;
    reason: string;
  };
  const out: NextAction[] = [];
  for (const inv of invoices) {
    const outstanding = round2(inv.total - inv.amountPaid);
    if (outstanding <= 0) continue;
    const due = inv.dueDate ? new Date(inv.dueDate) : today;
    const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400_000));
    const [ladder] = await db.select().from(atelierDunningLadder).where(
      and(eq(atelierDunningLadder.jurisdiction, inv.jurisdiction), eq(atelierDunningLadder.isDefault, true), isNull(atelierDunningLadder.deletedAt)),
    );
    if (!ladder) continue;
    const events = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, inv.id));
    const stepIndex = events.length;
    const step = ladder.steps[stepIndex] ?? null;
    const billTo = inv.billTo as { name?: string } | null;
    // Suppress recommendation if a future open P2P exists.
    const openPromises = await db.select().from(atelierPromiseToPay).where(
      and(eq(atelierPromiseToPay.invoiceId, inv.id), eq(atelierPromiseToPay.status, "open")),
    );
    const futureP = openPromises.find((p) => new Date(p.promisedDate).getTime() >= today.getTime());
    let reason: string;
    let recommended: typeof step | null = step;
    if (futureP) {
      reason = `Hold — open promise-to-pay through ${futureP.promisedDate}`;
      recommended = null;
    } else if (!step) {
      reason = "Ladder exhausted — escalate or write off.";
    } else if (days < step.offsetDays) {
      reason = `Wait — step "${step.template}" fires at +${step.offsetDays}d (currently +${days}d)`;
      recommended = null;
    } else {
      reason = `Step ${stepIndex + 1} of ${ladder.steps.length}`;
    }
    out.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: billTo?.name ?? "—",
      daysOverdue: days,
      outstanding,
      nextStep: recommended ? { stepIndex, template: recommended.template, channel: recommended.channel, requireApproval: !!recommended.requireApproval } : null,
      reason,
    });
  }
  out.sort((a, b) => b.daysOverdue - a.daysOverdue);
  res.json({ nextActions: out });
});

// =============================================================== send next dunning step
router.post("/wallet/dunning/:invoiceId/send", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const invoiceId = req.params.invoiceId;
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, invoiceId),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) { res.status(404).json({ error: "not_found" }); return; }
  if (inv.status !== "issued") { res.status(400).json({ error: "invalid_state", message: "Only issued invoices can be dunned." }); return; }

  // Pick default ladder for jurisdiction.
  const [ladder] = await db.select().from(atelierDunningLadder).where(
    and(eq(atelierDunningLadder.jurisdiction, inv.jurisdiction), eq(atelierDunningLadder.isDefault, true), isNull(atelierDunningLadder.deletedAt)),
  );
  if (!ladder) { res.status(400).json({ error: "no_ladder", message: `No default ladder for ${inv.jurisdiction}` }); return; }

  // Determine current step.
  const events = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, invoiceId));
  const stepIndex = events.length;
  if (stepIndex >= ladder.steps.length) {
    res.status(400).json({ error: "ladder_exhausted", message: "All ladder steps already sent." });
    return;
  }
  const step = ladder.steps[stepIndex];

  // Honor ladder cadence: don't escalate before this step's `offsetDays`
  // have elapsed since the due date.
  const today = new Date();
  const dueDate = inv.dueDate ? new Date(inv.dueDate) : today;
  const daysOverdue = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86400_000));
  if (daysOverdue < step.offsetDays) {
    res.status(400).json({
      error: "step_not_due_yet",
      message: `Step "${step.template}" fires at +${step.offsetDays}d (currently +${daysOverdue}d).`,
    });
    return;
  }

  // Honor open promise-to-pay: if the customer has a future P2P open,
  // suppress further dunning until the promise is kept or broken.
  const openPromises = await db.select().from(atelierPromiseToPay).where(
    and(eq(atelierPromiseToPay.invoiceId, invoiceId), eq(atelierPromiseToPay.status, "open")),
  );
  const future = openPromises.find((p) => new Date(p.promisedDate).getTime() >= today.getTime());
  if (future) {
    res.status(400).json({
      error: "promise_open",
      message: `Open promise-to-pay through ${future.promisedDate} — suppress dunning until the promise is kept or broken.`,
    });
    return;
  }

  if (step.requireApproval && !isPartnerTier(me)) {
    res.status(403).json({ error: "forbidden", message: `Step "${step.template}" requires partner approval.` });
    return;
  }

  const eventId = rid("dun");
  await db.insert(atelierDunningEvent).values({
    id: eventId,
    orgId: me.orgId,
    invoiceId,
    ladderId: ladder.id,
    stepIndex,
    channel: step.channel,
    template: step.template,
    messageRef: `enc:wallet:dunning/${invoiceId}/step-${stepIndex}`,
    sentBy: me.id,
  });
  await audit({
    entityType: "invoice", entityId: invoiceId, actor: me,
    action: "dunning.notice.sent",
    payload: { stepIndex, template: step.template, channel: step.channel, ladderId: ladder.id },
    summary: `Sent ${step.template} (step ${stepIndex + 1})`,
  });
  res.json({ event: { id: eventId, stepIndex, template: step.template }, ...(await loadFull(me.orgId, invoiceId)) });
});

// =============================================================== promise-to-pay
router.post("/wallet/dunning/:invoiceId/promise", async (req, res) => {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const invoiceId = req.params.invoiceId;
  const b = req.body ?? {};
  const promisedAmount = Number(b.promisedAmount ?? 0);
  const promisedDate = String(b.promisedDate ?? "");
  if (!(promisedAmount > 0) || !promisedDate) {
    res.status(400).json({ error: "invalid_input", message: "promisedAmount and promisedDate required" });
    return;
  }
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.id, invoiceId),
      eq(atelierInvoice.orgId, me.orgId),
      isNull(atelierInvoice.deletedAt),
    ));
  if (!inv) { res.status(404).json({ error: "not_found" }); return; }
  const id = rid("p2p");
  await db.insert(atelierPromiseToPay).values({
    id, orgId: me.orgId, invoiceId,
    promisedAmount, promisedDate,
    contactName: b.contactName ?? null,
    notes: b.notes ?? null,
    recordedBy: me.id,
  });
  await audit({
    entityType: "invoice", entityId: invoiceId, actor: me,
    action: "dunning.promise.recorded",
    payload: { promisedAmount, promisedDate, contactName: b.contactName ?? null },
    summary: `P2P $${promisedAmount} by ${promisedDate}`,
  });
  res.json(await loadFull(me.orgId, invoiceId));
});

async function transitionPromise(req: Request, res: Response, status: "kept" | "broken") {
  if (denyRestricted(req, res)) return;
  if (denyBoardObserver(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const { invoiceId, pid } = req.params;
  // Verify the promise belongs to an invoice in the caller's org before mutating.
  const [promise] = await db.select().from(atelierPromiseToPay).where(
    and(eq(atelierPromiseToPay.id, pid), eq(atelierPromiseToPay.invoiceId, invoiceId), eq(atelierPromiseToPay.orgId, me.orgId)),
  );
  if (!promise) { res.status(404).json({ error: "not_found" }); return; }
  await db.update(atelierPromiseToPay)
    .set({ status, updatedAt: new Date() })
    .where(eq(atelierPromiseToPay.id, pid));
  await audit({
    entityType: "invoice", entityId: invoiceId, actor: me,
    action: status === "kept" ? "dunning.promise.kept" : "dunning.promise.broken",
    payload: { promiseId: pid }, summary: status === "kept" ? "Promise kept" : "Promise broken",
  });
  res.json(await loadFull(me.orgId, invoiceId));
}
router.post("/wallet/dunning/:invoiceId/promise/:pid/keep", (req, res) => transitionPromise(req, res, "kept"));
router.post("/wallet/dunning/:invoiceId/promise/:pid/break", (req, res) => transitionPromise(req, res, "broken"));

export default router;

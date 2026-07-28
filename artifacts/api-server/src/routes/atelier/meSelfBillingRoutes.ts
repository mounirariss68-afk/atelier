/**
 * Task #430 — Me-lens self-billing surfaces.
 *
 * Counterparties (contractors and partner-firm resources) view and
 * download the self-billed (RCTI) invoices raised on their behalf, and
 * can dispute one before it is paid. Strictly self-scoped:
 *  - contractor: invoices whose supplier is the contractor row matching
 *    the caller's email (or payeeUserId = caller id);
 *  - partner_firm_resource: invoices of the caller's partner firm
 *    (resolved via atelier_partner_firm_resources by email).
 *
 * Mounted with the other /me routers so the self-only-persona allowlist
 * (routes/atelier/index.ts) already covers these paths.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierSelfBilledInvoices,
  atelierContractors,
  atelierPartnerFirmResources,
} from "@workspace/db";
import PDFDocument from "pdfkit";
import { writeSelfBilledInvoicePdf } from "../../lib/selfBilledInvoicePdf.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";

type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/**
 * Resolve the caller's supplier identity. Returns null when the caller
 * is not a self-billing counterparty (e.g. an employee).
 */
async function resolveSupplierScope(me: Me): Promise<
  | { supplierType: "contractor"; supplierIds: string[] }
  | { supplierType: "partner_firm"; supplierIds: string[] }
  | null
> {
  const email = me.email.trim().toLowerCase();
  const cons = await db
    .select({ id: atelierContractors.id, email: atelierContractors.email })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.orgId, me.orgId), isNull(atelierContractors.deletedAt)));
  const mine = cons.filter((c) => (c.email ?? "").trim().toLowerCase() === email).map((c) => c.id);
  if (mine.length > 0) return { supplierType: "contractor", supplierIds: mine };
  const pfrs = await db
    .select({ partnerFirmId: atelierPartnerFirmResources.partnerFirmId, email: atelierPartnerFirmResources.email })
    .from(atelierPartnerFirmResources)
    .where(and(eq(atelierPartnerFirmResources.orgId, me.orgId), isNull(atelierPartnerFirmResources.deletedAt)));
  const firms = [...new Set(pfrs.filter((r) => (r.email ?? "").trim().toLowerCase() === email).map((r) => r.partnerFirmId))];
  if (firms.length > 0) return { supplierType: "partner_firm", supplierIds: firms };
  return null;
}

async function loadOwnInvoice(me: Me, id: string) {
  const [inv] = await db
    .select()
    .from(atelierSelfBilledInvoices)
    .where(and(
      eq(atelierSelfBilledInvoices.id, id),
      eq(atelierSelfBilledInvoices.orgId, me.orgId),
      isNull(atelierSelfBilledInvoices.deletedAt),
    ));
  if (!inv) return null;
  if (inv.payeeUserId === me.id) return inv;
  const scope = await resolveSupplierScope(me);
  if (scope && scope.supplierType === inv.supplierType && scope.supplierIds.includes(inv.supplierId)) return inv;
  return null;
}

function selfWire(inv: typeof atelierSelfBilledInvoices.$inferSelect) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    supplierType: inv.supplierType,
    supplierName: inv.supplierName,
    weekIso: inv.weekIso,
    currency: inv.currency,
    lines: inv.lines,
    subtotalAmount: inv.subtotalAmount,
    vat: inv.vat,
    vatAmount: inv.vatAmount,
    totalAmount: inv.totalAmount,
    status: inv.status,
    disputeReason: inv.disputeReason,
    disputedAt: inv.disputedAt?.toISOString() ?? null,
    disputeResolutionNote: inv.disputeResolutionNote,
    disputeResolvedAt: inv.disputeResolvedAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    remittanceRef: inv.remittanceRef,
    createdAt: inv.createdAt.toISOString(),
  };
}

// @cli-skip: self-scope Me-lens read; CLI parity not planned
router.get("/me/self-billing", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const scope = await resolveSupplierScope(me);
    const conds = [eq(atelierSelfBilledInvoices.orgId, me.orgId), isNull(atelierSelfBilledInvoices.deletedAt)];
    let rows: Array<typeof atelierSelfBilledInvoices.$inferSelect> = [];
    if (scope) {
      rows = await db
        .select()
        .from(atelierSelfBilledInvoices)
        .where(and(
          ...conds,
          eq(atelierSelfBilledInvoices.supplierType, scope.supplierType),
          or(
            inArray(atelierSelfBilledInvoices.supplierId, scope.supplierIds),
            eq(atelierSelfBilledInvoices.payeeUserId, me.id),
          ),
        ))
        .orderBy(desc(atelierSelfBilledInvoices.weekIso));
    } else {
      rows = await db
        .select()
        .from(atelierSelfBilledInvoices)
        .where(and(...conds, eq(atelierSelfBilledInvoices.payeeUserId, me.id)))
        .orderBy(desc(atelierSelfBilledInvoices.weekIso));
    }
    // Rejected drafts are internal; counterparties only see issued paper.
    res.json({ items: rows.filter((r) => r.status !== "rejected").map(selfWire) });
  } catch (err) { next(err); }
});

// @cli-skip: self-scope Me-lens read; CLI parity not planned
router.get("/me/self-billing/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const inv = await loadOwnInvoice(me, req.params.id);
    if (!inv || inv.status === "rejected") { res.status(404).json({ error: "not-found" }); return; }
    res.json({ invoice: selfWire(inv) });
  } catch (err) { next(err); }
});

// @cli-skip: self-scope Me-lens binary download; CLI parity not planned
router.get("/me/self-billing/:id/pdf", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const inv = await loadOwnInvoice(me, req.params.id);
    if (!inv || inv.status === "rejected") { res.status(404).json({ error: "not-found" }); return; }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${inv.invoiceNumber}.pdf`));
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);
    writeSelfBilledInvoicePdf(doc, inv);
    doc.end();
  } catch (err) { next(err); }
});

// @cli-skip: self-scope Me-lens write; CLI parity not planned
router.post("/me/self-billing/:id/dispute", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const inv = await loadOwnInvoice(me, req.params.id);
    if (!inv || inv.status === "rejected") { res.status(404).json({ error: "not-found" }); return; }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 2000) : "";
    if (!reason) { res.status(400).json({ error: "reason-required" }); return; }
    if (inv.status === "paid") {
      res.status(409).json({ error: "already-paid", message: "This invoice is already paid — contact finance directly." });
      return;
    }
    if (inv.status === "disputed") {
      res.status(409).json({ error: "already-disputed" });
      return;
    }
    if (inv.status === "scheduled" && inv.paymentRunId) {
      res.status(409).json({ error: "in-payment-run", message: "This invoice is in an active payment run — contact finance directly." });
      return;
    }
    await db.update(atelierSelfBilledInvoices).set({
      status: "disputed",
      disputedByUserId: me.id,
      disputedAt: new Date(),
      disputeReason: reason,
      disputeResolvedByUserId: null,
      disputeResolvedAt: null,
      disputeResolutionNote: null,
      updatedAt: new Date(),
    }).where(eq(atelierSelfBilledInvoices.id, inv.id));
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"), orgId: me.orgId,
      entityType: "self_billed_invoice", entityId: inv.id,
      actorType: "human", actorId: me.id, actorLabel: me.name,
      action: "finance.self_billing.dispute",
      payload: { invoiceNumber: inv.invoiceNumber, reason },
      payloadSummary: `${me.name} disputed self-billed invoice ${inv.invoiceNumber}.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: self-scope Me-lens write; CLI parity not planned
router.post("/me/self-billing/:id/withdraw-dispute", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const inv = await loadOwnInvoice(me, req.params.id);
    if (!inv) { res.status(404).json({ error: "not-found" }); return; }
    if (inv.status !== "disputed" || inv.disputedByUserId !== me.id) {
      res.status(409).json({ error: "not-your-dispute" });
      return;
    }
    await db.update(atelierSelfBilledInvoices).set({
      status: "draft",
      disputeResolvedByUserId: me.id,
      disputeResolvedAt: new Date(),
      disputeResolutionNote: "Dispute withdrawn by the counterparty.",
      updatedAt: new Date(),
    }).where(eq(atelierSelfBilledInvoices.id, inv.id));
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"), orgId: me.orgId,
      entityType: "self_billed_invoice", entityId: inv.id,
      actorType: "human", actorId: me.id, actorLabel: me.name,
      action: "finance.self_billing.withdraw_dispute",
      payload: { invoiceNumber: inv.invoiceNumber },
      payloadSummary: `${me.name} withdrew the dispute on ${inv.invoiceNumber}.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

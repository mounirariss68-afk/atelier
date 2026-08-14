/**
 * Task #875 — Partner contracts & billing hub.
 *
 * Portal side (alliance_partner logins, strictly scoped to their own firm):
 *   - GET  /partner-portal/contracts                  — firm agreements (e-sign
 *     registry via the shared normalized-name join) + explicitly shared
 *     contract-lifecycle records.
 *   - GET  /partner-portal/contracts/:id/download     — signed/converted PDF of
 *     an actively shared contract record.
 *   - GET/POST /partner-portal/inbox                  — the firm's own document
 *     uploads (e.g. countersigned copies) into the internal review inbox.
 *   - GET/POST /partner-portal/invoices (+/:id/file)  — submit AP invoices
 *     (PDF + amount/currency/reference/period) and track their status.
 *   - GET  /partner-portal/issued                     — read-only Cognirise-
 *     issued RCTIs raised on the firm.
 *
 * Internal side (partners-lens editors):
 *   - GET/POST /partners/firms/:firmId/contract-shares (+ /:shareId/revoke)
 *   - GET  /partners/doc-inbox (+ /:id/download)
 *   - POST /partners/doc-inbox/:id/review — accept (creates a contract record
 *     + auto-share) or reject with a note. All writes audited.
 *
 * Finance AP review lives in financePayablesRoutes.ts
 * (/finance/payables/partner-invoices*).
 *
 * The central gate in routes/atelier/index.ts already restricts
 * /partner-portal/* to alliance partners and /partners/* to the partners
 * lens; the checks here are defense-in-depth.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import multer from "multer";
import {
  db,
  atelierUsers,
  atelierPartnerFirms,
  atelierPartnerContractShares,
  atelierPartnerDocInbox,
  atelierPartnerFirmInvoices,
  atelierSelfBilledInvoices,
  atelierContractRecords,
  atelierContractDocuments,
} from "@workspace/db";
import { audit } from "./engagementRoutes";
import { canEditPartnersLens } from "./personaRoles";
import { resolveAlliancePartnerFirm } from "./partnerPortalRoutes";
import { partnerAgreementItems } from "./partnersRoutes";
import {
  CONTRACT_MAX_BYTES,
  looksLikeDocx,
  storeContractBytes,
  loadContractBytes,
  addContractDocument,
  CONTRACT_TYPES,
  type ContractType,
} from "../../lib/atelier-contracts.js";
import { proposeSupplierInvoiceAllocation } from "../../lib/atelier-entity-allocation.js";
import { convertToUsd } from "../../lib/atelier-fx.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import { randomBytes } from "node:crypto";

const router: IRouter = Router();
type Me = typeof atelierUsers.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/** Portal gate: alliance_partner persona resolved to its (signed) firm. */
async function portalFirm(
  req: Request,
  res: Response,
): Promise<{ me: Me; firm: typeof atelierPartnerFirms.$inferSelect } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (me.role !== "alliance_partner") {
    res.status(403).json({ error: "partner-portal-only" });
    return null;
  }
  const firm = await resolveAlliancePartnerFirm(me);
  if (!firm) {
    res.status(403).json({ error: "no-partner-firm", message: "This login is not linked to an active partner firm." });
    return null;
  }
  return { me, firm };
}

/** Internal gate: partners-lens editor. */
function internalEditor(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!canEditPartnersLens(me.role)) {
    res.status(403).json({ error: "partners-edit-restricted" });
    return null;
  }
  return me;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONTRACT_MAX_BYTES },
});
function uploadSingle(req: Request, res: Response, cb: () => void): void {
  upload.single("file")(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: "upload-failed", message: err.message });
      return;
    }
    if (err) {
      res.status(400).json({ error: "upload-failed" });
      return;
    }
    cb();
  });
}

function looksLikePdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString("latin1").startsWith("%PDF-");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// ---------------------------------------------------------------------------
// Shared wires
// ---------------------------------------------------------------------------

function inboxWire(row: typeof atelierPartnerDocInbox.$inferSelect) {
  return {
    id: row.id,
    partnerFirmId: row.partnerFirmId,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    note: row.note,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    contractId: row.contractId,
    uploadedByLabel: row.uploadedByLabel,
    createdAt: row.createdAt.toISOString(),
  };
}

function portalInvoiceWire(row: typeof atelierPartnerFirmInvoices.$inferSelect) {
  return {
    id: row.id,
    reference: row.reference,
    periodLabel: row.periodLabel,
    invoiceDate: row.invoiceDate,
    amount: row.costAmount,
    currency: row.costCurrency,
    status: row.status,
    notes: row.notes,
    fileName: row.fileName,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    paidAt: row.paidAt?.toISOString() ?? null,
    remittanceRef: row.remittanceRef,
  };
}

async function activeSharesForFirm(orgId: string, firmId: string) {
  return db
    .select()
    .from(atelierPartnerContractShares)
    .where(and(
      eq(atelierPartnerContractShares.orgId, orgId),
      eq(atelierPartnerContractShares.partnerFirmId, firmId),
      isNull(atelierPartnerContractShares.revokedAt),
    ))
    .orderBy(desc(atelierPartnerContractShares.createdAt));
}

/** Latest downloadable PDF doc (signed preferred) per contract. */
async function downloadableDocs(contractIds: string[]) {
  if (contractIds.length === 0) return new Map<string, typeof atelierContractDocuments.$inferSelect>();
  const docs = await db
    .select()
    .from(atelierContractDocuments)
    .where(and(
      inArray(atelierContractDocuments.contractId, contractIds),
      inArray(atelierContractDocuments.kind, ["signed_pdf", "converted_pdf"]),
    ))
    .orderBy(desc(atelierContractDocuments.createdAt));
  const best = new Map<string, typeof atelierContractDocuments.$inferSelect>();
  for (const d of docs) {
    const cur = best.get(d.contractId);
    if (!cur) { best.set(d.contractId, d); continue; }
    if (cur.kind !== "signed_pdf" && d.kind === "signed_pdf") best.set(d.contractId, d);
  }
  return best;
}

// ===========================================================================
// PORTAL — Contracts tab
// ===========================================================================

// @cli-skip: Task #875 partner-portal raw-fetch surface
router.get("/partner-portal/contracts", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    const { me, firm } = ctx;
    // Agreements from the e-sign registry, keyed on partnerFirmId via the
    // shared deterministic join (never name matching in the UI).
    const agreements = (await partnerAgreementItems(me.orgId))
      .filter((a) => a.partnerFirmId === firm.id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        instrumentType: a.instrumentType,
        status: a.status,
        governingLaw: a.governingLaw,
        termStart: a.termStart,
        termEnd: a.termEnd,
        fullyExecutedAt: a.fullyExecutedAt?.toISOString?.() ?? a.fullyExecutedAt ?? null,
      }));

    const shares = await activeSharesForFirm(me.orgId, firm.id);
    const contractIds = [...new Set(shares.map((s) => s.contractId))];
    const records = contractIds.length
      ? await db.select().from(atelierContractRecords).where(and(
          eq(atelierContractRecords.orgId, me.orgId),
          inArray(atelierContractRecords.id, contractIds),
        ))
      : [];
    const recById = new Map(records.map((r) => [r.id, r]));
    const docByContract = await downloadableDocs(contractIds);
    const shared = shares.flatMap((s) => {
      const r = recById.get(s.contractId);
      if (!r) return [];
      return [{
        id: r.id,
        title: r.title,
        contractType: r.contractType,
        status: r.status,
        effectiveDate: r.effectiveDate?.toISOString() ?? null,
        expiryDate: r.expiryDate?.toISOString() ?? null,
        sharedAt: s.createdAt.toISOString(),
        note: s.note,
        canDownload: docByContract.has(r.id),
      }];
    });
    res.json({ firm: { id: firm.id, name: firm.name }, agreements, shared });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 binary download; not CLI-exposable
router.get("/partner-portal/contracts/:id/download", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    const { me, firm } = ctx;
    const shares = await activeSharesForFirm(me.orgId, firm.id);
    if (!shares.some((s) => s.contractId === req.params.id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const doc = (await downloadableDocs([req.params.id])).get(req.params.id);
    if (!doc) { res.status(404).json({ error: "no-downloadable-document" }); return; }
    const bytes = await loadContractBytes(doc.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", doc.fileName));
    res.send(bytes);
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 partner-portal raw-fetch surface
router.get("/partner-portal/inbox", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    const rows = await db.select().from(atelierPartnerDocInbox).where(and(
      eq(atelierPartnerDocInbox.orgId, ctx.me.orgId),
      eq(atelierPartnerDocInbox.partnerFirmId, ctx.firm.id),
      isNull(atelierPartnerDocInbox.deletedAt),
    )).orderBy(desc(atelierPartnerDocInbox.createdAt));
    res.json({ items: rows.map(inboxWire) });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 multipart upload; not CLI-exposable
router.post("/partner-portal/inbox", (req, res, next) => {
  uploadSingle(req, res, async () => {
    try {
      const ctx = await portalFirm(req, res);
      if (!ctx) return;
      const { me, firm } = ctx;
      const file = req.file;
      if (!file || file.size === 0) { res.status(400).json({ error: "file-required" }); return; }
      const isPdf = looksLikePdf(file.buffer);
      const isDocx = file.originalname.toLowerCase().endsWith(".docx") && looksLikeDocx(file.buffer);
      if (!isPdf && !isDocx) {
        res.status(400).json({ error: "unsupported-file", message: "Upload a PDF or DOCX document." });
        return;
      }
      const note = str(req.body?.note, 2000) || null;
      const { blobRef, sha256 } = await storeContractBytes(file.buffer);
      const id = rid("pdi");
      await db.insert(atelierPartnerDocInbox).values({
        id,
        orgId: me.orgId,
        partnerFirmId: firm.id,
        uploadedByUserId: me.id,
        uploadedByLabel: me.name,
        fileName: file.originalname.slice(0, 300),
        mime: isPdf ? "application/pdf" : file.mimetype,
        sizeBytes: file.size,
        sha256,
        blobRef,
        note,
      });
      await audit({
        entityType: "partner_doc_inbox", entityId: id, actor: me,
        action: "partner_portal.document.upload",
        payload: { partnerFirmId: firm.id, fileName: file.originalname, sizeBytes: file.size, sha256 },
        summary: `${firm.name} uploaded "${file.originalname}" to the review inbox.`,
      });
      const [row] = await db.select().from(atelierPartnerDocInbox).where(eq(atelierPartnerDocInbox.id, id));
      res.status(201).json({ ok: true, item: inboxWire(row) });
    } catch (err) { next(err); }
  });
});

// ===========================================================================
// PORTAL — Billing tab
// ===========================================================================

// @cli-skip: Task #875 partner-portal raw-fetch surface
router.get("/partner-portal/invoices", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    const rows = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ctx.me.orgId),
      eq(atelierPartnerFirmInvoices.partnerFirmId, ctx.firm.id),
      eq(atelierPartnerFirmInvoices.source, "partner_submitted"),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    )).orderBy(desc(atelierPartnerFirmInvoices.createdAt));
    res.json({ items: rows.map(portalInvoiceWire) });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 multipart upload; not CLI-exposable
router.post("/partner-portal/invoices", (req, res, next) => {
  uploadSingle(req, res, async () => {
    try {
      const ctx = await portalFirm(req, res);
      if (!ctx) return;
      const { me, firm } = ctx;
      const file = req.file;
      if (!file || file.size === 0) { res.status(400).json({ error: "file-required" }); return; }
      if (!looksLikePdf(file.buffer)) {
        res.status(400).json({ error: "pdf-required", message: "Invoice must be a PDF." });
        return;
      }
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
        res.status(400).json({ error: "invalid-amount" });
        return;
      }
      const currency = str(req.body?.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) { res.status(400).json({ error: "invalid-currency" }); return; }
      const reference = str(req.body?.reference, 100);
      if (!reference) { res.status(400).json({ error: "reference-required" }); return; }
      const periodLabel = str(req.body?.periodLabel, 60) || null;
      const invoiceDate = str(req.body?.invoiceDate, 10) || null;
      const notes = str(req.body?.notes, 2000) || null;

      const now = new Date();
      const fx = await convertToUsd(amount, currency, now);
      const { blobRef, sha256 } = await storeContractBytes(file.buffer);
      const id = rid("pfi");
      await db.insert(atelierPartnerFirmInvoices).values({
        id,
        orgId: me.orgId,
        partnerFirmId: firm.id,
        partnerFirmName: firm.name,
        engagementId: null,
        weekIso: periodLabel ?? invoiceDate ?? now.toISOString().slice(0, 10),
        hours: 0,
        costAmount: amount,
        costCurrency: currency,
        fxRate: fx.rate,
        usdAmount: +fx.usdAmount.toFixed(2),
        status: "submitted",
        source: "partner_submitted",
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
      // Task #1095 — prefill the entity allocation (fail-soft).
      await proposeSupplierInvoiceAllocation(id, { allowAi: false, actorId: me.id }).catch(() => null);
      await audit({
        entityType: "partner_firm_invoice", entityId: id, actor: me,
        action: "partner_portal.invoice.submit",
        payload: { partnerFirmId: firm.id, reference, amount, currency, periodLabel, sha256 },
        summary: `${firm.name} submitted invoice ${reference} (${currency} ${amount.toFixed(2)}).`,
      });
      const [row] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, id));
      res.status(201).json({ ok: true, item: portalInvoiceWire(row) });
    } catch (err) { next(err); }
  });
});

// @cli-skip: Task #875 binary download; not CLI-exposable
router.get("/partner-portal/invoices/:id/file", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    const [row] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.id, req.params.id),
      eq(atelierPartnerFirmInvoices.orgId, ctx.me.orgId),
      eq(atelierPartnerFirmInvoices.partnerFirmId, ctx.firm.id),
      eq(atelierPartnerFirmInvoices.source, "partner_submitted"),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    ));
    if (!row?.blobRef) { res.status(404).json({ error: "not-found" }); return; }
    const bytes = await loadContractBytes(row.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", row.fileName ?? `${row.id}.pdf`));
    res.send(bytes);
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 partner-portal raw-fetch surface
router.get("/partner-portal/issued", async (req, res, next) => {
  try {
    const ctx = await portalFirm(req, res);
    if (!ctx) return;
    // Cognirise-issued RCTIs raised on this firm — read-only.
    const rows = await db.select().from(atelierSelfBilledInvoices).where(and(
      eq(atelierSelfBilledInvoices.orgId, ctx.me.orgId),
      eq(atelierSelfBilledInvoices.supplierType, "partner_firm"),
      eq(atelierSelfBilledInvoices.supplierId, ctx.firm.id),
      ne(atelierSelfBilledInvoices.status, "draft"),
      isNull(atelierSelfBilledInvoices.deletedAt),
    )).orderBy(desc(atelierSelfBilledInvoices.createdAt));
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        weekIso: r.weekIso,
        currency: r.currency,
        subtotalAmount: r.subtotalAmount,
        vatAmount: r.vatAmount,
        totalAmount: r.totalAmount,
        status: r.status,
        paidAt: r.paidAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// ===========================================================================
// INTERNAL — contract shares
// ===========================================================================

async function loadFirm(orgId: string, firmId: string) {
  const [firm] = await db.select().from(atelierPartnerFirms).where(and(
    eq(atelierPartnerFirms.id, firmId),
    eq(atelierPartnerFirms.orgId, orgId),
    isNull(atelierPartnerFirms.deletedAt),
  ));
  return firm ?? null;
}

// @cli-skip: Task #875 internal partners-lens surface; raw-fetch UI wiring
router.get("/partners/firms/:firmId/contract-shares", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const firm = await loadFirm(me.orgId, req.params.firmId);
    if (!firm) { res.status(404).json({ error: "firm-not-found" }); return; }
    const shares = await db.select().from(atelierPartnerContractShares).where(and(
      eq(atelierPartnerContractShares.orgId, me.orgId),
      eq(atelierPartnerContractShares.partnerFirmId, firm.id),
    )).orderBy(desc(atelierPartnerContractShares.createdAt));
    const ids = [...new Set(shares.map((s) => s.contractId))];
    const records = ids.length
      ? await db.select({
          id: atelierContractRecords.id,
          title: atelierContractRecords.title,
          contractType: atelierContractRecords.contractType,
          status: atelierContractRecords.status,
        }).from(atelierContractRecords).where(and(
          eq(atelierContractRecords.orgId, me.orgId),
          inArray(atelierContractRecords.id, ids),
        ))
      : [];
    const recById = new Map(records.map((r) => [r.id, r]));
    res.json({
      items: shares.map((s) => ({
        id: s.id,
        contractId: s.contractId,
        contract: recById.get(s.contractId) ?? null,
        note: s.note,
        sharedByLabel: s.sharedByLabel,
        createdAt: s.createdAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 audited internal write; UI-workflow only
router.post("/partners/firms/:firmId/contract-shares", async (req, res, next) => {
  try {
    const me = internalEditor(req, res);
    if (!me) return;
    const firm = await loadFirm(me.orgId, req.params.firmId);
    if (!firm) { res.status(404).json({ error: "firm-not-found" }); return; }
    const contractId = str(req.body?.contractId, 80);
    if (!contractId) { res.status(400).json({ error: "contract-id-required" }); return; }
    const [record] = await db.select().from(atelierContractRecords).where(and(
      eq(atelierContractRecords.id, contractId),
      eq(atelierContractRecords.orgId, me.orgId),
    ));
    if (!record) { res.status(404).json({ error: "contract-not-found" }); return; }
    // Idempotent on an existing active share.
    const existing = (await activeSharesForFirm(me.orgId, firm.id)).find((s) => s.contractId === contractId);
    if (existing) { res.json({ ok: true, id: existing.id, alreadyShared: true }); return; }
    const id = rid("pcs");
    await db.insert(atelierPartnerContractShares).values({
      id,
      orgId: me.orgId,
      partnerFirmId: firm.id,
      contractId,
      note: str(req.body?.note, 2000) || null,
      sharedByUserId: me.id,
      sharedByLabel: me.name,
    });
    await audit({
      entityType: "partner_contract_share", entityId: id, actor: me,
      action: "partners.contract.share",
      payload: { partnerFirmId: firm.id, contractId, title: record.title },
      summary: `Shared contract "${record.title}" with ${firm.name}.`,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 audited internal write; UI-workflow only
router.post("/partners/firms/:firmId/contract-shares/:shareId/revoke", async (req, res, next) => {
  try {
    const me = internalEditor(req, res);
    if (!me) return;
    const [share] = await db.select().from(atelierPartnerContractShares).where(and(
      eq(atelierPartnerContractShares.id, req.params.shareId),
      eq(atelierPartnerContractShares.orgId, me.orgId),
      eq(atelierPartnerContractShares.partnerFirmId, req.params.firmId),
    ));
    if (!share) { res.status(404).json({ error: "not-found" }); return; }
    if (share.revokedAt) { res.json({ ok: true, alreadyRevoked: true }); return; }
    await db.update(atelierPartnerContractShares).set({
      revokedAt: new Date(), revokedByUserId: me.id,
    }).where(eq(atelierPartnerContractShares.id, share.id));
    await audit({
      entityType: "partner_contract_share", entityId: share.id, actor: me,
      action: "partners.contract.share_revoke",
      payload: { partnerFirmId: share.partnerFirmId, contractId: share.contractId },
      summary: `Revoked a shared contract from the partner portal.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===========================================================================
// INTERNAL — doc inbox review
// ===========================================================================

// @cli-skip: Task #875 internal partners-lens surface; raw-fetch UI wiring
router.get("/partners/doc-inbox", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const conds = [
      eq(atelierPartnerDocInbox.orgId, me.orgId),
      isNull(atelierPartnerDocInbox.deletedAt),
    ];
    if (status) conds.push(eq(atelierPartnerDocInbox.status, status));
    const rows = await db.select().from(atelierPartnerDocInbox).where(and(...conds))
      .orderBy(desc(atelierPartnerDocInbox.createdAt));
    const firmIds = [...new Set(rows.map((r) => r.partnerFirmId))];
    const firms = firmIds.length
      ? await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
          .from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.orgId, me.orgId), inArray(atelierPartnerFirms.id, firmIds)))
      : [];
    const nameById = new Map(firms.map((f) => [f.id, f.name]));
    res.json({
      items: rows.map((r) => ({
        ...inboxWire(r),
        partnerFirmName: nameById.get(r.partnerFirmId) ?? r.partnerFirmId,
      })),
    });
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 binary download; not CLI-exposable
router.get("/partners/doc-inbox/:id/download", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [row] = await db.select().from(atelierPartnerDocInbox).where(and(
      eq(atelierPartnerDocInbox.id, req.params.id),
      eq(atelierPartnerDocInbox.orgId, me.orgId),
      isNull(atelierPartnerDocInbox.deletedAt),
    ));
    if (!row) { res.status(404).json({ error: "not-found" }); return; }
    const bytes = await loadContractBytes(row.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    res.setHeader("Content-Type", row.mime);
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", row.fileName));
    res.send(bytes);
  } catch (err) { next(err); }
});

// @cli-skip: Task #875 audited internal write; UI-workflow only
router.post("/partners/doc-inbox/:id/review", async (req, res, next) => {
  try {
    const me = internalEditor(req, res);
    if (!me) return;
    const decision = str(req.body?.decision, 20);
    if (decision !== "accept" && decision !== "reject") {
      res.status(400).json({ error: "invalid-decision" });
      return;
    }
    const [row] = await db.select().from(atelierPartnerDocInbox).where(and(
      eq(atelierPartnerDocInbox.id, req.params.id),
      eq(atelierPartnerDocInbox.orgId, me.orgId),
      isNull(atelierPartnerDocInbox.deletedAt),
    ));
    if (!row) { res.status(404).json({ error: "not-found" }); return; }
    if (row.status !== "pending") {
      res.status(409).json({ error: "already-reviewed", status: row.status });
      return;
    }
    const firm = await loadFirm(me.orgId, row.partnerFirmId);
    if (!firm) { res.status(404).json({ error: "firm-not-found" }); return; }
    const reviewNote = str(req.body?.note, 2000) || null;
    const now = new Date();

    if (decision === "reject") {
      if (!reviewNote) { res.status(400).json({ error: "note-required", message: "A rejection note is required." }); return; }
      await db.update(atelierPartnerDocInbox).set({
        status: "rejected", reviewedByUserId: me.id, reviewedByLabel: me.name,
        reviewedAt: now, reviewNote, updatedAt: now,
      }).where(eq(atelierPartnerDocInbox.id, row.id));
      await audit({
        entityType: "partner_doc_inbox", entityId: row.id, actor: me,
        action: "partners.doc_inbox.reject",
        payload: { partnerFirmId: row.partnerFirmId, fileName: row.fileName, note: reviewNote },
        summary: `Rejected uploaded document "${row.fileName}" from ${firm.name}.`,
      });
      res.json({ ok: true, status: "rejected" });
      return;
    }

    // Accept → create a contract-lifecycle record + document, auto-share it.
    const title = str(req.body?.title, 300) || row.fileName.replace(/\.(pdf|docx)$/i, "");
    const rawType = str(req.body?.contractType, 60);
    const contractType: ContractType = (CONTRACT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ContractType)
      : "other";
    const bytes = await loadContractBytes(row.blobRef);
    if (!bytes) { res.status(404).json({ error: "file-missing" }); return; }
    const contractId = rid("ctr");
    await db.insert(atelierContractRecords).values({
      id: contractId,
      orgId: me.orgId,
      title,
      contractType,
      counterpartyKind: "partner_firm",
      counterpartyLabel: firm.name,
      status: "signed",
      ownerUserId: me.id,
      ownerLabel: me.name,
      notes: `Accepted from partner-portal upload ${row.id} (${row.fileName}).`,
    });
    const isPdf = row.mime === "application/pdf";
    const doc = await addContractDocument({
      contractId,
      kind: isPdf ? "signed_pdf" : "final_docx",
      fileName: row.fileName,
      mime: row.mime,
      bytes,
      actor: { id: me.id, label: me.name },
    });
    await db.update(atelierContractRecords).set({ currentDocumentId: doc.id, updatedAt: now })
      .where(eq(atelierContractRecords.id, contractId));
    const shareId = rid("pcs");
    await db.insert(atelierPartnerContractShares).values({
      id: shareId,
      orgId: me.orgId,
      partnerFirmId: firm.id,
      contractId,
      note: "Auto-shared on inbox accept.",
      sharedByUserId: me.id,
      sharedByLabel: me.name,
    });
    await db.update(atelierPartnerDocInbox).set({
      status: "accepted", reviewedByUserId: me.id, reviewedByLabel: me.name,
      reviewedAt: now, reviewNote, contractId, updatedAt: now,
    }).where(eq(atelierPartnerDocInbox.id, row.id));
    await audit({
      entityType: "partner_doc_inbox", entityId: row.id, actor: me,
      action: "partners.doc_inbox.accept",
      payload: { partnerFirmId: firm.id, fileName: row.fileName, contractId, shareId },
      summary: `Accepted "${row.fileName}" from ${firm.name} as contract "${title}".`,
    });
    res.json({ ok: true, status: "accepted", contractId });
  } catch (err) { next(err); }
});

export default router;

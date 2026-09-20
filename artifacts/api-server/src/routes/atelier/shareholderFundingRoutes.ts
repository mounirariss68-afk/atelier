/**
 * Finance MVP shareholder-funding register.
 *
 * All changes are org-scoped, partner/finance gated and audited. Funding
 * repayments and reversals append rows rather than mutating financial history.
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierLegalEntities,
  atelierPeriodCloseLock,
  atelierShareholderFunding,
  atelierDocuments,
  atelierBankTransaction,
} from "@workspace/db";
import { isFoundingPartner, isPartner } from "./personaRoles";

const router = Router();
type Me = NonNullable<Request["atelierPersona"]>;
const rid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const validDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
const validCurrency = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z]{3}$/.test(v);

function actor(req: Request, res: Response): Me | null {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  if (me.role === "recruiter") { res.status(403).json({ error: "recruiter-scope" }); return null; }
  return me;
}
function writer(me: Me, res: Response): boolean {
  if (isFoundingPartner(me.role) || isPartner(me.role) || me.role === "finance") return true;
  res.status(403).json({ error: "finance-role-required" }); return false;
}
async function locked(orgId: string, periodLabel: string): Promise<boolean> {
  const [row] = await db.select({ modules: atelierPeriodCloseLock.lockedModules })
    .from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, orgId), eq(atelierPeriodCloseLock.periodLabel, periodLabel), isNull(atelierPeriodCloseLock.deletedAt)));
  return !!row && (row.modules.length === 0 || row.modules.some((m) => ["finance_mvp", "gl", "all"].includes(m)));
}
async function audit(me: Me, id: string, action: string, payload: Record<string, unknown>) {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), orgId: me.orgId, entityType: "shareholder_funding", entityId: id,
    actorType: "human", actorId: me.id, actorLabel: me.name, action,
    payload, payloadSummary: action, createdByUserId: me.id,
  });
}
async function entity(me: Me, id: string) {
  const [row] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, id), eq(atelierLegalEntities.orgId, me.orgId), isNull(atelierLegalEntities.archivedAt)));
  return row;
}
async function sourceDoc(me: Me, id: string | null, entityId: string) {
  if (!id) return true;
  const [doc] = await db.select({ id: atelierDocuments.id }).from(atelierDocuments)
    .where(and(eq(atelierDocuments.id, id), eq(atelierDocuments.orgId, me.orgId), eq(atelierDocuments.entityId, entityId), eq(atelierDocuments.status, "active")));
  return !!doc;
}
async function bankTransaction(me: Me, id: string | null, entityId: string) {
  if (!id) return null;
  const [txn] = await db.select().from(atelierBankTransaction)
    .where(and(
      eq(atelierBankTransaction.id, id),
      eq(atelierBankTransaction.orgId, me.orgId),
      isNull(atelierBankTransaction.deletedAt),
    ));
  if (!txn || (txn.legalEntityId && txn.legalEntityId !== entityId)) return undefined;
  return txn;
}

// @cli-skip: finance register read; dedicated UI workflow
router.get("/finance/shareholder-funding", async (req, res) => {
  const me = actor(req, res); if (!me) return;
  const rows = await db.select().from(atelierShareholderFunding)
    .where(and(eq(atelierShareholderFunding.orgId, me.orgId), isNull(atelierShareholderFunding.deletedAt)))
    .orderBy(desc(atelierShareholderFunding.transactionDate), desc(atelierShareholderFunding.createdAt));
  res.json({ items: rows });
});
// @cli-skip: finance register detail; dedicated UI workflow
router.get("/finance/shareholder-funding/:id", async (req, res) => {
  const me = actor(req, res); if (!me) return;
  const [row] = await db.select().from(atelierShareholderFunding)
    .where(and(eq(atelierShareholderFunding.id, req.params.id), eq(atelierShareholderFunding.orgId, me.orgId), isNull(atelierShareholderFunding.deletedAt)));
  if (!row) { res.status(404).json({ error: "not-found" }); return; }
  const entries = await db.select().from(atelierShareholderFunding)
    .where(and(eq(atelierShareholderFunding.orgId, me.orgId), eq(atelierShareholderFunding.contributionId, row.contributionId), isNull(atelierShareholderFunding.deletedAt)))
    .orderBy(atelierShareholderFunding.createdAt);
  res.json({ contribution: row, entries });
});

// @cli-skip: finance register write; chat parity requires a confirm-flow capability
router.post("/finance/shareholder-funding", async (req, res) => {
  const me = actor(req, res); if (!me || !writer(me, res)) return;
  const b = req.body ?? {};
  const key = String(b.idempotencyKey ?? req.get("Idempotency-Key") ?? "").trim();
  if (!key || key.length > 200) { res.status(400).json({ error: "idempotency-key-required" }); return; }
  const [existing] = await db.select().from(atelierShareholderFunding)
    .where(and(eq(atelierShareholderFunding.orgId, me.orgId), eq(atelierShareholderFunding.idempotencyKey, key)));
  if (existing) { res.status(200).json({ contribution: existing, idempotent: true }); return; }
  const entityId = String(b.entityId ?? "");
  const e = await entity(me, entityId);
  if (!e) { res.status(404).json({ error: "entity-not-found" }); return; }
  const amount = Number(b.amount);
  const date = b.transactionDate;
  if (!["equity", "shareholder_loan"].includes(String(b.contributionType)) || !Number.isFinite(amount) || amount <= 0 || !validCurrency(b.currency) || !validDate(date) || !b.contributorName) {
    res.status(400).json({ error: "invalid-body", message: "entityId, contributionType, positive amount, 3-letter currency, contributorName and YYYY-MM-DD transactionDate are required." }); return;
  }
  const periodLabel = String(b.periodLabel ?? date.slice(0, 7));
  if (await locked(me.orgId, periodLabel)) { res.status(409).json({ error: "period_locked", periodLabel }); return; }
  const documentId = b.sourceDocumentId ? String(b.sourceDocumentId) : null;
  if (!(await sourceDoc(me, documentId, entityId))) { res.status(400).json({ error: "source-document-not-found" }); return; }
  const bankTransactionId = b.bankTransactionId ? String(b.bankTransactionId) : null;
  const matchedTxn = await bankTransaction(me, bankTransactionId, entityId);
  if (matchedTxn === undefined) { res.status(400).json({ error: "bank-transaction-not-found" }); return; }
  const id = rid("fund");
  const [row] = await db.insert(atelierShareholderFunding).values({
    id, orgId: me.orgId, entityId, entryType: "contribution", contributionId: id,
    contributionType: String(b.contributionType), contributorName: String(b.contributorName).trim().slice(0, 200),
    contributorUserId: b.contributorUserId ? String(b.contributorUserId) : null, amount, currency: String(b.currency).toUpperCase(),
    transactionDate: date, periodLabel, sourceDocumentId: documentId, bankTransactionId,
    bankMatchedAt: matchedTxn ? new Date() : null, status: "pending", reason: null, idempotencyKey: key, createdByUserId: me.id,
  }).returning();
  await audit(me, id, "shareholder_funding.created", { entityId, amount, currency: row.currency, contributionType: row.contributionType });
  res.status(201).json({ contribution: row, idempotent: false });
});

// @cli-skip: finance approval write; chat parity requires a confirm-flow capability
router.post("/finance/shareholder-funding/:id/confirm", async (req, res) => {
  const me = actor(req, res); if (!me || !writer(me, res)) return;
  const [row] = await db.select().from(atelierShareholderFunding).where(and(eq(atelierShareholderFunding.id, req.params.id), eq(atelierShareholderFunding.orgId, me.orgId), eq(atelierShareholderFunding.entryType, "contribution"), isNull(atelierShareholderFunding.deletedAt)));
  if (!row) { res.status(404).json({ error: "not-found" }); return; }
  if (await locked(me.orgId, row.periodLabel)) { res.status(409).json({ error: "period_locked", periodLabel: row.periodLabel }); return; }
  if (row.status === "confirmed" || row.status === "partially_repaid" || row.status === "repaid") { res.json({ contribution: row, idempotent: true }); return; }
  if (row.status !== "pending") { res.status(409).json({ error: "invalid-status" }); return; }
  const [updated] = await db.update(atelierShareholderFunding).set({ status: "confirmed", updatedAt: new Date() }).where(eq(atelierShareholderFunding.id, row.id)).returning();
  await audit(me, row.id, "shareholder_funding.confirmed", {});
  res.json({ contribution: updated });
});

async function appendEntry(req: Request, res: Response, kind: "repayment" | "reversal") {
  const me = actor(req, res); if (!me || !writer(me, res)) return;
  const [root] = await db.select().from(atelierShareholderFunding).where(and(eq(atelierShareholderFunding.id, String(req.params.id)), eq(atelierShareholderFunding.orgId, me.orgId), eq(atelierShareholderFunding.entryType, "contribution"), isNull(atelierShareholderFunding.deletedAt)));
  if (!root) { res.status(404).json({ error: "not-found" }); return; }
  const b = req.body ?? {};
  const amount = Number(b.amount ?? root.amount);
  const transactionDate = b.transactionDate ?? new Date().toISOString().slice(0, 10);
  if (!Number.isFinite(amount) || amount <= 0 || !String(b.reason ?? "").trim() || !validDate(transactionDate)) {
    res.status(400).json({ error: "invalid-body", message: "Positive amount, reason and a valid YYYY-MM-DD transactionDate are required." }); return;
  }
  if (!["confirmed", "partially_repaid"].includes(root.status)) {
    res.status(409).json({ error: "invalid-status", message: "Only confirmed funding can be repaid or reversed." }); return;
  }
  const periodLabel = transactionDate.slice(0, 7);
  if (await locked(me.orgId, periodLabel)) { res.status(409).json({ error: "period_locked", periodLabel }); return; }
  const key = String(b.idempotencyKey ?? req.get("Idempotency-Key") ?? "").trim();
  if (!key) { res.status(400).json({ error: "idempotency-key-required" }); return; }
  const [existing] = await db.select().from(atelierShareholderFunding).where(and(eq(atelierShareholderFunding.orgId, me.orgId), eq(atelierShareholderFunding.idempotencyKey, key)));
  if (existing) { res.json({ entry: existing, idempotent: true }); return; }
  const sourceDocumentId = b.sourceDocumentId ? String(b.sourceDocumentId) : root.sourceDocumentId;
  if (!(await sourceDoc(me, sourceDocumentId, root.entityId))) { res.status(400).json({ error: "source-document-not-found" }); return; }
  const bankTransactionId = b.bankTransactionId ? String(b.bankTransactionId) : null;
  const matchedTxn = await bankTransaction(me, bankTransactionId, root.entityId);
  if (matchedTxn === undefined) { res.status(400).json({ error: "bank-transaction-not-found" }); return; }
  const id = rid(kind === "repayment" ? "fundrepay" : "fundrev");
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shareholder-funding:${me.orgId}:${root.id}`}))`);
    const [freshRoot] = await tx.select().from(atelierShareholderFunding).where(and(
      eq(atelierShareholderFunding.id, root.id),
      eq(atelierShareholderFunding.orgId, me.orgId),
      isNull(atelierShareholderFunding.deletedAt),
    ));
    if (!freshRoot || !["confirmed", "partially_repaid"].includes(freshRoot.status))
      return { error: "invalid-status" as const };
    const children = await tx.select().from(atelierShareholderFunding).where(and(
      eq(atelierShareholderFunding.orgId, me.orgId),
      eq(atelierShareholderFunding.contributionId, root.id),
      inArray(atelierShareholderFunding.entryType, ["repayment", "reversal"]),
      isNull(atelierShareholderFunding.deletedAt),
    ));
    const previouslyOffset = children.reduce((n, x) => n + x.amount, 0);
    if (previouslyOffset + amount > freshRoot.amount + 0.000001)
      return { error: "amount-exceeds-outstanding" as const, outstanding: Math.max(0, freshRoot.amount - previouslyOffset) };
    const [entry] = await tx.insert(atelierShareholderFunding).values({
      id, orgId: me.orgId, entityId: freshRoot.entityId, entryType: kind, contributionId: freshRoot.contributionId,
      contributionType: freshRoot.contributionType, contributorName: freshRoot.contributorName, contributorUserId: freshRoot.contributorUserId,
      amount, currency: freshRoot.currency, transactionDate, periodLabel, sourceDocumentId,
      bankTransactionId, bankMatchedAt: matchedTxn ? new Date() : null, status: kind === "reversal" ? "reversed" : "confirmed",
      reason: String(b.reason).trim().slice(0, 1000), idempotencyKey: key, createdByUserId: me.id,
    }).returning();
    const totalOffset = previouslyOffset + amount;
    const next = kind === "reversal" && totalOffset >= freshRoot.amount ? "reversed" : totalOffset >= freshRoot.amount ? "repaid" : "partially_repaid";
    await tx.update(atelierShareholderFunding).set({ status: next, updatedAt: new Date() }).where(eq(atelierShareholderFunding.id, freshRoot.id));
    return { entry, next };
  });
  if ("error" in outcome) {
    res.status(409).json({ error: outcome.error, ...("outstanding" in outcome ? { outstanding: outcome.outstanding } : {}) });
    return;
  }
  const { entry, next } = outcome;
  await audit(me, root.id, `shareholder_funding.${kind}`, { entryId: id, amount, reason: entry.reason });
  res.status(201).json({ entry, status: next });
}
// @cli-skip: finance lifecycle write; chat parity requires a confirm-flow capability
router.post("/finance/shareholder-funding/:id/repay", (req, res) => appendEntry(req, res, "repayment"));
// @cli-skip: finance lifecycle write; chat parity requires a confirm-flow capability
router.post("/finance/shareholder-funding/:id/reverse", (req, res) => appendEntry(req, res, "reversal"));

export default router;
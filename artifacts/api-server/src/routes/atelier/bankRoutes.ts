/**
 * Task #363 — L2C Wave 4 bank statement + reconciliation routes.
 *
 *   POST   /wallet/bank/accounts                       create bank account
 *   GET    /wallet/bank/accounts                       list bank accounts
 *   POST   /wallet/bank/import                         import statement (csv|xero)
 *   GET    /wallet/bank/transactions                   list (filter by acct/state)
 *   POST   /wallet/bank/recon                          open recon period
 *   POST   /wallet/bank/recon/:id/finalise             irreversible close (partner)
 *   GET    /wallet/bank/recon                          list recon periods
 *
 * Restricted personas + board_observer denied (firm-cash domain).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  atelierUsers,
  atelierBankAccount,
  atelierBankStatementImport,
  atelierBankTransaction,
  atelierBankReconPeriod,
  atelierAuditEvents,
  atelierPeriodCloseLock,
} from "@workspace/db";
import { parseBankStatement } from "../../lib/bank-parsers/index.js";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";

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
    res.status(403).json({ error: "forbidden", message: "Bank capabilities are denied for this persona." });
    return true;
  }
  return false;
}
function isPartnerTier(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function isFinanceLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return isPartnerTier(me) || me.role === "finance";
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

// ─────────────────────── bank accounts ───────────────────────
router.get("/accounts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const rows = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.orgId, me.orgId), isNull(atelierBankAccount.deletedAt)));
  return res.json({ ok: true, data: rows });
});

router.post("/accounts", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankName?: string; accountLabel?: string; accountNumberLast4?: string; currency?: string; openingBalance?: number; legalEntityId?: string };
  if (!b.bankName || !b.accountLabel || !b.accountNumberLast4) return res.status(400).json({ error: "invalid_input" });
  const id = rid("bank");
  await db.insert(atelierBankAccount).values({
    id, orgId: me.orgId, legalEntityId: b.legalEntityId ?? null,
    bankName: b.bankName, accountLabel: b.accountLabel, accountNumberLast4: b.accountNumberLast4,
    currency: b.currency ?? "USD", openingBalance: b.openingBalance ?? 0,
    createdByUserId: me.id,
  });
  await audit({ entityType: "bank_account", entityId: id, actor: me, action: "bank_account.create",
    payload: { bankName: b.bankName, label: b.accountLabel }, summary: `Created bank account ${b.accountLabel}` });
  return res.json({ ok: true, data: { id } });
});

// ─────────────────────── statement import ───────────────────────
router.post("/import", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankAccountId?: string; source?: "csv" | "xero"; raw?: string; statementDate?: string; notes?: string; fileUrl?: string };
  if (!b.bankAccountId || !b.raw || !b.statementDate) return res.status(400).json({ error: "invalid_input" });
  const [acct] = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.id, b.bankAccountId), eq(atelierBankAccount.orgId, me.orgId)));
  if (!acct) return res.status(404).json({ error: "not_found" });
  const fileHash = createHash("sha256").update(b.raw).digest("hex").slice(0, 16);
  const dup = await db.select({ id: atelierBankStatementImport.id }).from(atelierBankStatementImport)
    .where(and(eq(atelierBankStatementImport.orgId, me.orgId),
      eq(atelierBankStatementImport.bankAccountId, b.bankAccountId),
      eq(atelierBankStatementImport.fileHash, fileHash)));
  if (dup.length > 0) {
    return res.status(409).json({ error: "duplicate", message: "Statement file already imported.", importId: dup[0].id });
  }
  const parsed = parseBankStatement(b.source ?? "csv", b.raw, acct.currency);
  const importId = rid("bnkimp");
  await db.insert(atelierBankStatementImport).values({
    id: importId, orgId: me.orgId, bankAccountId: b.bankAccountId, statementDate: b.statementDate,
    source: b.source ?? "csv", fileUrl: b.fileUrl ?? null, fileHash, rowsCount: parsed.rows.length,
    importedBy: me.id, notes: b.notes ?? null, createdByUserId: me.id,
  });
  if (parsed.rows.length > 0) {
    await db.insert(atelierBankTransaction).values(parsed.rows.map((r) => ({
      id: rid("bnktxn"), orgId: me.orgId, bankAccountId: b.bankAccountId!, statementImportId: importId,
      postedDate: r.postedDate, amount: r.amount, currency: r.currency,
      counterpartyNameRaw: r.counterpartyNameRaw, referenceRaw: r.referenceRaw,
      kind: r.kind, matchedState: "unmatched", createdByUserId: me.id,
    })));
  }
  await audit({ entityType: "bank_statement_import", entityId: importId, actor: me,
    action: "bank_import.create",
    payload: { bankAccountId: b.bankAccountId, rowsCount: parsed.rows.length, errors: parsed.errors.length },
    summary: `Imported ${parsed.rows.length} bank rows (${parsed.errors.length} errors)` });
  return res.json({ ok: true, data: { importId, rowsImported: parsed.rows.length, errors: parsed.errors } });
});

router.get("/transactions", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const acctId = req.query.bankAccountId as string | undefined;
  const state = req.query.state as string | undefined;
  const where = [eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt)];
  if (acctId) where.push(eq(atelierBankTransaction.bankAccountId, acctId));
  if (state) where.push(eq(atelierBankTransaction.matchedState, state));
  const rows = await db.select().from(atelierBankTransaction).where(and(...where))
    .orderBy(desc(atelierBankTransaction.postedDate)).limit(500);
  return res.json({ ok: true, data: { rows } });
});

// ─────────────────────── reconciliation ───────────────────────
router.get("/recon", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const acctId = req.query.bankAccountId as string | undefined;
  const where = [eq(atelierBankReconPeriod.orgId, me.orgId), isNull(atelierBankReconPeriod.deletedAt)];
  if (acctId) where.push(eq(atelierBankReconPeriod.bankAccountId, acctId));
  const rows = await db.select().from(atelierBankReconPeriod).where(and(...where))
    .orderBy(desc(atelierBankReconPeriod.periodEnd)).limit(60);
  return res.json({ ok: true, data: { rows } });
});

router.post("/recon", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me)) return res.status(403).json({ error: "forbidden", message: "finance/partner only" });
  const b = req.body as { bankAccountId?: string; periodLabel?: string; periodStart?: string; periodEnd?: string; openingBalance?: number; closingBalance?: number };
  if (!b.bankAccountId || !b.periodLabel || !b.periodStart || !b.periodEnd) return res.status(400).json({ error: "invalid_input" });
  const id = rid("recon");
  // compute receipts/payments + variance
  const txns = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, me.orgId),
    eq(atelierBankTransaction.bankAccountId, b.bankAccountId),
    sql`${atelierBankTransaction.postedDate} >= ${b.periodStart}`,
    sql`${atelierBankTransaction.postedDate} <= ${b.periodEnd}`,
  ));
  const receipts = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const payments = txns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const opening = b.openingBalance ?? 0;
  const closing = b.closingBalance ?? Math.round((opening + receipts - payments) * 100) / 100;
  const variance = Math.round((closing - (opening + receipts - payments)) * 100) / 100;
  await db.insert(atelierBankReconPeriod).values({
    id, orgId: me.orgId, bankAccountId: b.bankAccountId, periodLabel: b.periodLabel,
    periodStart: b.periodStart, periodEnd: b.periodEnd, openingBalance: opening, closingBalance: closing,
    computedReceipts: receipts, computedPayments: payments, variance, status: "open",
    createdByUserId: me.id,
  });
  await audit({ entityType: "bank_recon_period", entityId: id, actor: me,
    action: "bank_recon.open",
    payload: { bankAccountId: b.bankAccountId, periodLabel: b.periodLabel, variance },
    summary: `Opened recon ${b.periodLabel} (variance ${variance})` });
  return res.json({ ok: true, data: { id, computedReceipts: receipts, computedPayments: payments, variance } });
});

router.post("/recon/:id/finalise", async (req, res) => {
  if (denyAll(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isPartnerTier(me)) return res.status(403).json({ error: "forbidden", message: "partner-tier only" });
  const reconId = req.params.id;
  const b = req.body as { rationale?: string; varianceAccepted?: boolean };
  const [period] = await db.select().from(atelierBankReconPeriod)
    .where(and(eq(atelierBankReconPeriod.id, reconId), eq(atelierBankReconPeriod.orgId, me.orgId)));
  if (!period) return res.status(404).json({ error: "not_found" });
  if (period.status === "finalised") return res.status(409).json({ error: "already_finalised" });
  if (Math.abs(period.variance) > 0.01 && !b.varianceAccepted) {
    return res.status(409).json({ error: "variance_present", variance: period.variance, message: "Set varianceAccepted=true to finalise with variance." });
  }
  await db.update(atelierBankReconPeriod).set({
    status: "finalised", finalisedAt: new Date(), finalisedByUserId: me.id, approvedByUserId: me.id,
    rationaleText: b.rationale ?? null, updatedAt: new Date(),
  }).where(eq(atelierBankReconPeriod.id, reconId));
  // Add `bank_rec` to atelier_period_close_lock for the matching month, if present.
  const monthLabel = period.periodEnd.slice(0, 7); // YYYY-MM
  const [lock] = await db.select().from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, me.orgId), eq(atelierPeriodCloseLock.periodLabel, monthLabel)));
  if (lock) {
    const next = Array.from(new Set([...(lock.lockedModules ?? []), "bank_rec"]));
    await db.update(atelierPeriodCloseLock).set({ lockedModules: next, updatedAt: new Date() })
      .where(eq(atelierPeriodCloseLock.id, lock.id));
  }
  await audit({ entityType: "bank_recon_period", entityId: reconId, actor: me,
    action: "bank_recon.finalise",
    payload: { variance: period.variance, varianceAccepted: !!b.varianceAccepted },
    summary: `Finalised recon ${period.periodLabel}` });
  return res.json({ ok: true, data: { id: reconId, status: "finalised" } });
});

export default router;

/**
 * Task #654 — VAT return per legal entity & period, computed from the GL.
 *
 *   GET  /vat/return?entityId&period     compute the return (YYYY-MM or YYYY-Qn)
 *   POST /vat/return/file                mark filed → netting journal (Dr 2300 / Cr 1400)
 *                                        + roll fiscal.nextVatFilingDate forward
 *
 * Output VAT = credit balance movement on 2300 (VAT payable — output),
 * Input VAT  = debit balance movement on 1400 (VAT receivable — input),
 * over the period's months, excluding prior vat_return settlements.
 * Net payable stays on 2300 after netting (or net receivable on 1400) —
 * the cash payment is a separate bank event.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

type Me = typeof atelierUsers.$inferSelect;
function denyRead(req: Request, res: Response): Me | null {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  const partnerTier = me.role === "founding_partner" || me.role === "partner";
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !(partnerTier || me.role === "finance")) {
    res.status(403).json({ error: "forbidden", message: "VAT returns are limited to finance leadership." });
    return null;
  }
  return me;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

function monthsOfVatPeriod(period: string): string[] | null {
  if (MONTH_RE.test(period)) return [period];
  if (QUARTER_RE.test(period)) {
    const y = period.slice(0, 4);
    const q = Number(period.slice(6));
    return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
  }
  return null;
}

interface VatLine {
  journalEntryId: string;
  entryDate: string;
  periodLabel: string;
  sourceKind: string;
  memo: string | null;
  accountCode: string;
  debit: number;
  credit: number;
}

async function computeVatReturn(orgId: string, entityId: string, months: string[]) {
  const monthSet = new Set(months);
  const entries = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, orgId),
    eq(atelierGlJournalEntry.legalEntityId, entityId),
    isNull(atelierGlJournalEntry.deletedAt),
  ));
  const inScope = new Map(entries.filter((e) => monthSet.has(e.periodLabel) && e.sourceKind !== "vat_return").map((e) => [e.id, e]));
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt),
  ));
  const vatAccountIds = new Map(accounts.filter((a) => a.code === "2300" || a.code === "1400").map((a) => [a.id, a.code]));
  const allLines = await db.select().from(atelierGlJournalLine)
    .where(and(eq(atelierGlJournalLine.orgId, orgId), isNull(atelierGlJournalLine.deletedAt)));
  let outputVat = 0, inputVat = 0;
  const lines: VatLine[] = [];
  for (const l of allLines) {
    const entry = inScope.get(l.journalEntryId);
    if (!entry) continue;
    const code = vatAccountIds.get(l.accountId);
    if (!code) continue;
    if (code === "2300") outputVat += (l.credit || 0) - (l.debit || 0);
    else inputVat += (l.debit || 0) - (l.credit || 0);
    lines.push({
      journalEntryId: entry.id, entryDate: entry.entryDate, periodLabel: entry.periodLabel,
      sourceKind: entry.sourceKind, memo: entry.memo,
      accountCode: code, debit: round2(l.debit || 0), credit: round2(l.credit || 0),
    });
  }
  lines.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  outputVat = round2(outputVat); inputVat = round2(inputVat);
  return { outputVat, inputVat, netVat: round2(outputVat - inputVat), lines };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/vat/return", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  const months = monthsOfVatPeriod(period);
  if (!entityId || !months)
    return res.status(400).json({ error: "invalid_input", message: "entityId and period (YYYY-MM or YYYY-Qn) are required." });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  const ret = await computeVatReturn(me.orgId, entityId, months);
  const [settlement] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, me.orgId),
    eq(atelierGlJournalEntry.sourceKind, "vat_return"),
    eq(atelierGlJournalEntry.sourceRef, `${entityId}:${period}`),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  return res.json({ ok: true, data: {
    entityId, period, months, ...ret,
    filed: !!settlement,
    settlementJournalEntryId: settlement?.id ?? null,
    filedAt: settlement?.createdAt ?? null,
    vatPeriodSetting: ent.fiscal?.vatPeriod ?? null,
    nextVatFilingDate: ent.fiscal?.nextVatFilingDate ?? null,
  } });
});

const FileSchema = z.object({
  entityId: z.string().min(1),
  period: z.string().min(6).max(8),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/vat/return/file", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = FileSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const { entityId, period } = parsed.data;
  const months = monthsOfVatPeriod(period);
  if (!months) return res.status(400).json({ error: "invalid_input", message: "period must be YYYY-MM or YYYY-Qn." });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });

  const sourceRef = `${entityId}:${period}`;
  const [existing] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, me.orgId),
    eq(atelierGlJournalEntry.sourceKind, "vat_return"),
    eq(atelierGlJournalEntry.sourceRef, sourceRef),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  if (existing)
    return res.status(409).json({ error: "already_filed", settlementJournalEntryId: existing.id });

  const ret = await computeVatReturn(me.orgId, entityId, months);
  const filingDate = new Date().toISOString().slice(0, 10);
  const filingPeriod = filingDate.slice(0, 7);
  if (await isGlPeriodLocked(me.orgId, filingPeriod))
    return res.status(409).json({ error: "period_locked", message: `Filing period ${filingPeriod} is locked for the GL module.` });

  // Netting journal clears input VAT against output VAT; the net stays
  // on 2300 (payable) or 1400 (receivable) until the cash event.
  const netting = round2(Math.min(Math.max(ret.outputVat, 0), Math.max(ret.inputVat, 0)));
  let settlementJournalEntryId: string | null = null;
  if (netting > 0) {
    const accounts = await db.select().from(atelierGlAccount).where(and(
      eq(atelierGlAccount.orgId, me.orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt),
    ));
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const out = byCode.get("2300"); const inp = byCode.get("1400");
    if (!out || !inp)
      return res.status(400).json({ error: "missing_account", message: "Accounts 2300/1400 missing — seed the entity's chart of accounts first." });
    const entryId = rid("gljrn");
    await db.transaction(async (tx) => {
      await tx.insert(atelierGlJournalEntry).values({
        id: entryId, orgId: me.orgId, legalEntityId: entityId,
        periodLabel: filingPeriod, entryDate: filingDate, kind: "posting",
        sourceKind: "vat_return", sourceRef,
        memo: `VAT return ${period} filed — input netted against output (net ${ret.netVat >= 0 ? "payable" : "receivable"} USD ${Math.abs(ret.netVat)})`,
        currency: "USD", totalDebit: netting, totalCredit: netting, createdByUserId: me.id,
      });
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: out.id, accountCode: out.code, accountName: out.name,
        debit: netting, credit: 0, memo: `VAT return ${period} — clear input against output`,
      });
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: inp.id, accountCode: inp.code, accountName: inp.name,
        debit: 0, credit: netting, memo: `VAT return ${period} — clear input against output`,
      });
    });
    settlementJournalEntryId = entryId;
  } else {
    // Nothing to net (nil or one-sided return) — still record the filing
    // via a zero-amount marker entry so idempotency + "filed" state hold.
    const entryId = rid("gljrn");
    await db.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: me.orgId, legalEntityId: entityId,
      periodLabel: filingPeriod, entryDate: filingDate, kind: "posting",
      sourceKind: "vat_return", sourceRef,
      memo: `VAT return ${period} filed — nothing to net (output ${ret.outputVat}, input ${ret.inputVat})`,
      currency: "USD", totalDebit: 0, totalCredit: 0, createdByUserId: me.id,
    });
    settlementJournalEntryId = entryId;
  }

  // Roll the fiscal calendar forward (+1 month monthly, +3 quarterly).
  let rolledTo: string | null = null;
  const fiscal = ent.fiscal;
  if (fiscal?.nextVatFilingDate) {
    const stepMonths = (fiscal.vatPeriod ?? "quarterly") === "monthly" ? 1 : 3;
    const d = new Date(`${fiscal.nextVatFilingDate}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCMonth(d.getUTCMonth() + stepMonths);
      rolledTo = d.toISOString().slice(0, 10);
      await db.update(atelierLegalEntities)
        .set({ fiscal: { ...fiscal, nextVatFilingDate: rolledTo }, updatedAt: new Date() })
        .where(eq(atelierLegalEntities.id, entityId));
    }
  }

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: "gl_journal_entry", entityId: settlementJournalEntryId,
    actorType: "human", actorId: me.id, actorLabel: me.name,
    action: "vat.return_filed",
    payload: { entityId, period, outputVat: ret.outputVat, inputVat: ret.inputVat, netVat: ret.netVat, netting, rolledNextVatFilingDateTo: rolledTo },
    payloadSummary: `VAT return ${period} for ${ent.shortName || ent.legalNameEn} marked filed: output USD ${ret.outputVat}, input USD ${ret.inputVat}, net ${ret.netVat >= 0 ? "payable" : "receivable"} USD ${Math.abs(ret.netVat)}${rolledTo ? ` — next filing rolled to ${rolledTo}` : ""}`,
  });
  return res.json({ ok: true, data: {
    settlementJournalEntryId, outputVat: ret.outputVat, inputVat: ret.inputVat,
    netVat: ret.netVat, netting, rolledNextVatFilingDateTo: rolledTo,
  } });
});

export default router;

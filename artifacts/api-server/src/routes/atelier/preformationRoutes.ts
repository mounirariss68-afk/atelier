/**
 * Task #1092 — Pre-formation entity cost pools.
 *
 * Finance view over costs quarantined for in-formation entities
 * (Istanbul, Riyadh, ...): running totals per pool (posted clearing
 * balance + pipeline not yet bookkept), itemized sources (expenses,
 * supplier invoices, journal lines), ownership summary + recommended
 * treatment, staleness flags — and the settlement flow that posts the
 * corresponding GL journals when the entity incorporates (or the
 * market entry is abandoned).
 *
 * Gating mirrors the finance surfaces: founding_partner / partner /
 * finance only. Founder-owned settlements require an approval note.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierExpenses,
  atelierPartnerFirmInvoices,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierAuditEvents,
  type EntityFormation,
} from "@workspace/db";
import {
  PREFORMATION_CLEARING_CODE,
  PREFORMATION_IC_RECEIVABLE_CODE,
  PREFORMATION_FOUNDER_RECEIVABLE_CODE,
  PREFORMATION_ABSORB_CODE,
  PREFORMATION_WRITEOFF_CODE,
  SETTLEMENT_TREATMENTS,
  TREATMENT_LABEL,
  OWNERSHIP_LABEL,
  recommendedTreatment,
  resolveHomeEntityId,
  type SettlementTreatment,
} from "../../lib/atelier-preformation.js";
import {
  DEFAULT_CHART,
  ensureChartSeeded,
  isGlPeriodLocked,
} from "../../lib/atelier-agents/bookkeeper.js";
import { convertUsdTo, DISPLAY_CURRENCIES } from "../../lib/atelier-fx.js";
import { atelierGlAccount } from "@workspace/db";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Finance-data gate — consistent with the other finance surfaces. */
function financeGate(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!["founding_partner", "partner", "finance"].includes(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Pre-formation cost pools are visible to finance leadership only.",
    });
    return null;
  }
  return me;
}

/** Days since the given timestamp (0 when null). */
function daysSince(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

const STALE_DAYS = 60;

interface PoolItem {
  kind: "expense" | "supplier_invoice" | "journal";
  id: string;
  label: string;
  date: string | null;
  amount: number;
  currency: string;
  usdAmount: number;
  status: string;
  posted: boolean;
}

async function buildPools(orgId: string, displayCurrency: string) {
  const entities = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId)));
  // Pools: entities currently in_formation, plus any entity with
  // pre-formation activity or a formation record (covers activated /
  // abandoned entities awaiting or carrying settlement).
  const stampedLines = await db
    .select({
      line: atelierGlJournalLine,
      entry: atelierGlJournalEntry,
    })
    .from(atelierGlJournalLine)
    .innerJoin(
      atelierGlJournalEntry,
      eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id),
    )
    .where(and(
      eq(atelierGlJournalLine.orgId, orgId),
      eq(atelierGlJournalLine.accountCode, PREFORMATION_CLEARING_CODE),
    ));
  const stampedByEntity = new Map<string, typeof stampedLines>();
  for (const r of stampedLines) {
    const pid = r.line.preFormationEntityId;
    if (!pid) continue;
    const arr = stampedByEntity.get(pid) ?? [];
    arr.push(r);
    stampedByEntity.set(pid, arr);
  }
  const poolEntities = entities.filter(
    (e) =>
      e.status === "in_formation" ||
      stampedByEntity.has(e.id) ||
      (e.formation && (e.formation.ownershipType || e.formation.settlement)),
  );
  const poolIds = poolEntities.map((e) => e.id);
  const expenses = poolIds.length
    ? await db.select().from(atelierExpenses).where(and(
        eq(atelierExpenses.orgId, orgId),
        inArray(atelierExpenses.entityId, poolIds),
        isNull(atelierExpenses.deletedAt),
        ne(atelierExpenses.status, "rejected"),
      ))
    : [];
  const invoices = poolIds.length
    ? await db.select().from(atelierPartnerFirmInvoices).where(and(
        eq(atelierPartnerFirmInvoices.orgId, orgId),
        inArray(atelierPartnerFirmInvoices.legalEntityId, poolIds),
        isNull(atelierPartnerFirmInvoices.deletedAt),
        ne(atelierPartnerFirmInvoices.status, "rejected"),
      ))
    : [];

  const now = new Date();
  const pools = [] as Array<Record<string, unknown>>;
  for (const e of poolEntities) {
    const lines = stampedByEntity.get(e.id) ?? [];
    // Posted clearing balance = Σ(debit − credit) on 1500 lines stamped
    // with this pool (settlement credits net it back to zero).
    const clearingUsd = round2(
      lines.reduce((s, r) => s + r.line.debit - r.line.credit, 0),
    );
    const postedExpenseRefs = new Set(
      lines
        .filter((r) => r.entry.sourceKind === "expense")
        .map((r) => r.entry.sourceRef),
    );
    const postedInvoiceRefs = new Set(
      lines
        .filter((r) => r.entry.sourceKind === "partner_firm_invoice")
        .map((r) => r.entry.sourceRef),
    );
    const items: PoolItem[] = [];
    let pipelineUsd = 0;
    for (const x of expenses.filter((x) => x.entityId === e.id)) {
      const posted = postedExpenseRefs.has(x.id);
      if (!posted) pipelineUsd += x.usdAmount;
      items.push({
        kind: "expense",
        id: x.id,
        label: `${x.merchant ?? x.category} — ${x.summary ?? x.description ?? x.category}`.slice(0, 200),
        date: x.expenseDate,
        amount: x.amount,
        currency: x.currency,
        usdAmount: round2(x.usdAmount),
        status: x.status,
        posted,
      });
    }
    for (const p of invoices.filter((p) => p.legalEntityId === e.id)) {
      const posted = postedInvoiceRefs.has(p.id);
      if (!posted) pipelineUsd += p.usdAmount;
      items.push({
        kind: "supplier_invoice",
        id: p.id,
        label: `${p.partnerFirmName} · ${p.reference ?? p.weekIso}`,
        date: p.invoiceDate ?? p.periodLabel ?? p.weekIso,
        amount: p.costAmount,
        currency: p.costCurrency,
        usdAmount: round2(p.usdAmount),
        status: p.status,
        posted,
      });
    }
    for (const r of lines) {
      items.push({
        kind: "journal",
        id: r.line.id,
        label: `${r.entry.memo ?? r.entry.sourceKind} (${r.entry.sourceKind})`,
        date: r.entry.entryDate,
        amount: round2(r.line.debit - r.line.credit),
        currency: "USD",
        usdAmount: round2(r.line.debit - r.line.credit),
        status: r.entry.periodLabel,
        posted: true,
      });
    }
    items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

    const formation: EntityFormation | null = e.formation ?? null;
    const settlement = formation?.settlement ?? null;
    const lastActivityDates = [
      ...lines.map((r) => r.entry.createdAt),
      ...expenses.filter((x) => x.entityId === e.id).map((x) => x.updatedAt),
      ...invoices.filter((p) => p.legalEntityId === e.id).map((p) => p.updatedAt),
    ].filter(Boolean) as Date[];
    const lastActivityAt = lastActivityDates.length
      ? new Date(Math.max(...lastActivityDates.map((d) => d.getTime())))
      : null;
    const idleDays = daysSince(lastActivityAt);
    const totalUsd = round2(clearingUsd + pipelineUsd);
    const staleFlags: string[] = [];
    if (!settlement && e.status === "active") {
      staleFlags.push("entity_active_unsettled");
    }
    if (
      !settlement &&
      totalUsd > 0 &&
      idleDays !== null &&
      idleDays >= STALE_DAYS
    ) {
      staleFlags.push("no_recent_activity");
    }
    const [clearingDisp, pipelineDisp, totalDisp] = await Promise.all([
      convertUsdTo(clearingUsd, displayCurrency, now),
      convertUsdTo(pipelineUsd, displayCurrency, now),
      convertUsdTo(totalUsd, displayCurrency, now),
    ]);
    pools.push({
      entityId: e.id,
      name: e.shortName || e.legalNameEn,
      legalNameEn: e.legalNameEn,
      country: e.country,
      status: e.status,
      ownershipType: formation?.ownershipType ?? null,
      ownershipLabel: formation?.ownershipType
        ? OWNERSHIP_LABEL[formation.ownershipType]
        : null,
      jvSplits: formation?.jvSplits ?? null,
      formationNotes: formation?.notes ?? null,
      recommendedTreatment: recommendedTreatment(formation?.ownershipType ?? null),
      settlement,
      postedUsd: clearingUsd,
      pipelineUsd: round2(pipelineUsd),
      totalUsd,
      display: {
        currency: displayCurrency,
        posted: round2(clearingDisp.amount),
        pipeline: round2(pipelineDisp.amount),
        total: round2(totalDisp.amount),
        rate: totalDisp.rate,
        rateDate: totalDisp.rateDate,
      },
      itemCount: items.length,
      items,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      idleDays,
      staleFlags,
    });
  }
  pools.sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd));
  return pools;
}

// @cli-skip: Task #1092 finance leadership dashboard; UI-only raw-fetch wiring
router.get("/finance/preformation/pools", async (req, res, next) => {
  try {
    const me = financeGate(req, res);
    if (!me) return;
    const wanted = String(req.query.currency ?? "USD").toUpperCase();
    const displayCurrency = DISPLAY_CURRENCIES.includes(wanted) || wanted === "USD" ? wanted : "USD";
    const pools = await buildPools(me.orgId, displayCurrency);
    res.json({ items: pools, displayCurrency, staleDays: STALE_DAYS });
  } catch (err) { next(err); }
});

// @cli-skip: Task #1092 destructive finance settlement; guarded UI flow only
router.post("/finance/preformation/pools/:entityId/settle", async (req, res, next) => {
  try {
    const me = financeGate(req, res);
    if (!me) return;
    const entityId = String(req.params.entityId ?? "");
    const b = (req.body ?? {}) as { treatment?: string; approvalNote?: string };
    const treatment = String(b.treatment ?? "") as SettlementTreatment;
    if (!SETTLEMENT_TREATMENTS.includes(treatment)) {
      res.status(400).json({ error: "invalid-treatment", allowed: SETTLEMENT_TREATMENTS });
      return;
    }
    const approvalNote = typeof b.approvalNote === "string" ? b.approvalNote.trim().slice(0, 2000) : "";
    const [entity] = await db.select().from(atelierLegalEntities).where(and(
      eq(atelierLegalEntities.id, entityId),
      eq(atelierLegalEntities.orgId, me.orgId),
    ));
    if (!entity) { res.status(404).json({ error: "not-found" }); return; }
    const formation: EntityFormation | null = entity.formation ?? null;
    if (formation?.settlement) {
      res.status(409).json({ error: "already-settled", settlement: formation.settlement });
      return;
    }
    // Founder-owned settlements record an explicit approval note; the
    // founder-receivable treatment always does.
    if ((formation?.ownershipType === "founder_partner" || treatment === "founder_receivable") && !approvalNote) {
      res.status(400).json({
        error: "approval-note-required",
        message: "Founder-owned settlements require an explicit approval note.",
      });
      return;
    }
    const jvSplits = formation?.jvSplits ?? null;
    if (treatment === "jv_split") {
      const sum = (jvSplits ?? []).reduce((s, x) => s + x.sharePct, 0);
      if (!jvSplits || jvSplits.length === 0 || Math.abs(sum - 100) > 0.01) {
        res.status(400).json({
          error: "invalid-jv-splits",
          message: "JV split settlement needs partner splits summing to 100% on the entity's ownership record.",
        });
        return;
      }
    }

    // Compute the posted clearing balance for this pool.
    const lines = await db
      .select({ line: atelierGlJournalLine, entry: atelierGlJournalEntry })
      .from(atelierGlJournalLine)
      .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
      .where(and(
        eq(atelierGlJournalLine.orgId, me.orgId),
        eq(atelierGlJournalLine.accountCode, PREFORMATION_CLEARING_CODE),
        eq(atelierGlJournalLine.preFormationEntityId, entityId),
      ));
    const clearingUsd = round2(lines.reduce((s, r) => s + r.line.debit - r.line.credit, 0));
    // Unposted pipeline blocks settlement — run the Bookkeeper first so
    // the clearing account carries every quarantined cost.
    const postedExpenseRefs = new Set(lines.filter((r) => r.entry.sourceKind === "expense").map((r) => r.entry.sourceRef));
    const pendingExpenses = await db.select({ id: atelierExpenses.id, status: atelierExpenses.status })
      .from(atelierExpenses)
      .where(and(
        eq(atelierExpenses.orgId, me.orgId),
        eq(atelierExpenses.entityId, entityId),
        inArray(atelierExpenses.status, ["approved", "reimbursed"]),
        isNull(atelierExpenses.deletedAt),
      ));
    const unposted = pendingExpenses.filter((x) => !postedExpenseRefs.has(x.id));
    const postedInvoiceRefs = new Set(lines.filter((r) => r.entry.sourceKind === "partner_firm_invoice").map((r) => r.entry.sourceRef));
    const paidInvoices = await db.select({ id: atelierPartnerFirmInvoices.id })
      .from(atelierPartnerFirmInvoices)
      .where(and(
        eq(atelierPartnerFirmInvoices.orgId, me.orgId),
        eq(atelierPartnerFirmInvoices.legalEntityId, entityId),
        eq(atelierPartnerFirmInvoices.status, "paid"),
        isNull(atelierPartnerFirmInvoices.deletedAt),
      ));
    const unpostedInv = paidInvoices.filter((p) => !postedInvoiceRefs.has(p.id));
    if (unposted.length > 0 || unpostedInv.length > 0) {
      res.status(409).json({
        error: "unposted-costs",
        message: `Run the Bookkeeper first — ${unposted.length + unpostedInv.length} approved/paid item(s) are not yet posted to the clearing account.`,
      });
      return;
    }

    const poolName = entity.shortName || entity.legalNameEn;
    let journalEntryId: string | null = null;
    if (clearingUsd > 0.005) {
      const homeEntityId = await resolveHomeEntityId(me.orgId);
      if (!homeEntityId) {
        res.status(409).json({ error: "no-home-entity", message: "No home (UAE) ledger entity is resolvable." });
        return;
      }
      const periodLabel = new Date().toISOString().slice(0, 7);
      if (await isGlPeriodLocked(me.orgId, periodLabel)) {
        res.status(409).json({ error: "period-locked", periodLabel });
        return;
      }
      await ensureChartSeeded({
        orgId: me.orgId,
        legalEntityId: homeEntityId,
        entityLabel: "home entity",
        actor: { kind: "human", userId: me.id, label: me.name },
        reason: `Pre-formation settlement for ${poolName}`,
      });
      const accounts = await db.select().from(atelierGlAccount).where(and(
        eq(atelierGlAccount.orgId, me.orgId),
        eq(atelierGlAccount.legalEntityId, homeEntityId),
        eq(atelierGlAccount.active, true),
        isNull(atelierGlAccount.deletedAt),
      ));
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      const debitLines: Array<{ code: string; amount: number; memo: string }> = [];
      switch (treatment) {
        case "recharge":
          debitLines.push({ code: PREFORMATION_IC_RECEIVABLE_CODE, amount: clearingUsd, memo: `Intercompany recharge — ${poolName}` });
          break;
        case "jv_split": {
          let allocated = 0;
          const splits = jvSplits!;
          splits.forEach((s, i) => {
            const amt = i === splits.length - 1
              ? round2(clearingUsd - allocated)
              : round2((clearingUsd * s.sharePct) / 100);
            allocated = round2(allocated + amt);
            if (amt !== 0) {
              debitLines.push({ code: PREFORMATION_IC_RECEIVABLE_CODE, amount: amt, memo: `JV recharge ${s.sharePct}% — ${s.partnerName}` });
            }
          });
          break;
        }
        case "founder_receivable":
          debitLines.push({ code: PREFORMATION_FOUNDER_RECEIVABLE_CODE, amount: clearingUsd, memo: `Founder receivable — ${poolName}` });
          break;
        case "absorb":
          debitLines.push({ code: PREFORMATION_ABSORB_CODE, amount: clearingUsd, memo: `Absorbed pre-formation costs — ${poolName}` });
          break;
        case "write_off":
          debitLines.push({ code: PREFORMATION_WRITEOFF_CODE, amount: clearingUsd, memo: `Abandoned market entry — ${poolName}` });
          break;
      }
      const needed = [PREFORMATION_CLEARING_CODE, ...debitLines.map((l) => l.code)];
      // Backfill: charts seeded before the pre-formation accounts existed
      // (incl. the 1550 IC receivable) self-heal here from DEFAULT_CHART —
      // idempotent inserts, audited via the settlement audit below.
      for (const code of needed) {
        if (byCode.has(code)) continue;
        const def = DEFAULT_CHART.find((d) => d.code === code);
        if (!def) {
          res.status(409).json({ error: "missing-account", accountCode: code });
          return;
        }
        const [ins] = await db
          .insert(atelierGlAccount)
          .values({
            id: rid("glacct"), orgId: me.orgId, legalEntityId: homeEntityId,
            code: def.code, name: def.name, type: def.type,
            normalSide: def.normalSide, isSystem: def.isSystem, active: true,
            createdByUserId: me.id,
          })
          .onConflictDoNothing()
          .returning();
        const row = ins ?? (await db.select().from(atelierGlAccount).where(and(
          eq(atelierGlAccount.orgId, me.orgId),
          eq(atelierGlAccount.legalEntityId, homeEntityId),
          eq(atelierGlAccount.code, code),
          isNull(atelierGlAccount.deletedAt),
        )))[0];
        if (!row) {
          res.status(409).json({ error: "missing-account", accountCode: code });
          return;
        }
        byCode.set(code, row);
      }
      const entryId = rid("gljrn");
      const entryDate = new Date().toISOString().slice(0, 10);
      try {
        await db.transaction(async (tx) => {
          await tx.insert(atelierGlJournalEntry).values({
            id: entryId, orgId: me.orgId, legalEntityId: homeEntityId,
            periodLabel, entryDate, kind: "posting",
            sourceKind: "preformation_settlement", sourceRef: entityId,
            memo: `Pre-formation settlement (${TREATMENT_LABEL[treatment]}) — ${poolName}`,
            currency: "USD", totalDebit: clearingUsd, totalCredit: clearingUsd,
            createdByUserId: me.id,
          });
          for (const l of debitLines) {
            const acct = byCode.get(l.code)!;
            await tx.insert(atelierGlJournalLine).values({
              id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
              accountId: acct.id, accountCode: acct.code, accountName: acct.name,
              preFormationEntityId: entityId,
              debit: l.amount, credit: 0, memo: l.memo,
            });
          }
          const clr = byCode.get(PREFORMATION_CLEARING_CODE)!;
          await tx.insert(atelierGlJournalLine).values({
            id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
            accountId: clr.id, accountCode: clr.code, accountName: clr.name,
            preFormationEntityId: entityId,
            debit: 0, credit: clearingUsd, memo: `Clear pre-incorporation pool — ${poolName}`,
          });
        });
      } catch (err) {
        // Unique (org, sourceKind, sourceRef) — a concurrent settle won.
        res.status(409).json({ error: "already-settled", message: "A settlement journal for this pool already exists." });
        return;
      }
      journalEntryId = entryId;
    }

    const settlement: NonNullable<EntityFormation["settlement"]> = {
      treatment,
      settledAt: new Date().toISOString(),
      settledByUserId: me.id,
      settledByName: me.name,
      approvalNote: approvalNote || null,
      journalEntryId,
      totalUsd: clearingUsd,
    };
    const newFormation: EntityFormation = {
      ownershipType: formation?.ownershipType ?? null,
      jvSplits: formation?.jvSplits ?? null,
      notes: formation?.notes ?? null,
      settlement,
    };
    await db.update(atelierLegalEntities)
      .set({ formation: newFormation, updatedAt: new Date() })
      .where(eq(atelierLegalEntities.id, entityId));
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: me.orgId,
      entityType: "legal_entity",
      entityId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "legal_entity.preformation_settle",
      payload: { treatment, totalUsd: clearingUsd, journalEntryId, approvalNote: approvalNote || null, jvSplits },
      payloadSummary: `${me.name} settled pre-formation pool "${poolName}" via ${TREATMENT_LABEL[treatment]} ($${clearingUsd.toFixed(2)})${approvalNote ? " with approval note" : ""}.`,
    });
    res.json({ ok: true, settlement, journalEntryId });
  } catch (err) { next(err); }
});

export default router;

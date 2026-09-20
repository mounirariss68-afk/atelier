/**
 * Atelier — margin / realization reporting suite (Task #434).
 *
 * Pure compute + capture helpers shared by the /margin-reports routes,
 * the contract-stage snapshot hook, and the Margin Sentinel agent.
 *
 *   • captureSoldPositionSnapshot — writes the immutable sold-position
 *     baseline when an opportunity enters Contract (or via backfill).
 *     Deterministic id `sold_<oppId>` + onConflictDoNothing = write-once.
 *   • computeClientMarginRollups — account-level gross-margin rollups
 *     from the latest engagement margin snapshot per (engagement,
 *     period), with period / entity / partner filters. Entity is
 *     derived from the engagement's invoicing legal entity (engagements
 *     carry no entity dimension of their own).
 *   • computeOverheadAllocation — allocates GL overhead (expense-type
 *     journal lines WITHOUT an engagement dimension, optionally
 *     restricted to configured account codes) across engagements by a
 *     configurable basis. The sum of allocations always ties to the GL
 *     overhead total (largest-remainder on the final row).
 *   • computeRealizationReport — sold vs delivered per engagement with
 *     leakage decomposed into rate variance, hours overrun, scope
 *     write-offs (negative revenue adjustments) and expense
 *     non-recovery (client-billable expenses never pulled onto an
 *     invoice line).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierOpportunities,
  atelierDealPricings,
  atelierEngagements,
  atelierAccounts,
  atelierAuditEvents,
  atelierSoldPositionSnapshot,
  atelierOverheadAllocationConfig,
  atelierEngagementMarginSnapshot,
  atelierRevenueSchedule,
  atelierRevenueAdjustment,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierInvoice,
  atelierInvoiceLine,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierEngagementBudget,
  atelierEngagementCostToDate,
  atelierChangeOrder,
  atelierRevenuePeriodPosting,
  atelierRevenuePeriodPostingLine,
  atelierCashApplication,
} from "@workspace/db";
import { isExpenseEconomicallyActive } from "./atelier-expense-lifecycle.js";

type OppRow = typeof atelierOpportunities.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const COUNTED_TIMESHEET_STATUSES = ["submitted", "lead_approved", "approved", "partner_approved"];

// ---------------------------------------------------------------------------
// Sold-position snapshot capture (write-once).
// ---------------------------------------------------------------------------

export interface CaptureSnapshotResult {
  captured: boolean;
  skippedReason: "already_exists" | null;
  snapshotId: string;
  hasPricing: boolean;
}

/**
 * Capture the sold position for an opportunity. Idempotent + immutable:
 * the deterministic id `sold_<oppId>` and the unique (org, opportunity)
 * index mean the first write wins forever — later calls are no-ops.
 */
export async function captureSoldPositionSnapshot(
  opp: OppRow,
  actor: { id: string; name: string },
  source: "contract_stage" | "backfill",
): Promise<CaptureSnapshotResult> {
  const snapshotId = `sold_${opp.id}`;

  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, opp.id), isNull(atelierDealPricings.deletedAt)))
    .limit(1);

  const [eng] = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.opportunityId, opp.id), isNull(atelierEngagements.deletedAt)))
    .limit(1);

  const teamMix = (pricing?.teamMix as Array<{ seniority: string; role?: string; ftePct: number }>) ?? [];
  const durationWeeks = Number(pricing?.durationWeeks ?? 0);
  const soldHours = teamMix.reduce((s, m) => s + Number(m.ftePct || 0) * durationWeeks * 40, 0);
  const soldPriceUsd = pricing ? Number(pricing.computedPriceUsd || 0) : Number(opp.dealSizeHypothesis || 0);
  const soldCostUsd = pricing ? Number(pricing.computedCostUsd || 0) : 0;
  const soldMarginAmountUsd = soldPriceUsd - soldCostUsd;
  const soldMarginPct = pricing
    ? Number(pricing.computedMarginPct || 0)
    : soldPriceUsd > 0
      ? soldMarginAmountUsd / soldPriceUsd
      : 0;

  const inserted = await db
    .insert(atelierSoldPositionSnapshot)
    .values({
      id: snapshotId,
      orgId: opp.orgId,
      opportunityId: opp.id,
      engagementId: eng?.id ?? null,
      accountId: opp.accountId,
      partnerOwnerId: opp.partnerOwnerId ?? null,
      source,
      hasPricing: !!pricing,
      pricingModel: pricing?.pricingModel ?? null,
      rateCardId: pricing?.rateCardId ?? null,
      durationWeeks,
      teamMix,
      soldHours,
      soldPriceUsd,
      soldCostUsd,
      soldMarginAmountUsd,
      soldMarginPct,
      targetMarginPct: Number(pricing?.targetMarginPct ?? 0),
      soldEffectiveRateUsd: soldHours > 0 ? soldPriceUsd / soldHours : 0,
      createdByUserId: actor.id,
    })
    .onConflictDoNothing({ target: atelierSoldPositionSnapshot.id })
    .returning({ id: atelierSoldPositionSnapshot.id });

  if (inserted.length) {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: opp.orgId,
      entityType: "opportunity",
      entityId: opp.id,
      actorType: source === "contract_stage" ? "system" : "human",
      actorId: source === "contract_stage" ? "stage-transition-hook" : actor.id,
      actorLabel: source === "contract_stage" ? "Atelier" : actor.name,
      action: "margin.sold_position_captured",
      payload: {
        snapshotId,
        source,
        hasPricing: !!pricing,
        soldPriceUsd,
        soldCostUsd,
        soldMarginPct,
        soldHours,
      },
      payloadSummary: `Sold position captured for "${opp.name}" (${source}): $${Math.round(soldPriceUsd).toLocaleString()} at ${(soldMarginPct * 100).toFixed(0)}% margin.`,
    });
  }

  return {
    captured: inserted.length > 0,
    skippedReason: inserted.length ? null : "already_exists",
    snapshotId,
    hasPricing: !!pricing,
  };
}

// ---------------------------------------------------------------------------
// Shared: latest margin snapshot per (engagement, period).
// ---------------------------------------------------------------------------

type MarginSnap = typeof atelierEngagementMarginSnapshot.$inferSelect;

async function latestMarginSnapshots(
  orgId: string,
  opts: {
    periodFrom?: string | null;
    periodTo?: string | null;
  },
): Promise<MarginSnap[]> {
  const rows = await db
    .select()
    .from(atelierEngagementMarginSnapshot)
    .where(and(eq(atelierEngagementMarginSnapshot.orgId, orgId), isNull(atelierEngagementMarginSnapshot.deletedAt)));
  const inRange = rows.filter((r) => {
    if (opts.periodFrom && r.periodLabel < opts.periodFrom) return false;
    if (opts.periodTo && r.periodLabel > opts.periodTo) return false;
    return true;
  });
  // Latest snapshotAt per (engagement, period).
  const best = new Map<string, MarginSnap>();
  for (const r of inRange) {
    const key = `${r.engagementId}|${r.periodLabel}`;
    const prev = best.get(key);
    if (!prev || r.snapshotAt > prev.snapshotAt) best.set(key, r);
  }
  return Array.from(best.values());
}

/**
 * Engagement → legal-entity id. Task #654: the explicit
 * `atelier_engagements.legal_entity_id` wins when set; legacy rows
 * without it fall back to invoice inference (latest non-void invoice).
 */
async function engagementEntityMap(orgId: string, engagementIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!engagementIds.length) return map;
  const explicitRows = await db
    .select({ id: atelierEngagements.id, legalEntityId: atelierEngagements.legalEntityId })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.orgId, orgId), inArray(atelierEngagements.id, engagementIds)));
  const explicit = new Map(explicitRows.map((r) => [r.id, r.legalEntityId]));
  const invoices = await db
    .select({
      engagementId: atelierInvoice.engagementId,
      legalEntityId: atelierInvoice.legalEntityId,
      createdAt: atelierInvoice.createdAt,
    })
    .from(atelierInvoice)
    .where(and(eq(atelierInvoice.orgId, orgId), inArray(atelierInvoice.engagementId, engagementIds), isNull(atelierInvoice.deletedAt), isNull(atelierInvoice.voidedAt)));
  const latest = new Map<string, { at: Date; entity: string | null }>();
  for (const inv of invoices) {
    if (!inv.engagementId) continue;
    const prev = latest.get(inv.engagementId);
    if (!prev || inv.createdAt > prev.at) latest.set(inv.engagementId, { at: inv.createdAt, entity: inv.legalEntityId ?? null });
  }
  for (const id of engagementIds) map.set(id, explicit.get(id) ?? latest.get(id)?.entity ?? null);
  return map;
}

// ---------------------------------------------------------------------------
// Client (account) margin rollups.
// ---------------------------------------------------------------------------

export interface ClientMarginFilters {
  orgId: string; // tenant scope — required on every read
  periodFrom?: string | null; // YYYY-MM inclusive
  periodTo?: string | null; // YYYY-MM inclusive
  entityId?: string | null; // invoicing legal entity
  partnerId?: string | null; // engagement partnerOwnerId
}

export interface ClientMarginRow {
  accountId: string;
  accountName: string;
  engagementCount: number;
  revenueRecognised: number;
  directCost: number;
  grossMarginAmount: number;
  grossMarginPct: number;
  hoursBillable: number;
  leakageAmount: number;
  engagements: Array<{
    engagementId: string;
    engagementName: string;
    partnerOwnerId: string | null;
    entityId: string | null;
    revenueRecognised: number;
    directCost: number;
    grossMarginAmount: number;
    grossMarginPct: number;
  }>;
}

export async function computeClientMarginRollups(filters: ClientMarginFilters): Promise<{
  rows: ClientMarginRow[];
  totals: { revenueRecognised: number; directCost: number; grossMarginAmount: number; grossMarginPct: number };
  filters: ClientMarginFilters;
  entityDerivation: string;
}> {
  const snaps = await latestMarginSnapshots(filters.orgId, filters);
  const engIds = Array.from(new Set(snaps.map((s) => s.engagementId)));
  const [engs, entityByEng] = await Promise.all([
    engIds.length
      ? db
          .select({
            id: atelierEngagements.id,
            name: atelierEngagements.name,
            accountId: atelierEngagements.accountId,
            partnerOwnerId: atelierEngagements.partnerOwnerId,
          })
          .from(atelierEngagements)
          .where(and(eq(atelierEngagements.orgId, filters.orgId), inArray(atelierEngagements.id, engIds)))
      : Promise.resolve([] as Array<{ id: string; name: string; accountId: string; partnerOwnerId: string | null }>),
    engagementEntityMap(filters.orgId, engIds),
  ]);
  const engById = new Map(engs.map((e) => [e.id, e]));
  const acctIds = Array.from(new Set(engs.map((e) => e.accountId).filter(Boolean)));
  const accts = acctIds.length
    ? await db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.orgId, filters.orgId), inArray(atelierAccounts.id, acctIds)))
    : [];
  const acctNameById = new Map(accts.map((a) => [a.id, a.name]));

  // Aggregate snapshot periods per engagement first.
  const perEng = new Map<string, { revenue: number; cost: number; hours: number; leakage: number }>();
  for (const s of snaps) {
    const cur = perEng.get(s.engagementId) ?? { revenue: 0, cost: 0, hours: 0, leakage: 0 };
    cur.revenue += Number(s.revenueRecognised || 0);
    cur.cost += Number(s.directCost || 0);
    cur.hours += Number(s.hoursBillable || 0);
    cur.leakage += Number(s.leakageAmount || 0);
    perEng.set(s.engagementId, cur);
  }

  const byAccount = new Map<string, ClientMarginRow>();
  for (const [engId, agg] of perEng) {
    const eng = engById.get(engId);
    if (!eng) continue;
    if (filters.partnerId && eng.partnerOwnerId !== filters.partnerId) continue;
    const entityId = entityByEng.get(engId) ?? null;
    if (filters.entityId && entityId !== filters.entityId) continue;
    const gm = agg.revenue - agg.cost;
    let row = byAccount.get(eng.accountId);
    if (!row) {
      row = {
        accountId: eng.accountId,
        accountName: acctNameById.get(eng.accountId) ?? eng.accountId,
        engagementCount: 0,
        revenueRecognised: 0,
        directCost: 0,
        grossMarginAmount: 0,
        grossMarginPct: 0,
        hoursBillable: 0,
        leakageAmount: 0,
        engagements: [],
      };
      byAccount.set(eng.accountId, row);
    }
    row.engagementCount++;
    row.revenueRecognised += agg.revenue;
    row.directCost += agg.cost;
    row.grossMarginAmount += gm;
    row.hoursBillable += agg.hours;
    row.leakageAmount += agg.leakage;
    row.engagements.push({
      engagementId: engId,
      engagementName: eng.name,
      partnerOwnerId: eng.partnerOwnerId ?? null,
      entityId,
      revenueRecognised: agg.revenue,
      directCost: agg.cost,
      grossMarginAmount: gm,
      grossMarginPct: agg.revenue > 0 ? gm / agg.revenue : 0,
    });
  }
  const rows = Array.from(byAccount.values());
  for (const r of rows) {
    r.grossMarginPct = r.revenueRecognised > 0 ? r.grossMarginAmount / r.revenueRecognised : 0;
    r.engagements.sort((a, b) => b.revenueRecognised - a.revenueRecognised);
  }
  rows.sort((a, b) => b.revenueRecognised - a.revenueRecognised);
  const totals = rows.reduce(
    (t, r) => ({
      revenueRecognised: t.revenueRecognised + r.revenueRecognised,
      directCost: t.directCost + r.directCost,
      grossMarginAmount: t.grossMarginAmount + r.grossMarginAmount,
      grossMarginPct: 0,
    }),
    { revenueRecognised: 0, directCost: 0, grossMarginAmount: 0, grossMarginPct: 0 },
  );
  totals.grossMarginPct = totals.revenueRecognised > 0 ? totals.grossMarginAmount / totals.revenueRecognised : 0;
  return {
    rows,
    totals,
    filters,
    entityDerivation: "Engagement legal entity is derived from its latest (non-void) invoice; engagements never invoiced have no entity and match only the unfiltered view.",
  };
}

// ---------------------------------------------------------------------------
// Overhead allocation (net margin).
// ---------------------------------------------------------------------------

export type AllocationBasis = "revenue" | "direct_cost" | "hours";

export interface AllocationConfig {
  basis: AllocationBasis;
  glAccountCodes: string[];
  notes: string;
}

export async function getAllocationConfig(orgId: string): Promise<AllocationConfig> {
  const [row] = await db
    .select()
    .from(atelierOverheadAllocationConfig)
    .where(and(eq(atelierOverheadAllocationConfig.orgId, orgId), isNull(atelierOverheadAllocationConfig.deletedAt)))
    .limit(1);
  return {
    basis: (row?.basis as AllocationBasis) ?? "revenue",
    glAccountCodes: (row?.glAccountCodes as string[]) ?? [],
    notes: row?.notes ?? "",
  };
}

export async function setAllocationConfig(
  orgId: string,
  cfg: AllocationConfig,
  actor: { id: string; name: string },
): Promise<AllocationConfig> {
  await db
    .insert(atelierOverheadAllocationConfig)
    .values({
      id: `ohcfg_${orgId}`,
      orgId,
      basis: cfg.basis,
      glAccountCodes: cfg.glAccountCodes,
      notes: cfg.notes,
      updatedByUserId: actor.id,
      createdByUserId: actor.id,
    })
    .onConflictDoUpdate({
      target: atelierOverheadAllocationConfig.id,
      set: {
        basis: cfg.basis,
        glAccountCodes: cfg.glAccountCodes,
        notes: cfg.notes,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      },
    });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId,
    entityType: "finance_config",
    entityId: `ohcfg_${orgId}`,
    actorType: "human",
    actorId: actor.id,
    actorLabel: actor.name,
    action: "margin.allocation_config_updated",
    payload: { basis: cfg.basis, glAccountCodes: cfg.glAccountCodes },
    payloadSummary: `${actor.name} set overhead allocation basis to ${cfg.basis}${cfg.glAccountCodes.length ? ` over accounts ${cfg.glAccountCodes.join(", ")}` : " over all expense accounts"}.`,
  });
  return getAllocationConfig(orgId);
}

export interface NetMarginRow {
  engagementId: string;
  engagementName: string;
  accountId: string;
  accountName: string;
  partnerOwnerId: string | null;
  revenueRecognised: number;
  directCost: number;
  grossMarginAmount: number;
  grossMarginPct: number;
  basisValue: number;
  basisShare: number;
  allocatedOverheadUsd: number;
  netMarginAmount: number;
  netMarginPct: number;
}

export interface OverheadAllocationResult {
  periodFrom: string | null;
  periodTo: string | null;
  basis: AllocationBasis;
  glAccountCodes: string[];
  overheadPoolUsd: number;
  overheadLineCount: number;
  allocatedTotalUsd: number;
  tiesToGl: boolean;
  unallocatedUsd: number;
  rows: NetMarginRow[];
  basisNote: string;
}

/**
 * Overhead pool = GL expense-type journal lines with NO engagement
 * dimension in the period range (optionally restricted to configured
 * account codes). Allocated proportionally to the basis; the last row
 * absorbs the rounding residue so allocations tie to the GL total.
 */
export async function computeOverheadAllocation(opts: {
  periodFrom?: string | null;
  periodTo?: string | null;
  basisOverride?: AllocationBasis | null;
  orgId: string;
}): Promise<OverheadAllocationResult> {
  const cfg = await getAllocationConfig(opts.orgId);
  const basis = opts.basisOverride ?? cfg.basis;

  // 1) Overhead pool from GL.
  const expenseAccounts = await db
    .select({ id: atelierGlAccount.id, code: atelierGlAccount.code })
    .from(atelierGlAccount)
    .where(and(eq(atelierGlAccount.orgId, opts.orgId), eq(atelierGlAccount.type, "expense"), isNull(atelierGlAccount.deletedAt)));
  const wantedCodes = new Set(cfg.glAccountCodes);
  const accountIds = expenseAccounts
    .filter((a) => (wantedCodes.size ? wantedCodes.has(a.code) : true))
    .map((a) => a.id);

  let overheadPoolUsd = 0;
  let overheadLineCount = 0;
  if (accountIds.length) {
    const lines = await db
      .select({
        debit: atelierGlJournalLine.debit,
        credit: atelierGlJournalLine.credit,
        engagementId: atelierGlJournalLine.engagementId,
        journalEntryId: atelierGlJournalLine.journalEntryId,
      })
      .from(atelierGlJournalLine)
      .where(and(eq(atelierGlJournalLine.orgId, opts.orgId), inArray(atelierGlJournalLine.accountId, accountIds), isNull(atelierGlJournalLine.deletedAt)));
    const entryIds = Array.from(new Set(lines.map((l) => l.journalEntryId)));
    const entries = entryIds.length
      ? await db
          .select({ id: atelierGlJournalEntry.id, periodLabel: atelierGlJournalEntry.periodLabel })
          .from(atelierGlJournalEntry)
          .where(and(eq(atelierGlJournalEntry.orgId, opts.orgId), inArray(atelierGlJournalEntry.id, entryIds), isNull(atelierGlJournalEntry.deletedAt)))
      : [];
    const periodByEntry = new Map(entries.map((e) => [e.id, e.periodLabel]));
    for (const l of lines) {
      if (l.engagementId) continue; // engagement-dimensioned expense = direct, not overhead
      const period = periodByEntry.get(l.journalEntryId);
      if (!period) continue;
      if (opts.periodFrom && period < opts.periodFrom) continue;
      if (opts.periodTo && period > opts.periodTo) continue;
      overheadPoolUsd += Number(l.debit || 0) - Number(l.credit || 0);
      overheadLineCount++;
    }
  }

  // 2) Basis values per engagement from margin snapshots.
  const snaps = await latestMarginSnapshots(opts.orgId, opts);
  const perEng = new Map<string, { revenue: number; cost: number; hours: number }>();
  for (const s of snaps) {
    const cur = perEng.get(s.engagementId) ?? { revenue: 0, cost: 0, hours: 0 };
    cur.revenue += Number(s.revenueRecognised || 0);
    cur.cost += Number(s.directCost || 0);
    cur.hours += Number(s.hoursBillable || 0);
    perEng.set(s.engagementId, cur);
  }
  const engIds = Array.from(perEng.keys());
  const engs = engIds.length
    ? await db
        .select({
          id: atelierEngagements.id,
          name: atelierEngagements.name,
          accountId: atelierEngagements.accountId,
          partnerOwnerId: atelierEngagements.partnerOwnerId,
        })
        .from(atelierEngagements)
        .where(and(eq(atelierEngagements.orgId, opts.orgId), inArray(atelierEngagements.id, engIds)))
    : [];
  const acctIds = Array.from(new Set(engs.map((e) => e.accountId)));
  const accts = acctIds.length
    ? await db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.orgId, opts.orgId), inArray(atelierAccounts.id, acctIds)))
    : [];
  const acctNameById = new Map(accts.map((a) => [a.id, a.name]));

  const basisOf = (v: { revenue: number; cost: number; hours: number }): number =>
    basis === "revenue" ? v.revenue : basis === "direct_cost" ? v.cost : v.hours;

  const rowsRaw = engs
    .map((e) => {
      const agg = perEng.get(e.id)!;
      return { eng: e, agg, basisValue: Math.max(0, basisOf(agg)) };
    })
    .sort((a, b) => b.basisValue - a.basisValue);
  const basisTotal = rowsRaw.reduce((s, r) => s + r.basisValue, 0);

  const rows: NetMarginRow[] = [];
  let allocated = 0;
  rowsRaw.forEach((r, i) => {
    const share = basisTotal > 0 ? r.basisValue / basisTotal : 0;
    let alloc = basisTotal > 0 ? overheadPoolUsd * share : 0;
    // Tie-out: last positive-basis row absorbs rounding residue.
    const isLast = i === rowsRaw.length - 1;
    alloc = Math.round(alloc * 100) / 100;
    if (isLast && basisTotal > 0) alloc = Math.round((overheadPoolUsd - allocated) * 100) / 100;
    allocated += alloc;
    const gm = r.agg.revenue - r.agg.cost;
    const net = gm - alloc;
    rows.push({
      engagementId: r.eng.id,
      engagementName: r.eng.name,
      accountId: r.eng.accountId,
      accountName: acctNameById.get(r.eng.accountId) ?? r.eng.accountId,
      partnerOwnerId: r.eng.partnerOwnerId ?? null,
      revenueRecognised: r.agg.revenue,
      directCost: r.agg.cost,
      grossMarginAmount: gm,
      grossMarginPct: r.agg.revenue > 0 ? gm / r.agg.revenue : 0,
      basisValue: r.basisValue,
      basisShare: share,
      allocatedOverheadUsd: alloc,
      netMarginAmount: net,
      netMarginPct: r.agg.revenue > 0 ? net / r.agg.revenue : 0,
    });
  });

  const allocatedTotalUsd = Math.round(allocated * 100) / 100;
  const poolRounded = Math.round(overheadPoolUsd * 100) / 100;
  return {
    periodFrom: opts.periodFrom ?? null,
    periodTo: opts.periodTo ?? null,
    basis,
    glAccountCodes: cfg.glAccountCodes,
    overheadPoolUsd: poolRounded,
    overheadLineCount,
    allocatedTotalUsd,
    tiesToGl: basisTotal > 0 ? Math.abs(allocatedTotalUsd - poolRounded) < 0.01 : allocatedTotalUsd === 0,
    unallocatedUsd: basisTotal > 0 ? 0 : poolRounded,
    rows,
    basisNote:
      basis === "revenue"
        ? "Allocated in proportion to recognised revenue per engagement."
        : basis === "direct_cost"
          ? "Allocated in proportion to direct delivery cost per engagement."
          : "Allocated in proportion to billable hours per engagement.",
  };
}

// ---------------------------------------------------------------------------
// Realization report — sold vs delivered, leakage decomposed.
// ---------------------------------------------------------------------------

export interface RealizationRow {
  engagementId: string;
  engagementName: string;
  accountId: string;
  accountName: string;
  partnerOwnerId: string | null;
  opportunityId: string | null;
  sold: {
    snapshotId: string | null;
    hasPricing: boolean;
    priceUsd: number;
    hours: number;
    effectiveRateUsd: number;
    marginPct: number;
    targetMarginPct: number;
  } | null;
  delivered: {
    revenueRecognised: number;
    hoursBillable: number;
    effectiveRateUsd: number;
    directCost: number;
    grossMarginPct: number;
  };
  realizationRate: number | null; // delivered revenue / sold price
  leakage: {
    totalUsd: number;
    rateVarianceUsd: number;
    hoursOverrunUsd: number;
    scopeWriteOffsUsd: number;
    expenseNonRecoveryUsd: number;
  } | null;
  financials: {
    invoicedUsd: number;
    cashCollectedUsd: number;
    wipUsd: number;
    arUsd: number;
    lockupUsd: number;
  };
  currentBaseline: {
    contractValueUsd: number;
    budgetAtCompletionUsd: number;
    baselinedAt: string;
    postedChangeOrderCount: number;
    postedChangeOrderValueUsd: number;
  } | null;
}

export async function computeRealizationReport(filters: {
  orgId: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  partnerId?: string | null;
  engagementId?: string | null;
}): Promise<{ rows: RealizationRow[]; note: string }> {
  const snaps = await latestMarginSnapshots(filters.orgId, filters);
  const perEng = new Map<string, { revenue: number; cost: number; hours: number }>();
  for (const s of snaps) {
    if (filters.engagementId && s.engagementId !== filters.engagementId) continue;
    const cur = perEng.get(s.engagementId) ?? { revenue: 0, cost: 0, hours: 0 };
    cur.revenue += Number(s.revenueRecognised || 0);
    cur.cost += Number(s.directCost || 0);
    cur.hours += Number(s.hoursBillable || 0);
    perEng.set(s.engagementId, cur);
  }
  // The engagement-specific view is current-to-date and must still work
  // before the periodic margin refresh has captured its first snapshot.
  // Its durable CTD row is also the authoritative source used by P&L.
  const currentCosts = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(
      and(
        eq(atelierEngagementCostToDate.orgId, filters.orgId),
        ...(filters.engagementId
          ? [eq(atelierEngagementCostToDate.engagementId, filters.engagementId)]
          : []),
        isNull(atelierEngagementCostToDate.deletedAt),
      ),
    );
  if (filters.engagementId && !filters.periodFrom && !filters.periodTo) {
    const cost = currentCosts.find((row) => row.engagementId === filters.engagementId);
    if (cost) {
      perEng.set(cost.engagementId, {
        revenue: Number(cost.revenueRecognisedToDateUsd || 0),
        cost: Number(cost.costToDateUsd || 0),
        hours: Number(cost.labourHoursToDate || 0),
      });
    }
  }
  const engIds = Array.from(perEng.keys());
  if (!engIds.length) return { rows: [], note: "No margin snapshots in range — run POST /margin/refresh first." };

  // Authoritative accounting rollup. Posting lines are immutable and count
  // only when their parent period is posted; invoices exclude drafts/voids;
  // cash applications are append-only and reversals carry their own signed
  // amount. These values therefore replay without creating parallel ledgers.
  const [postingLines, postingHeaders, liveInvoices] = await Promise.all([
    db
      .select()
      .from(atelierRevenuePeriodPostingLine)
      .where(
        and(
          eq(atelierRevenuePeriodPostingLine.orgId, filters.orgId),
          inArray(atelierRevenuePeriodPostingLine.engagementId, engIds),
          isNull(atelierRevenuePeriodPostingLine.deletedAt),
        ),
      ),
    db
      .select({ id: atelierRevenuePeriodPosting.id, postedAt: atelierRevenuePeriodPosting.postedAt })
      .from(atelierRevenuePeriodPosting)
      .where(
        and(
          eq(atelierRevenuePeriodPosting.orgId, filters.orgId),
          isNull(atelierRevenuePeriodPosting.deletedAt),
        ),
      ),
    db
      .select()
      .from(atelierInvoice)
      .where(
        and(
          eq(atelierInvoice.orgId, filters.orgId),
          inArray(atelierInvoice.engagementId, engIds),
          isNull(atelierInvoice.deletedAt),
          isNull(atelierInvoice.voidedAt),
        ),
      ),
  ]);
  const postedIds = new Set(postingHeaders.filter((row) => row.postedAt).map((row) => row.id));
  const recognisedByEng = new Map<string, number>();
  for (const line of postingLines) {
    if (!postedIds.has(line.postingId)) continue;
    recognisedByEng.set(
      line.engagementId,
      (recognisedByEng.get(line.engagementId) ?? 0) + Number(line.recognisedAmount || 0),
    );
  }
  const inRequestedPeriod = (date: Date | string | null | undefined): boolean => {
    if (!date) return !filters.periodFrom && !filters.periodTo;
    const month = date instanceof Date ? date.toISOString().slice(0, 7) : String(date).slice(0, 7);
    return (!filters.periodFrom || month >= filters.periodFrom) && (!filters.periodTo || month <= filters.periodTo);
  };
  const periodInvoices = liveInvoices.filter(
    (row) => row.status !== "draft" && inRequestedPeriod(row.issuedAt),
  );
  const invoiceIds = liveInvoices
    .filter((row) => row.status !== "draft")
    .map((row) => row.id);
  const cashApplications = invoiceIds.length
    ? await db
        .select()
        .from(atelierCashApplication)
        .where(
          and(
            eq(atelierCashApplication.orgId, filters.orgId),
            inArray(atelierCashApplication.invoiceId, invoiceIds),
            isNull(atelierCashApplication.deletedAt),
          ),
        )
    : [];
  const invoicedByEng = new Map<string, number>();
  const invoiceEngagement = new Map<string, string>();
  for (const invoice of liveInvoices) {
    if (invoice.engagementId && invoice.status !== "draft") {
      invoiceEngagement.set(invoice.id, invoice.engagementId);
    }
  }
  for (const invoice of periodInvoices) {
    if (!invoice.engagementId) continue;
    invoicedByEng.set(
      invoice.engagementId,
      (invoicedByEng.get(invoice.engagementId) ?? 0) + Number(invoice.subtotal || 0),
    );
  }
  const cashByEng = new Map<string, number>();
  for (const application of cashApplications) {
    if (!inRequestedPeriod(application.appliedAt)) continue;
    const engagementId = invoiceEngagement.get(application.invoiceId);
    if (!engagementId) continue;
    cashByEng.set(
      engagementId,
      (cashByEng.get(engagementId) ?? 0) + Number(application.appliedAmount || 0),
    );
  }
  if (filters.engagementId && !filters.periodFrom && !filters.periodTo) {
    const current = perEng.get(filters.engagementId);
    if (current && recognisedByEng.has(filters.engagementId)) {
      current.revenue = recognisedByEng.get(filters.engagementId) ?? 0;
    }
  }

  const engs = await db
    .select({
      id: atelierEngagements.id,
      name: atelierEngagements.name,
      accountId: atelierEngagements.accountId,
      partnerOwnerId: atelierEngagements.partnerOwnerId,
      opportunityId: atelierEngagements.opportunityId,
    })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.orgId, filters.orgId), inArray(atelierEngagements.id, engIds)));
  const acctIds = Array.from(new Set(engs.map((e) => e.accountId)));
  const [accts, soldSnaps, adjustments, billableExpenses, budgets, changeOrders] = await Promise.all([
    acctIds.length
      ? db
          .select({ id: atelierAccounts.id, name: atelierAccounts.name })
          .from(atelierAccounts)
          .where(and(eq(atelierAccounts.orgId, filters.orgId), inArray(atelierAccounts.id, acctIds)))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    db
      .select()
      .from(atelierSoldPositionSnapshot)
      .where(and(eq(atelierSoldPositionSnapshot.orgId, filters.orgId), isNull(atelierSoldPositionSnapshot.deletedAt))),
    db
      .select({ engagementId: atelierRevenueAdjustment.engagementId, deltaAmount: atelierRevenueAdjustment.deltaAmount })
      .from(atelierRevenueAdjustment)
      .where(and(eq(atelierRevenueAdjustment.orgId, filters.orgId), inArray(atelierRevenueAdjustment.engagementId, engIds), isNull(atelierRevenueAdjustment.deletedAt))),
    db
      .select({
        id: atelierExpenses.id,
        engagementId: atelierExpenses.engagementId,
        usdAmount: atelierExpenses.usdAmount,
        contingencyStatus: atelierExpenses.contingencyStatus,
        directCostStatus: atelierExpenses.directCostStatus,
      })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.orgId, filters.orgId),
          inArray(atelierExpenses.engagementId, engIds),
          eq(atelierExpenses.clientBillable, true),
          inArray(atelierExpenses.status, ["approved", "reimbursed"]),
          isNull(atelierExpenses.deletedAt),
        ),
      ),
    db
      .select()
      .from(atelierEngagementBudget)
      .where(
        and(
          eq(atelierEngagementBudget.orgId, filters.orgId),
          inArray(atelierEngagementBudget.engagementId, engIds),
          isNull(atelierEngagementBudget.deletedAt),
        ),
      ),
    db
      .select({
        engagementId: atelierChangeOrder.engagementId,
        valueDeltaUsd: atelierChangeOrder.valueDeltaUsd,
      })
      .from(atelierChangeOrder)
      .where(
        and(
          eq(atelierChangeOrder.orgId, filters.orgId),
          inArray(atelierChangeOrder.engagementId, engIds),
          eq(atelierChangeOrder.status, "posted"),
          isNull(atelierChangeOrder.deletedAt),
        ),
      ),
  ]);
  const acctNameById = new Map(accts.map((a) => [a.id, a.name]));
  const soldByOpp = new Map(soldSnaps.map((s) => [s.opportunityId, s]));
  const soldByEng = new Map(soldSnaps.filter((s) => s.engagementId).map((s) => [s.engagementId as string, s]));
  const costByEng = new Map(currentCosts.map((row) => [row.engagementId, row]));
  const budgetByEng = new Map(budgets.map((row) => [row.engagementId, row]));
  const postedByEng = new Map<string, { count: number; value: number }>();
  for (const row of changeOrders) {
    const cur = postedByEng.get(row.engagementId) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(row.valueDeltaUsd || 0);
    postedByEng.set(row.engagementId, cur);
  }

  // Expense recovery: a billable expense counts as recovered when some
  // invoice line references it (sourceKind expense, sourceRef = expense id).
  const expenseIds = billableExpenses.map((e) => e.id);
  const recoveredExpenseIds = new Set<string>();
  if (expenseIds.length) {
    const lines = await db
      .select({ sourceRef: atelierInvoiceLine.sourceRef })
      .from(atelierInvoiceLine)
      .where(and(eq(atelierInvoiceLine.orgId, filters.orgId), eq(atelierInvoiceLine.sourceKind, "expense"), inArray(atelierInvoiceLine.sourceRef, expenseIds)));
    for (const l of lines) if (l.sourceRef) recoveredExpenseIds.add(l.sourceRef);
  }
  const writeOffByEng = new Map<string, number>();
  for (const a of adjustments) {
    const delta = Number(a.deltaAmount || 0);
    if (delta < 0) writeOffByEng.set(a.engagementId, (writeOffByEng.get(a.engagementId) ?? 0) + Math.abs(delta));
  }
  const nonRecoveredByEng = new Map<string, number>();
  for (const e of billableExpenses.filter(isExpenseEconomicallyActive)) {
    if (!e.engagementId || recoveredExpenseIds.has(e.id)) continue;
    nonRecoveredByEng.set(e.engagementId, (nonRecoveredByEng.get(e.engagementId) ?? 0) + Number(e.usdAmount || 0));
  }

  const rows: RealizationRow[] = [];
  for (const eng of engs) {
    if (filters.partnerId && eng.partnerOwnerId !== filters.partnerId) continue;
    const agg = perEng.get(eng.id)!;
    const sold = soldByEng.get(eng.id) ?? (eng.opportunityId ? soldByOpp.get(eng.opportunityId) : undefined) ?? null;
    const deliveredRate = agg.hours > 0 ? agg.revenue / agg.hours : 0;
    const currentCost = costByEng.get(eng.id);
    const isPeriodReport = Boolean(filters.periodFrom || filters.periodTo);
    const invoiced = invoicedByEng.has(eng.id)
      ? invoicedByEng.get(eng.id)!
      : isPeriodReport
        ? 0
        : Number(currentCost?.invoicedToDateUsd || 0);
    const cash = cashByEng.has(eng.id)
      ? cashByEng.get(eng.id)!
      : isPeriodReport
        ? 0
        : Number(currentCost?.cashCollectedToDateUsd || 0);
    const budget = budgetByEng.get(eng.id);
    const posted = postedByEng.get(eng.id) ?? { count: 0, value: 0 };
    let leakage: RealizationRow["leakage"] = null;
    let realizationRate: number | null = null;
    if (sold && sold.soldPriceUsd > 0) {
      realizationRate = agg.revenue / sold.soldPriceUsd;
      const soldRate = Number(sold.soldEffectiveRateUsd || 0);
      const soldHours = Number(sold.soldHours || 0);
      // Rate variance: delivered effective rate below sold rate, over hours actually worked.
      const soldTrancheHours = Math.min(agg.hours, soldHours || agg.hours);
      const soldTrancheRevenue = Math.min(
        agg.revenue,
        soldRate * soldTrancheHours,
      );
      const rateVarianceUsd =
        soldRate > 0
          ? Math.max(0, soldRate * soldTrancheHours - soldTrancheRevenue)
          : 0;
      // Hours overrun: hours beyond the sold plan, valued at sold rate (unbilled effort).
      const hoursOverrunUsd = soldHours > 0 && agg.hours > soldHours ? (agg.hours - soldHours) * soldRate : 0;
      const scopeWriteOffsUsd = writeOffByEng.get(eng.id) ?? 0;
      const expenseNonRecoveryUsd = nonRecoveredByEng.get(eng.id) ?? 0;
      leakage = {
        totalUsd: rateVarianceUsd + hoursOverrunUsd + scopeWriteOffsUsd + expenseNonRecoveryUsd,
        rateVarianceUsd,
        hoursOverrunUsd,
        scopeWriteOffsUsd,
        expenseNonRecoveryUsd,
      };
    }
    rows.push({
      engagementId: eng.id,
      engagementName: eng.name,
      accountId: eng.accountId,
      accountName: acctNameById.get(eng.accountId) ?? eng.accountId,
      partnerOwnerId: eng.partnerOwnerId ?? null,
      opportunityId: eng.opportunityId ?? null,
      sold: sold
        ? {
            snapshotId: sold.id,
            hasPricing: sold.hasPricing,
            priceUsd: Number(sold.soldPriceUsd || 0),
            hours: Number(sold.soldHours || 0),
            effectiveRateUsd: Number(sold.soldEffectiveRateUsd || 0),
            marginPct: Number(sold.soldMarginPct || 0),
            targetMarginPct: Number(sold.targetMarginPct || 0),
          }
        : null,
      delivered: {
        revenueRecognised: agg.revenue,
        hoursBillable: agg.hours,
        effectiveRateUsd: deliveredRate,
        directCost: agg.cost,
        grossMarginPct: agg.revenue > 0 ? (agg.revenue - agg.cost) / agg.revenue : 0,
      },
      realizationRate,
      leakage,
      financials: {
        invoicedUsd: invoiced,
        cashCollectedUsd: cash,
        wipUsd: agg.revenue - invoiced,
        arUsd: invoiced - cash,
        lockupUsd: agg.revenue - cash,
      },
      currentBaseline: budget
        ? {
            contractValueUsd: Number(budget.contractValueUsd || 0),
            budgetAtCompletionUsd: Number(budget.budgetAtCompletionUsd || 0),
            baselinedAt: budget.baselinedAt,
            postedChangeOrderCount: posted.count,
            postedChangeOrderValueUsd: posted.value,
          }
        : null,
    });
  }
  rows.sort((a, b) => (a.realizationRate ?? 2) - (b.realizationRate ?? 2));
  return {
    rows,
    note: "Realization = recognised revenue ÷ sold price. Leakage decomposition: rate variance (delivered effective rate below sold rate), hours overrun (hours beyond sold plan at sold rate), scope write-offs (negative revenue adjustments), expense non-recovery (approved client-billable expenses never invoiced).",
  };
}

// ---------------------------------------------------------------------------
// Backfill — capture sold positions for contract-stage opps lacking one.
// ---------------------------------------------------------------------------

export async function backfillSoldPositions(orgId: string, actor: { id: string; name: string }): Promise<{
  scanned: number;
  captured: number;
  skipped: number;
}> {
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.orgId, orgId), eq(atelierOpportunities.salesStage, "contract"), isNull(atelierOpportunities.deletedAt)));
  let captured = 0;
  let skipped = 0;
  for (const opp of opps) {
    const res = await captureSoldPositionSnapshot(opp, actor, "backfill");
    if (res.captured) captured++;
    else skipped++;
  }
  return { scanned: opps.length, captured, skipped };
}

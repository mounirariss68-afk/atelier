/**
 * Atelier — Engagement P&L cost-to-date recompute (Task #457).
 *
 * Rolls up live operational data into the persisted
 * `atelier_engagement_cost_to_date` snapshot:
 *   - labour_hours_to_date / labour_cost_to_date_usd ← atelierTimesheetEntries
 *     (status ∈ submitted | lead_approved | approved | partner_approved),
 *     priced through the active rate card by employee seniority.
 *   - expenses_to_date_usd ← atelierExpenses (status ∈ submitted | approved),
 *     using the pre-computed usdAmount snapshot.
 *   - subs_to_date_usd ← atelierPartnerFirmHours, FX-converted to USD.
 *
 * Revenue / invoiced / cash / pctComplete columns are NOT touched here —
 * those have separate sources (revrec, invoicing, cash collections) and
 * are still owned by the seed reconciliation pass.
 *
 * An audit row is written whenever recompute changes labour-hours by
 * >= 5h or any of {labour cost, expenses, subs} by >= $250 USD.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierEngagementBudget,
  atelierEngagementCostToDate,
  atelierEngagementPnlAudit,
  atelierTimesheetEntries,
  atelierEmployees,
  atelierContractors,
  atelierRateCards,
  atelierRateCardRows,
  atelierExpenses,
  atelierPartnerFirmHours,
  atelierVendorCostSplits,
} from "@workspace/db";
import { convertToUsd } from "./atelier-fx.js";
import { resolveContractorRate, contractorRatePerHour } from "./atelier-contractor-rates.js";

const LIVE_TIMESHEET_STATUSES = ["lead_approved", "approved", "partner_approved"] as const;

const LIVE_EXPENSE_STATUSES = ["approved", "reimbursed"] as const;

// employee.seniority → rate-card seniority label (mirrors ledgerRoutes mapping).
const SENIORITY_TO_CARD: Record<string, string> = {
  partner: "Partner",
  principal: "Principal",
  manager: "SubjectMatterLead",
  senior_consultant: "AIEngineer",
  consultant: "AIEngineer",
  analyst: "Analyst",
};

const FALLBACK_DAY_RATE_COST_USD = 600; // ledgerRoutes uses the same fallback
const HOURS_PER_DAY = 8;

const MATERIAL_HOURS_DELTA = 5;
const MATERIAL_USD_DELTA = 250;

export interface RecomputeResult {
  engagementId: string;
  status: "updated" | "unchanged" | "engagement_unknown" | "no_cost_row";
  before: {
    labourHoursToDate: number;
    labourCostToDateUsd: number;
    expensesToDateUsd: number;
    subsToDateUsd: number;
  } | null;
  after: {
    labourHoursToDate: number;
    labourCostToDateUsd: number;
    expensesToDateUsd: number;
    subsToDateUsd: number;
  } | null;
  audited: boolean;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadActiveRateMap(orgId: string): Promise<Map<string, number>> {
  const [activeCard] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.orgId, orgId), isNull(atelierRateCards.deletedAt)))
    .orderBy(desc(atelierRateCards.createdAt))
    .limit(1);
  if (!activeCard) return new Map();
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(
      and(
        eq(atelierRateCardRows.rateCardId, activeCard.id),
        eq(atelierRateCardRows.orgId, orgId),
        isNull(atelierRateCardRows.deletedAt),
      ),
    );
  return new Map(rows.map((r) => [r.seniority, Number(r.dayRateInternalCost)]));
}

async function rollupLabour(
  orgId: string,
  engagementId: string,
  rateBySeniority: Map<string, number>,
): Promise<{ hours: number; costUsd: number }> {
  const entries = await db
    .select({
      hours: atelierTimesheetEntries.hours,
      personId: atelierTimesheetEntries.personId,
      personType: atelierTimesheetEntries.personType,
      workDate: atelierTimesheetEntries.workDate,
    })
    .from(atelierTimesheetEntries)
    .where(
      and(
        eq(atelierTimesheetEntries.engagementId, engagementId),
        eq(atelierTimesheetEntries.orgId, orgId),
        inArray(
          atelierTimesheetEntries.status,
          LIVE_TIMESHEET_STATUSES as unknown as string[],
        ),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    );
  if (entries.length === 0) return { hours: 0, costUsd: 0 };

  const personIds = Array.from(new Set(entries.map((e) => e.personId)));
  const empRows = await db
    .select({ id: atelierEmployees.id, seniority: atelierEmployees.seniority })
    .from(atelierEmployees)
    .where(
      and(
        inArray(atelierEmployees.id, personIds),
        eq(atelierEmployees.orgId, orgId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  const seniorityById = new Map(empRows.map((r) => [r.id, r.seniority] as const));

  let hours = 0;
  let costUsd = 0;
  for (const e of entries) {
    const h = Number(e.hours || 0);
    if (h <= 0) continue;
    let dayRate: number;
    let dayRateCurrency = "USD";
    if (e.personType === "contractor") {
      const [c] = await db.select({ orgId: atelierContractors.orgId }).from(atelierContractors).where(and(
        eq(atelierContractors.id, e.personId), eq(atelierContractors.orgId, orgId), isNull(atelierContractors.deletedAt),
      ));
      const resolved = c?.orgId ? await resolveContractorRate({
        orgId: c.orgId, contractorId: e.personId, engagementId, workDate: e.workDate,
        fallbackDayRate: FALLBACK_DAY_RATE_COST_USD,
      }) : null;
      dayRate = resolved ? contractorRatePerHour(resolved) * HOURS_PER_DAY : FALLBACK_DAY_RATE_COST_USD;
      dayRateCurrency = resolved?.currency ?? "USD";
    } else {
      const empSeniority = (seniorityById.get(e.personId) ?? "consultant").toLowerCase();
      const cardKey = SENIORITY_TO_CARD[empSeniority] ?? "AIEngineer";
      dayRate = rateBySeniority.get(cardKey) ?? FALLBACK_DAY_RATE_COST_USD;
    }
    hours += h;
    const localCost = (h / HOURS_PER_DAY) * dayRate;
    if (dayRateCurrency.toUpperCase() === "USD") {
      costUsd += localCost;
    } else {
      const converted = await convertToUsd(localCost, dayRateCurrency, e.workDate);
      costUsd += converted.usdAmount;
    }
  }
  return { hours, costUsd };
}

async function rollupExpenses(orgId: string, engagementId: string): Promise<number> {
  const rows = await db
    .select({ usdAmount: atelierExpenses.usdAmount })
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, engagementId),
        eq(atelierExpenses.orgId, orgId),
        inArray(
          atelierExpenses.status,
          LIVE_EXPENSE_STATUSES as unknown as string[],
        ),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  let total = 0;
  for (const r of rows) total += Number(r.usdAmount || 0);
  return total;
}

async function rollupSubs(orgId: string, engagementId: string): Promise<number> {
  const rows = await db
    .select({
      costAmount: atelierPartnerFirmHours.costAmount,
      costCurrency: atelierPartnerFirmHours.costCurrency,
      workDate: atelierPartnerFirmHours.workDate,
      uploadedAt: atelierPartnerFirmHours.uploadedAt,
    })
    .from(atelierPartnerFirmHours)
    .where(
      and(
        eq(atelierPartnerFirmHours.engagementId, engagementId),
        eq(atelierPartnerFirmHours.orgId, orgId),
        isNull(atelierPartnerFirmHours.deletedAt),
      ),
    );
  let total = 0;
  for (const r of rows) {
    const amount = Number(r.costAmount || 0);
    if (amount === 0) continue;
    const cur = (r.costCurrency || "USD").toUpperCase();
    if (cur === "USD") {
      total += amount;
      continue;
    }
    const dateForFx =
      r.workDate ?? (r.uploadedAt ? new Date(r.uploadedAt).toISOString().slice(0, 10) : todayIso());
    const conv = await convertToUsd(amount, cur, dateForFx);
    total += conv.usdAmount;
  }

  // Task #1251 — tooling costs (approved vendor cost splits mapped to this
  // engagement) ride the subs bucket: they are external-vendor spend
  // attributed to the engagement, same economic character as subcontractor
  // cost. usd_amount is snapshotted at invoice date on approval.
  const toolingRows = await db
    .select({ usdAmount: atelierVendorCostSplits.usdAmount })
    .from(atelierVendorCostSplits)
    .where(
      and(
        eq(atelierVendorCostSplits.bucketType, "engagement"),
        eq(atelierVendorCostSplits.bucketRef, engagementId),
        eq(atelierVendorCostSplits.orgId, orgId),
        eq(atelierVendorCostSplits.status, "approved"),
        isNull(atelierVendorCostSplits.deletedAt),
      ),
    );
  for (const r of toolingRows) {
    total += Number(r.usdAmount || 0);
  }

  return total;
}

function isMaterial(
  before: { labourHoursToDate: number; labourCostToDateUsd: number; expensesToDateUsd: number; subsToDateUsd: number },
  after: { labourHoursToDate: number; labourCostToDateUsd: number; expensesToDateUsd: number; subsToDateUsd: number },
): boolean {
  return (
    Math.abs(after.labourHoursToDate - before.labourHoursToDate) >= MATERIAL_HOURS_DELTA ||
    Math.abs(after.labourCostToDateUsd - before.labourCostToDateUsd) >= MATERIAL_USD_DELTA ||
    Math.abs(after.expensesToDateUsd - before.expensesToDateUsd) >= MATERIAL_USD_DELTA ||
    Math.abs(after.subsToDateUsd - before.subsToDateUsd) >= MATERIAL_USD_DELTA
  );
}

export async function recomputeEngagementCostToDate(
  engagementId: string,
  opts: { orgId: string; actorUserId?: string | null },
): Promise<RecomputeResult> {
  const [budgetRow] = await db
    .select({ engagementId: atelierEngagementBudget.engagementId })
    .from(atelierEngagementBudget)
    .where(and(eq(atelierEngagementBudget.engagementId, engagementId), eq(atelierEngagementBudget.orgId, opts.orgId)))
    .limit(1);
  if (!budgetRow) {
    return {
      engagementId,
      status: "engagement_unknown",
      before: null,
      after: null,
      audited: false,
    };
  }

  let [costRow] = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(and(eq(atelierEngagementCostToDate.engagementId, engagementId), eq(atelierEngagementCostToDate.orgId, opts.orgId)))
    .limit(1);
  if (!costRow) {
    // Self-heal: a new engagement without a seeded cost-to-date row
    // gets a zero-baselined snapshot here so the very first read sees
    // live numbers instead of returning null forever.
    await db.insert(atelierEngagementCostToDate).values({
      engagementId,
      orgId: opts.orgId,
      asOf: todayIso(),
      labourHoursToDate: 0,
      labourCostToDateUsd: 0,
      expensesToDateUsd: 0,
      subsToDateUsd: 0,
      costToDateUsd: 0,
      revenueRecognisedToDateUsd: 0,
      invoicedToDateUsd: 0,
      cashCollectedToDateUsd: 0,
      pctComplete: 0,
    }).onConflictDoNothing({ target: atelierEngagementCostToDate.engagementId });
    [costRow] = await db
      .select()
      .from(atelierEngagementCostToDate)
      .where(and(eq(atelierEngagementCostToDate.engagementId, engagementId), eq(atelierEngagementCostToDate.orgId, opts.orgId)))
      .limit(1);
    if (!costRow) {
      return {
        engagementId,
        status: "no_cost_row",
        before: null,
        after: null,
        audited: false,
      };
    }
  }

  const rateBySeniority = await loadActiveRateMap(opts.orgId);
  const [labour, expenses, subs] = await Promise.all([
    rollupLabour(opts.orgId, engagementId, rateBySeniority),
    rollupExpenses(opts.orgId, engagementId),
    rollupSubs(opts.orgId, engagementId),
  ]);

  const before = {
    labourHoursToDate: Number(costRow.labourHoursToDate || 0),
    labourCostToDateUsd: Number(costRow.labourCostToDateUsd || 0),
    expensesToDateUsd: Number(costRow.expensesToDateUsd || 0),
    subsToDateUsd: Number(costRow.subsToDateUsd || 0),
  };
  const after = {
    labourHoursToDate: Math.round(labour.hours * 100) / 100,
    labourCostToDateUsd: Math.round(labour.costUsd * 100) / 100,
    expensesToDateUsd: Math.round(expenses * 100) / 100,
    subsToDateUsd: Math.round(subs * 100) / 100,
  };
  const newCostToDateUsd =
    after.labourCostToDateUsd + after.expensesToDateUsd + after.subsToDateUsd;

  const noChange =
    before.labourHoursToDate === after.labourHoursToDate &&
    before.labourCostToDateUsd === after.labourCostToDateUsd &&
    before.expensesToDateUsd === after.expensesToDateUsd &&
    before.subsToDateUsd === after.subsToDateUsd;

  if (noChange) {
    return {
      engagementId,
      status: "unchanged",
      before,
      after,
      audited: false,
    };
  }

  await db
    .update(atelierEngagementCostToDate)
    .set({
      labourHoursToDate: after.labourHoursToDate,
      labourCostToDateUsd: after.labourCostToDateUsd,
      expensesToDateUsd: after.expensesToDateUsd,
      subsToDateUsd: after.subsToDateUsd,
      costToDateUsd: Math.round(newCostToDateUsd * 100) / 100,
      asOf: todayIso(),
      updatedAt: new Date(),
    })
    .where(and(eq(atelierEngagementCostToDate.engagementId, engagementId), eq(atelierEngagementCostToDate.orgId, opts.orgId)));

  let audited = false;
  if (isMaterial(before, after)) {
    const fmtUsd = (n: number) =>
      `$${Math.round(n).toLocaleString()}`;
    const detail =
      `cost-to-date recomputed from live timesheet+expense data — ` +
      `labour ${before.labourHoursToDate.toFixed(0)}h→${after.labourHoursToDate.toFixed(0)}h ` +
      `(${fmtUsd(before.labourCostToDateUsd)}→${fmtUsd(after.labourCostToDateUsd)}), ` +
      `expenses ${fmtUsd(before.expensesToDateUsd)}→${fmtUsd(after.expensesToDateUsd)}, ` +
      `subs ${fmtUsd(before.subsToDateUsd)}→${fmtUsd(after.subsToDateUsd)}.`;
    await db.insert(atelierEngagementPnlAudit).values({
      id: rid("aud"),
      orgId: opts.orgId,
      engagementId,
      atIso: new Date().toISOString(),
      actorUserId: opts.actorUserId ?? null,
      action: "cost_to_date.recomputed",
      detail,
    });
    audited = true;
  }

  return { engagementId, status: "updated", before, after, audited };
}

export async function recomputeAllEngagementCostsToDate(
  opts: { orgId: string; actorUserId?: string | null },
): Promise<RecomputeResult[]> {
  const budgets = await db
    .select({ engagementId: atelierEngagementBudget.engagementId })
    .from(atelierEngagementBudget)
    .where(and(eq(atelierEngagementBudget.orgId, opts.orgId), isNull(atelierEngagementBudget.deletedAt)));
  const out: RecomputeResult[] = [];
  for (const b of budgets) {
    out.push(await recomputeEngagementCostToDate(b.engagementId, opts));
  }
  return out;
}

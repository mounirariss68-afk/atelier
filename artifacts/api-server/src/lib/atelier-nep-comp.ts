/**
 * Task #1298 — Non-salaried NEP compensation core.
 *
 * Pure tier/profit math + the idempotent entitlement recompute and the
 * rolling 12-month conversion tracker. Route handlers (nepCompRoutes)
 * and the seed script share these helpers so the math never forks.
 *
 * Sources of truth:
 *  - Fees invoiced/collected: atelier_invoice (client AR). "Collected"
 *    means invoice amountPaid via cash application (invoice paid status);
 *    the engagement counts as FULLY collected when every issued invoice
 *    is settled and at least one exists.
 *  - Direct Delivery Costs: contractor labour (atelier_contractor_payments,
 *    which already includes the NEP's own time charges at their day rate),
 *    partner-firm hours, and approved engagement-tagged expenses. Firm
 *    overhead / G&A is excluded by construction (only engagement-tagged
 *    cost rows are read).
 *  - Attribution: atelier_accounts.originatedByUserId (+ the founder-
 *    editable originationFirstEngagementAt window anchor) and
 *    atelier_engagements.materialContributionUserId.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContractors,
  atelierEngagements,
  atelierInvoice,
  atelierContractorPayments,
  atelierPartnerFirmHours,
  atelierExpenses,
  atelierNepCompPlans,
  atelierNepEntitlements,
  type NepEntitlementStatement,
  type NepEntitlementStatementLine,
} from "@workspace/db";
import { convertToUsd } from "./atelier-fx.js";

export type NepPlan = typeof atelierNepCompPlans.$inferSelect;
export type NepEntitlement = typeof atelierNepEntitlements.$inferSelect;

const r2 = (n: number) => Math.round(n * 100) / 100;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Pure math — unit-tested directly (worked example from the agreement:
// $500k fees, $300k direct costs → $200k Project Profit → $40k @20% / $20k @10%).
// ---------------------------------------------------------------------------

export function computeProjectProfit(feesCollectedUsd: number, directCostsUsd: number): number {
  return r2(feesCollectedUsd - directCostsUsd);
}

export function computeMarginShare(projectProfitUsd: number, tierPct: number): number {
  if (projectProfitUsd <= 0 || tierPct <= 0) return 0;
  return r2(projectProfitUsd * (tierPct / 100));
}

/** Months (calendar) between two YYYY-MM-DD dates; fractional days count. */
export function isWithinWindowMonths(
  firstEngagementAt: string,
  engagementSignedAt: string,
  windowMonths: number,
): boolean {
  const start = new Date(`${firstEngagementAt}T00:00:00Z`);
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + windowMonths);
  const signed = new Date(`${engagementSignedAt}T00:00:00Z`);
  return signed.getTime() >= start.getTime() && signed.getTime() <= end.getTime();
}

export interface TierInput {
  originated: boolean;
  materialContribution: boolean;
  firstEngagementAt: string | null;
  engagementSignedAt: string | null;
  windowMonths: number;
  saleTierPct: number;
  originationOnlyPct: number;
}

export interface TierResult {
  tier: "sale" | "origination_only" | "none";
  pct: number;
  reason: string;
  insideWindow: boolean | null;
}

/**
 * Tier selection per Clause 6.3/6.4:
 *  - sale tier (no time limit) when the partner made a material
 *    contribution to the sale — with or without origination;
 *  - origination-only tier for originated clients WITHOUT material
 *    contribution, limited to engagements signed within the window of
 *    the first engagement at that client;
 *  - none otherwise (or when the window has lapsed).
 */
export function selectTier(input: TierInput): TierResult {
  if (input.materialContribution) {
    return {
      tier: "sale",
      pct: input.saleTierPct,
      reason: input.originated
        ? "Originated client + material contribution to the sale (no time limit)."
        : "Material contribution to the sale.",
      insideWindow: null,
    };
  }
  if (!input.originated) {
    return { tier: "none", pct: 0, reason: "Not originated and no material contribution recorded.", insideWindow: null };
  }
  if (!input.firstEngagementAt || !input.engagementSignedAt) {
    return {
      tier: "none",
      pct: 0,
      reason: "Origination-only tier needs a first-engagement date and an engagement signed date to test the window.",
      insideWindow: null,
    };
  }
  const inside = isWithinWindowMonths(input.firstEngagementAt, input.engagementSignedAt, input.windowMonths);
  if (!inside) {
    return {
      tier: "none",
      pct: 0,
      reason: `Origination-only window lapsed (${input.windowMonths} months from first engagement).`,
      insideWindow: false,
    };
  }
  return {
    tier: "origination_only",
    pct: input.originationOnlyPct,
    reason: `Originated client, engagement signed within ${input.windowMonths} months of the first engagement.`,
    insideWindow: true,
  };
}

/** Due date = 30 days after the later of collection and client acceptance. */
export function computeDueDate(collectedAt: Date | null, clientAcceptedAt: Date | null): string | null {
  if (!collectedAt || !clientAcceptedAt) return null;
  const base = collectedAt.getTime() > clientAcceptedAt.getTime() ? collectedAt : clientAcceptedAt;
  const due = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
  return due.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Effective-dated plan resolution
// ---------------------------------------------------------------------------

/**
 * The plan effective on a given date: latest row with effectiveFrom <= date.
 * Returns null when no plan is effective yet — dates before the first
 * effectiveFrom are NOT covered (no retroactive fallback; a genuinely
 * retroactive agreement is entered by back-dating effectiveFrom explicitly).
 */
export function pickEffectivePlan(rows: NepPlan[], onDate: string): NepPlan | null {
  const eligible = rows
    .filter((p) => !p.deletedAt && p.effectiveFrom <= onDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eligible[0] ?? null;
}

/**
 * Re-derive the contractor's operational day rate from the CURRENTLY
 * effective plan. Called on plan writes and recompute so a future-dated
 * revision starts paying its rate only once it becomes effective.
 * No-op when no plan is effective yet or the rate already matches.
 */
export async function syncContractorDayRate(orgId: string, contractorId: string): Promise<void> {
  const plans = await loadPlansForContractor(orgId, contractorId);
  const current = pickEffectivePlan(plans, new Date().toISOString().slice(0, 10));
  if (!current) return;
  const [contractor] = await db.select().from(atelierContractors).where(and(
    eq(atelierContractors.orgId, orgId),
    eq(atelierContractors.id, contractorId),
  ));
  if (!contractor) return;
  if (contractor.dayRateAmount === current.dayRateAmount && contractor.dayRateCurrency === current.currency) return;
  await db.update(atelierContractors).set({
    dayRateAmount: current.dayRateAmount,
    dayRateCurrency: current.currency,
    updatedAt: new Date(),
  }).where(eq(atelierContractors.id, contractorId));
}

/** Monday (YYYY-MM-DD) of an ISO week id like "2026-W03"; null if unparsable. */
export function isoWeekStart(weekIso: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekIso);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO 8601: week 1 contains Jan 4. Monday of week 1 = Jan 4 - (isoDow(Jan4)-1).
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoDow = (jan4.getUTCDay() + 6) % 7; // 0=Mon
  const week1Monday = new Date(jan4.getTime() - isoDow * 86400000);
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Rate-consumption boundary for effective-dated NEP plans: resolve the
 * contractor's day rate AS OF THE WORK DATE from the plan effective on
 * that date. Returns null when the contractor has no NEP plan covering
 * the date (callers then fall back to the roster day-rate field, which
 * covers plain contractors and pre-plan work). This is what makes a
 * future-dated revision start paying on its effective date without any
 * manual recompute — pricing paths must call this, not read the roster
 * field alone.
 */
export async function resolveContractorDayRateForDate(
  orgId: string,
  contractorId: string,
  onDate: string,
): Promise<{ dayRateAmount: number; currency: string; planId: string } | null> {
  const plans = await loadPlansForContractor(orgId, contractorId);
  if (!plans.length) return null;
  const plan = pickEffectivePlan(plans, onDate);
  if (!plan) return null;
  return { dayRateAmount: plan.dayRateAmount, currency: plan.currency, planId: plan.id };
}

export async function loadPlansForContractor(orgId: string, contractorId: string): Promise<NepPlan[]> {
  return db
    .select()
    .from(atelierNepCompPlans)
    .where(and(
      eq(atelierNepCompPlans.orgId, orgId),
      eq(atelierNepCompPlans.contractorId, contractorId),
      isNull(atelierNepCompPlans.deletedAt),
    ));
}

// ---------------------------------------------------------------------------
// Engagement economics
// ---------------------------------------------------------------------------

export interface EngagementEconomics {
  feesInvoicedUsd: number;
  feesCollectedUsd: number;
  fullyCollected: boolean;
  collectedAt: Date | null;
  contractorLabourUsd: number;   // all contractor labour EXCLUDING the NEP's own
  ownTimeChargesUsd: number;     // the NEP's own time charges
  partnerFirmUsd: number;
  expensesUsd: number;
  directCostsUsd: number;        // sum of the above cost buckets
}

export async function computeEngagementEconomics(
  orgId: string,
  engagementId: string,
  nepUserId: string | null,
): Promise<EngagementEconomics> {
  const invoices = await db
    .select()
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.orgId, orgId),
      eq(atelierInvoice.engagementId, engagementId),
      isNull(atelierInvoice.deletedAt),
    ));
  const live = invoices.filter((i) => i.status === "issued" || i.status === "paid");
  let feesInvoicedUsd = 0;
  let feesCollectedUsd = 0;
  let collectedAt: Date | null = null;
  for (const inv of live) {
    const totalUsd = (await convertToUsd(inv.total, inv.currency, inv.issuedAt ?? inv.createdAt)).usdAmount;
    const paidUsd = inv.total > 0 ? r2(totalUsd * (Math.min(inv.amountPaid, inv.total) / inv.total)) : 0;
    feesInvoicedUsd += totalUsd;
    feesCollectedUsd += paidUsd;
    if (inv.paidAt && (!collectedAt || inv.paidAt.getTime() > collectedAt.getTime())) collectedAt = inv.paidAt;
  }
  const fullyCollected = live.length > 0 && live.every((i) => i.status === "paid" || i.amountPaid >= i.total - 0.01);

  const cpRows = await db
    .select()
    .from(atelierContractorPayments)
    .where(and(
      eq(atelierContractorPayments.orgId, orgId),
      eq(atelierContractorPayments.engagementId, engagementId),
      isNull(atelierContractorPayments.deletedAt),
    ));
  let contractorLabourUsd = 0;
  let ownTimeChargesUsd = 0;
  for (const cp of cpRows) {
    if (cp.status === "rejected") continue;
    const usd = cp.usdAmount || (await convertToUsd(cp.costAmount, cp.costCurrency, cp.createdAt)).usdAmount;
    if (nepUserId && cp.payeeUserId === nepUserId) ownTimeChargesUsd += usd;
    else contractorLabourUsd += usd;
  }

  const pfRows = await db
    .select()
    .from(atelierPartnerFirmHours)
    .where(and(
      eq(atelierPartnerFirmHours.orgId, orgId),
      eq(atelierPartnerFirmHours.engagementId, engagementId),
      isNull(atelierPartnerFirmHours.deletedAt),
    ));
  let partnerFirmUsd = 0;
  for (const pf of pfRows) {
    partnerFirmUsd += (await convertToUsd(pf.costAmount ?? 0, pf.costCurrency ?? "USD", pf.createdAt)).usdAmount;
  }

  const expRows = await db
    .select()
    .from(atelierExpenses)
    .where(and(
      eq(atelierExpenses.orgId, orgId),
      eq(atelierExpenses.engagementId, engagementId),
      inArray(atelierExpenses.status, ["approved", "reimbursed"]),
      isNull(atelierExpenses.deletedAt),
    ));
  const expensesUsd = expRows.reduce((s, e) => s + (e.usdAmount ?? 0), 0);

  const directCostsUsd = r2(contractorLabourUsd + ownTimeChargesUsd + partnerFirmUsd + expensesUsd);
  return {
    feesInvoicedUsd: r2(feesInvoicedUsd),
    feesCollectedUsd: r2(feesCollectedUsd),
    fullyCollected,
    collectedAt,
    contractorLabourUsd: r2(contractorLabourUsd),
    ownTimeChargesUsd: r2(ownTimeChargesUsd),
    partnerFirmUsd: r2(partnerFirmUsd),
    expensesUsd: r2(expensesUsd),
    directCostsUsd,
  };
}

// ---------------------------------------------------------------------------
// Entitlement recompute (idempotent)
// ---------------------------------------------------------------------------

/** Statuses a recompute may overwrite. Approved/scheduled/paid/void are frozen. */
const REFRESHABLE = new Set(["accruing", "payable"]);

export interface RecomputeResult {
  contractorId: string;
  created: number;
  updated: number;
  frozen: number;
  entitlementIds: string[];
}

/**
 * Recompute all margin-share entitlements for one NEP plan lineage.
 * Candidate engagements: engagements at accounts the NEP originated, plus
 * engagements flagged with the NEP's material contribution. One entitlement
 * row per engagement (unique org+contractor+engagement); frozen rows
 * (approved and beyond) are never touched.
 */
export async function recomputeNepEntitlements(args: {
  orgId: string;
  contractorId: string;
}): Promise<RecomputeResult> {
  const { orgId, contractorId } = args;
  const plans = await loadPlansForContractor(orgId, contractorId);
  if (plans.length === 0) return { contractorId, created: 0, updated: 0, frozen: 0, entitlementIds: [] };
  const lineageStatus = plans[0].status;
  const nepUserId = plans.find((p) => p.userId)?.userId ?? null;

  // Candidate engagements.
  const ownedAccounts = nepUserId
    ? await db.select().from(atelierAccounts).where(and(
        eq(atelierAccounts.orgId, orgId),
        eq(atelierAccounts.originatedByUserId, nepUserId),
        isNull(atelierAccounts.deletedAt),
      ))
    : [];
  const accountById = new Map(ownedAccounts.map((a) => [a.id, a]));
  const engConds = [eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt)];
  const allEngs = await db.select().from(atelierEngagements).where(and(...engConds));
  const candidates = allEngs.filter(
    (e) => accountById.has(e.accountId) || (nepUserId && e.materialContributionUserId === nepUserId),
  );

  // Window anchor per account: explicit override, else earliest engagement start.
  const firstEngagementAt = (accountId: string): string | null => {
    const acct = accountById.get(accountId);
    if (acct?.originationFirstEngagementAt) return acct.originationFirstEngagementAt;
    const starts = allEngs.filter((e) => e.accountId === accountId).map((e) => e.startDate).sort();
    return starts[0] ?? null;
  };

  const existing = await db
    .select()
    .from(atelierNepEntitlements)
    .where(and(
      eq(atelierNepEntitlements.orgId, orgId),
      eq(atelierNepEntitlements.contractorId, contractorId),
      isNull(atelierNepEntitlements.deletedAt),
    ));
  const existingByEng = new Map(existing.map((e) => [e.engagementId, e]));

  let created = 0;
  let updated = 0;
  let frozen = 0;
  const ids: string[] = [];

  for (const eng of candidates) {
    const prior = existingByEng.get(eng.id) ?? null;
    if (prior && !REFRESHABLE.has(prior.status)) {
      frozen += 1;
      ids.push(prior.id);
      continue;
    }
    // On conversion / end, new engagements stop accruing; existing rows
    // keep refreshing (run-off of engagements signed pre-conversion).
    if (lineageStatus !== "pre_conversion" && !prior) continue;

    const plan = pickEffectivePlan(plans, eng.startDate);
    if (!plan) continue;
    const acct = accountById.get(eng.accountId) ?? null;
    const originated = Boolean(acct);
    const materialContribution = Boolean(nepUserId && eng.materialContributionUserId === nepUserId);
    const econ = await computeEngagementEconomics(orgId, eng.id, nepUserId);
    const tier = selectTier({
      originated,
      materialContribution,
      firstEngagementAt: acct ? firstEngagementAt(acct.id) : null,
      engagementSignedAt: eng.startDate,
      windowMonths: plan.originationWindowMonths,
      saleTierPct: plan.marginSharePctSale,
      originationOnlyPct: plan.marginSharePctOriginationOnly,
    });
    const projectProfitUsd = computeProjectProfit(econ.feesCollectedUsd, econ.directCostsUsd);
    const amountUsd = computeMarginShare(projectProfitUsd, tier.pct);

    const clientAcceptedAt = prior?.clientAcceptedAt ?? null;
    const dueDate = computeDueDate(econ.fullyCollected ? econ.collectedAt : null, clientAcceptedAt);
    const status = econ.fullyCollected && clientAcceptedAt && tier.tier !== "none" ? "payable" : "accruing";

    const lines: NepEntitlementStatementLine[] = [
      { kind: "fees_invoiced", label: "Fees invoiced", amountUsd: econ.feesInvoicedUsd },
      { kind: "fees_collected", label: "Fees collected", amountUsd: econ.feesCollectedUsd },
      { kind: "cost_contractor_labour", label: "Delivery labour (other contractors)", amountUsd: -econ.contractorLabourUsd },
      { kind: "cost_own_time_charges", label: "Own time charges (deducted per Clause 6.5)", amountUsd: -econ.ownTimeChargesUsd },
      { kind: "cost_partner_firm", label: "Partner-firm delivery costs", amountUsd: -econ.partnerFirmUsd },
      { kind: "cost_expenses", label: "Pre-approved delivery expenses", amountUsd: -econ.expensesUsd },
      { kind: "project_profit", label: "Project Profit", amountUsd: projectProfitUsd },
      { kind: "margin_share", label: `Margin share @ ${tier.pct}%`, amountUsd },
    ];
    const statement: NepEntitlementStatement = {
      lines,
      tier: tier.tier,
      tierPct: tier.pct,
      tierReason: tier.reason,
      window: {
        firstEngagementAt: acct ? firstEngagementAt(acct.id) : null,
        engagementSignedAt: eng.startDate,
        windowMonths: plan.originationWindowMonths,
        insideWindow: tier.insideWindow,
      },
      flags: {
        originated,
        materialContribution,
        fullyCollected: econ.fullyCollected,
        clientAccepted: Boolean(clientAcceptedAt),
      },
    };

    const values = {
      userId: nepUserId,
      planId: plan.id,
      engagementName: eng.name,
      accountId: eng.accountId,
      accountName: acct?.name ?? null,
      tier: tier.tier,
      tierPct: tier.pct,
      feesInvoicedUsd: econ.feesInvoicedUsd,
      feesCollectedUsd: econ.feesCollectedUsd,
      directCostsUsd: econ.directCostsUsd,
      ownTimeChargesUsd: econ.ownTimeChargesUsd,
      projectProfitUsd,
      amountUsd,
      statement,
      fullyCollected: econ.fullyCollected,
      collectedAt: econ.collectedAt,
      dueDate,
      status,
      updatedAt: new Date(),
    };
    if (prior) {
      await db.update(atelierNepEntitlements).set(values).where(eq(atelierNepEntitlements.id, prior.id));
      updated += 1;
      ids.push(prior.id);
    } else {
      const id = rid("nepent");
      await db.insert(atelierNepEntitlements).values({
        id,
        orgId,
        contractorId,
        engagementId: eng.id,
        ...values,
      });
      created += 1;
      ids.push(id);
    }
  }
  return { contractorId, created, updated, frozen, entitlementIds: ids };
}

// ---------------------------------------------------------------------------
// Conversion tracker
// ---------------------------------------------------------------------------

export interface ConversionProgress {
  windowStart: string;
  windowEnd: string;
  attributableRevenueUsd: number;
  revenueThresholdUsd: number;
  revenueMet: boolean;
  realisedMarginPct: number | null;
  marginThresholdPct: number;
  marginMet: boolean;
  bothMet: boolean;
  engagementsCounted: number;
}

/**
 * Rolling 12-month attributable revenue (collected fees on attributable
 * engagements, by collection date) + realised delivered gross margin
 * (aggregate Project Profit / aggregate collected fees across the NEP's
 * fully-collected engagements, all-time as Schedule D measures delivered
 * & accepted work).
 */
export async function computeConversionProgress(args: {
  orgId: string;
  contractorId: string;
  asOf?: Date;
}): Promise<ConversionProgress | null> {
  const { orgId, contractorId } = args;
  const asOf = args.asOf ?? new Date();
  const plans = await loadPlansForContractor(orgId, contractorId);
  const plan = pickEffectivePlan(plans, asOf.toISOString().slice(0, 10));
  if (!plan) return null;
  const windowStart = new Date(asOf.getTime());
  windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 1);

  const ents = await db
    .select()
    .from(atelierNepEntitlements)
    .where(and(
      eq(atelierNepEntitlements.orgId, orgId),
      eq(atelierNepEntitlements.contractorId, contractorId),
      isNull(atelierNepEntitlements.deletedAt),
    ));
  const attributable = ents.filter((e) => e.tier !== "none" && e.status !== "void");
  let rolling = 0;
  let aggFees = 0;
  let aggProfit = 0;
  let counted = 0;
  for (const e of attributable) {
    if (e.collectedAt && e.collectedAt.getTime() >= windowStart.getTime() && e.collectedAt.getTime() <= asOf.getTime()) {
      rolling += e.feesCollectedUsd;
    }
    if (e.fullyCollected && e.clientAcceptedAt) {
      aggFees += e.feesCollectedUsd;
      aggProfit += e.projectProfitUsd;
      counted += 1;
    }
  }
  const realisedMarginPct = aggFees > 0 ? r2((aggProfit / aggFees) * 100) : null;
  const revenueMet = rolling >= plan.conversionRevenueThresholdUsd;
  const marginMet = realisedMarginPct != null && realisedMarginPct >= plan.conversionMarginThresholdPct;
  return {
    windowStart: windowStart.toISOString().slice(0, 10),
    windowEnd: asOf.toISOString().slice(0, 10),
    attributableRevenueUsd: r2(rolling),
    revenueThresholdUsd: plan.conversionRevenueThresholdUsd,
    revenueMet,
    realisedMarginPct,
    marginThresholdPct: plan.conversionMarginThresholdPct,
    marginMet,
    bothMet: revenueMet && marginMet,
    engagementsCounted: counted,
  };
}

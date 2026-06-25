/**
 * Atelier — Account 360 rollup (Task #570).
 *
 * Read-only account-level rollup of EXISTING engagement / invoice /
 * opportunity data. Nothing here mutates state or calls an AI agent — it
 * aggregates the persisted engagement P&L (budget + cost-to-date), the
 * account's invoices (AR), and the opportunity pipeline into:
 *
 *   - a financial rollup (recognised revenue-to-date, contract / active-
 *     engagement value, open + weighted pipeline, billed / collected, AR
 *     outstanding + aging),
 *   - a composite account-health score (relationship + financial +
 *     engagement + risk signals) with an explainable factor breakdown,
 *   - a readable relationship-history timeline (engagements over time,
 *     deals won/lost, curated key audit milestones),
 *   - renewal / expansion opportunities + deterministic next-best-actions
 *     (reusing the existing action queue where present).
 *
 * Per-engagement Financials screens (engagementFinancialsRoutes) remain
 * the source of truth and are unchanged; this only reads the same tables.
 */

import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import {
  isOpenStage,
  isWonStage,
  isLostStage,
  resolveSalesStage,
} from "./atelier-agents/pipeline.js";
import {
  db,
  atelierAccounts,
  atelierEngagementBudget,
  atelierEngagementCostToDate,
  atelierInvoice,
  atelierOpportunities,
  atelierEngagements,
  atelierRaidItems,
  atelierPaneAItems,
  atelierAuditEvents,
} from "@workspace/db";

type Engagement = typeof atelierEngagements.$inferSelect;
type Opportunity = typeof atelierOpportunities.$inferSelect;

// Engagement stages that represent a closed engagement.
const CLOSED_ENG_STAGES = new Set(["closed", "won", "lost"]);

// Opportunity open/won/lost are derived from the canonical salesStage
// (Task #654 — plmStage retired). "Won" = reached contract; terminals are
// lost · no_decision · withdrawn.
function isOpenOpp(o: Opportunity): boolean {
  return isOpenStage(resolveSalesStage(o.salesStage));
}
function isWonOpp(o: Opportunity): boolean {
  return isWonStage(resolveSalesStage(o.salesStage));
}
function isLostOpp(o: Opportunity): boolean {
  return isLostStage(resolveSalesStage(o.salesStage));
}
function isActiveEng(e: Engagement): boolean {
  return !CLOSED_ENG_STAGES.has((e.plmStage as string) ?? "");
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);

// ============================================================
// FINANCIAL ROLLUP
// ============================================================

export interface AccountFinancials {
  contractValueUsd: number;
  activeEngagementValueUsd: number;
  recognisedRevenueUsd: number;
  billedUsd: number;
  collectedUsd: number;
  costToDateUsd: number;
  grossMarginPct: number; // (recognised - cost) / recognised, 0 when no revenue
  openPipelineUsd: number;
  weightedPipelineUsd: number;
  arOutstandingUsd: number;
  arOverdueUsd: number;
  aging: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    d90plus: number;
  };
  invoiceCount: number;
  overdueInvoiceCount: number;
  engagementCount: number;
  activeEngagementCount: number;
  openOpportunityCount: number;
}

export async function computeAccountFinancials(args: {
  orgId: string;
  accountId: string;
  engagements: Engagement[];
  opportunities: Opportunity[];
}): Promise<AccountFinancials> {
  const { orgId, accountId, engagements, opportunities } = args;
  const engIds = engagements.map((e) => e.id);
  const activeEngIds = new Set(engagements.filter(isActiveEng).map((e) => e.id));

  const [budgets, costs, invoices] = await Promise.all([
    engIds.length
      ? db
          .select()
          .from(atelierEngagementBudget)
          .where(
            and(
              inArray(atelierEngagementBudget.engagementId, engIds),
              eq(atelierEngagementBudget.orgId, orgId),
            ),
          )
      : Promise.resolve([]),
    engIds.length
      ? db
          .select()
          .from(atelierEngagementCostToDate)
          .where(
            and(
              inArray(atelierEngagementCostToDate.engagementId, engIds),
              eq(atelierEngagementCostToDate.orgId, orgId),
            ),
          )
      : Promise.resolve([]),
    db
      .select()
      .from(atelierInvoice)
      .where(
        and(
          eq(atelierInvoice.accountId, accountId),
          eq(atelierInvoice.orgId, orgId),
          isNull(atelierInvoice.deletedAt),
        ),
      ),
  ]);

  let contractValueUsd = 0;
  let activeEngagementValueUsd = 0;
  for (const b of budgets) {
    contractValueUsd += b.contractValueUsd ?? 0;
    if (activeEngIds.has(b.engagementId)) {
      activeEngagementValueUsd += b.contractValueUsd ?? 0;
    }
  }

  let recognisedRevenueUsd = 0;
  let billedUsd = 0;
  let collectedUsd = 0;
  let costToDateUsd = 0;
  for (const c of costs) {
    recognisedRevenueUsd += c.revenueRecognisedToDateUsd ?? 0;
    billedUsd += c.invoicedToDateUsd ?? 0;
    collectedUsd += c.cashCollectedToDateUsd ?? 0;
    costToDateUsd += c.costToDateUsd ?? 0;
  }
  const grossMarginPct =
    recognisedRevenueUsd > 0
      ? (recognisedRevenueUsd - costToDateUsd) / recognisedRevenueUsd
      : 0;

  // Pipeline from open opportunities.
  let openPipelineUsd = 0;
  let weightedPipelineUsd = 0;
  let openOpportunityCount = 0;
  for (const o of opportunities) {
    if (!isOpenOpp(o)) continue;
    openOpportunityCount += 1;
    const size = Number(o.dealSizeHypothesis ?? 0);
    openPipelineUsd += size;
    weightedPipelineUsd += size * (Number(o.probabilityPct ?? 0) / 100);
  }

  // AR aging on outstanding balances (issued / partial / paid, not draft/void).
  const today = new Date().toISOString().slice(0, 10);
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  let arOutstandingUsd = 0;
  let arOverdueUsd = 0;
  let overdueInvoiceCount = 0;
  // Count only invoices that contribute to outstanding AR (non-draft/void with
  // a positive balance) so the "N invoices" sublabel reconciles with the
  // Outstanding AR figure it sits under, rather than all persisted invoices.
  let openInvoiceCount = 0;
  for (const i of invoices) {
    if (i.status === "void" || i.status === "draft") continue;
    const outstanding = Math.max(0, (i.total ?? 0) - (i.amountPaid ?? 0));
    if (outstanding <= 0) continue;
    openInvoiceCount += 1;
    arOutstandingUsd += outstanding;
    const days = i.dueDate
      ? Math.floor(
          (Date.now() - new Date(i.dueDate).getTime()) / (24 * 3600 * 1000),
        )
      : 0;
    if (i.dueDate && i.dueDate < today) {
      arOverdueUsd += outstanding;
      overdueInvoiceCount += 1;
    }
    if (days <= 0) aging.current += outstanding;
    else if (days <= 30) aging.d30 += outstanding;
    else if (days <= 60) aging.d60 += outstanding;
    else if (days <= 90) aging.d90 += outstanding;
    else aging.d90plus += outstanding;
  }

  return {
    contractValueUsd: round(contractValueUsd),
    activeEngagementValueUsd: round(activeEngagementValueUsd),
    recognisedRevenueUsd: round(recognisedRevenueUsd),
    billedUsd: round(billedUsd),
    collectedUsd: round(collectedUsd),
    costToDateUsd: round(costToDateUsd),
    grossMarginPct,
    openPipelineUsd: round(openPipelineUsd),
    weightedPipelineUsd: round(weightedPipelineUsd),
    arOutstandingUsd: round(arOutstandingUsd),
    arOverdueUsd: round(arOverdueUsd),
    aging: {
      current: round(aging.current),
      d30: round(aging.d30),
      d60: round(aging.d60),
      d90: round(aging.d90),
      d90plus: round(aging.d90plus),
    },
    invoiceCount: openInvoiceCount,
    overdueInvoiceCount,
    engagementCount: engagements.length,
    activeEngagementCount: activeEngIds.size,
    openOpportunityCount,
  };
}

// ============================================================
// COMPOSITE HEALTH
// ============================================================

export type HealthBand = "green" | "amber" | "red";

export interface HealthFactor {
  key: "relationship" | "financial" | "engagement" | "risk";
  label: string;
  score: number; // 0–100
  weight: number; // 0–1
  detail: string;
}

export interface AccountHealth {
  score: number; // 0–100 composite
  band: HealthBand;
  factors: HealthFactor[];
}

export interface OpenRiskCounts {
  red: number;
  amber: number;
}

const fmtUsd0 = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(round(n)).toLocaleString()}`;

function bandFor(score: number): HealthBand {
  if (score >= 70) return "green";
  if (score >= 45) return "amber";
  return "red";
}

export function computeAccountHealth(args: {
  relationshipStrength: number; // 0–100
  financials: AccountFinancials;
  openRisks: OpenRiskCounts;
}): AccountHealth {
  const { relationshipStrength, financials: f, openRisks } = args;

  // Relationship signal — directly the account's relationship strength.
  const relScore = clamp(relationshipStrength);
  const relFactor: HealthFactor = {
    key: "relationship",
    label: "Relationship strength",
    score: round(relScore),
    weight: 0.3,
    detail: `${round(relScore)}/100 relationship strength`,
  };

  // Financial signal — margin health blended with AR-overdue exposure.
  const marginScore =
    f.recognisedRevenueUsd > 0 ? clamp((f.grossMarginPct / 0.4) * 100) : 60;
  const overdueRatio =
    f.arOutstandingUsd > 0 ? f.arOverdueUsd / f.arOutstandingUsd : 0;
  const arScore = clamp(100 - overdueRatio * 100);
  const finScore = clamp(0.6 * marginScore + 0.4 * arScore);
  const finFactor: HealthFactor = {
    key: "financial",
    label: "Financial health",
    score: round(finScore),
    weight: 0.3,
    detail:
      f.recognisedRevenueUsd > 0
        ? `${(f.grossMarginPct * 100).toFixed(0)}% margin · ${fmtUsd0(f.arOverdueUsd)} overdue AR`
        : f.arOverdueUsd > 0
          ? `${fmtUsd0(f.arOverdueUsd)} overdue AR`
          : "No recognised revenue yet",
  };

  // Engagement signal — is there live delivery work running?
  const engScore =
    f.activeEngagementCount > 0
      ? 85
      : f.engagementCount > 0
        ? 50
        : f.openOpportunityCount > 0
          ? 45
          : 30;
  const engFactor: HealthFactor = {
    key: "engagement",
    label: "Engagement activity",
    score: engScore,
    weight: 0.2,
    detail:
      f.activeEngagementCount > 0
        ? `${f.activeEngagementCount} active engagement${f.activeEngagementCount === 1 ? "" : "s"}`
        : f.engagementCount > 0
          ? "No active engagements (past delivery only)"
          : f.openOpportunityCount > 0
            ? "Pipeline only — no engagements yet"
            : "No engagements or pipeline",
  };

  // Risk signal — open red / amber RAID items across the account.
  const riskScore = clamp(100 - openRisks.red * 20 - openRisks.amber * 8);
  const riskFactor: HealthFactor = {
    key: "risk",
    label: "Open risks",
    score: round(riskScore),
    weight: 0.2,
    detail:
      openRisks.red + openRisks.amber > 0
        ? `${openRisks.red} red · ${openRisks.amber} amber open RAID`
        : "No open red/amber risks",
  };

  const factors = [relFactor, finFactor, engFactor, riskFactor];
  const score = round(factors.reduce((s, x) => s + x.score * x.weight, 0));
  return { score, band: bandFor(score), factors };
}

// ============================================================
// RELATIONSHIP-HISTORY TIMELINE
// ============================================================

export interface TimelineItem {
  id: string;
  date: string; // ISO
  kind: "engagement" | "deal" | "milestone";
  title: string;
  detail: string | null;
  tone: "default" | "gold" | "green" | "amber" | "red";
  refKind: "engagement" | "opportunity" | "account" | null;
  refId: string | null;
}

// Curated key-milestone actions worth surfacing from the audit trail.
// Matched as case-insensitive substrings against the audit `action`.
const KEY_AUDIT_ACTIONS = [
  "account.created",
  "fully_executed",
  "contract.execute",
  "charter.approve",
  "kickoff",
  "renewed",
  "go_no_go",
];

function matchesKeyAction(action: string): boolean {
  const a = action.toLowerCase();
  return KEY_AUDIT_ACTIONS.some((k) => a.includes(k));
}

export async function buildRelationshipTimeline(args: {
  orgId: string;
  accountId: string;
  engagements: Engagement[];
  opportunities: Opportunity[];
  limit?: number;
}): Promise<TimelineItem[]> {
  const { orgId, accountId, engagements, opportunities } = args;
  const limit = args.limit ?? 60;
  const items: TimelineItem[] = [];

  for (const e of engagements) {
    if (e.startDate) {
      items.push({
        id: `eng_start_${e.id}`,
        date: new Date(e.startDate).toISOString(),
        kind: "engagement",
        title: `Engagement started · ${e.name}`,
        detail: null,
        tone: "default",
        refKind: "engagement",
        refId: e.id,
      });
    }
    if (CLOSED_ENG_STAGES.has((e.plmStage as string) ?? "")) {
      items.push({
        id: `eng_close_${e.id}`,
        date: new Date(e.updatedAt).toISOString(),
        kind: "engagement",
        title: `Engagement closed · ${e.name}`,
        detail: null,
        tone: "default",
        refKind: "engagement",
        refId: e.id,
      });
    }
  }

  for (const o of opportunities) {
    if (isWonOpp(o)) {
      items.push({
        id: `opp_won_${o.id}`,
        date: new Date(o.updatedAt).toISOString(),
        kind: "deal",
        title: `Deal won · ${o.name}`,
        detail: `${fmtUsd0(Number(o.dealSizeHypothesis ?? 0))} deal value`,
        tone: "green",
        refKind: "opportunity",
        refId: o.id,
      });
    } else if (isLostOpp(o)) {
      items.push({
        id: `opp_lost_${o.id}`,
        date: new Date(o.updatedAt).toISOString(),
        kind: "deal",
        title: `Deal lost · ${o.name}`,
        detail: `${fmtUsd0(Number(o.dealSizeHypothesis ?? 0))} deal value`,
        tone: "red",
        refKind: "opportunity",
        refId: o.id,
      });
    }
  }

  // Key audit milestones across the account + its engagements / opportunities.
  const entityIds = [
    accountId,
    ...engagements.map((e) => e.id),
    ...opportunities.map((o) => o.id),
  ];
  const auditRows = entityIds.length
    ? await db
        .select()
        .from(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.orgId, orgId),
            inArray(atelierAuditEvents.entityId, entityIds),
          ),
        )
        .orderBy(desc(atelierAuditEvents.createdAt))
        .limit(200)
    : [];
  for (const ev of auditRows) {
    if (!matchesKeyAction(ev.action)) continue;
    const refKind: TimelineItem["refKind"] =
      ev.entityType === "engagement"
        ? "engagement"
        : ev.entityType === "opportunity"
          ? "opportunity"
          : ev.entityType === "account"
            ? "account"
            : null;
    items.push({
      id: `aud_${ev.id}`,
      date: new Date(ev.createdAt).toISOString(),
      kind: "milestone",
      title: ev.payloadSummary || ev.action.replace(/[._]/g, " "),
      detail: null,
      tone: "gold",
      refKind,
      refId: refKind ? ev.entityId : null,
    });
  }

  items.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  return items.slice(0, limit);
}

// ============================================================
// RENEWALS / EXPANSIONS + NEXT-BEST-ACTIONS
// ============================================================

export interface RenewalOpportunity {
  id: string;
  kind: "renewal" | "expansion";
  title: string;
  detail: string | null;
  valueUsd: number;
  dueDate: string | null;
  refKind: "engagement" | "opportunity";
  refId: string;
}

export interface NextBestAction {
  id: string;
  label: string;
  detail: string | null;
  priority: "high" | "medium" | "low";
  source: "derived" | "action_queue";
  refKind: "engagement" | "opportunity" | "account" | null;
  refId: string | null;
}

const RENEWAL_WINDOW_DAYS = 120;

export async function buildRenewalsAndActions(args: {
  orgId: string;
  accountId: string;
  relationshipStrength: number;
  financials: AccountFinancials;
  engagements: Engagement[];
  opportunities: Opportunity[];
  openRisks: OpenRiskCounts;
}): Promise<{ renewals: RenewalOpportunity[]; nextBestActions: NextBestAction[] }> {
  const {
    orgId,
    accountId,
    relationshipStrength,
    financials: f,
    engagements,
    opportunities,
    openRisks,
  } = args;

  const renewals: RenewalOpportunity[] = [];
  const now = Date.now();
  const windowMs = RENEWAL_WINDOW_DAYS * 24 * 3600 * 1000;

  // Renewals — active engagements ending within the renewal window with no
  // open expansion opportunity already in flight against them.
  const openOppEngLinks = new Set(
    opportunities.filter(isOpenOpp).map((o) => o.id),
  );
  for (const e of engagements) {
    if (!isActiveEng(e)) continue;
    if (!e.plannedEndDate) continue;
    const end = new Date(e.plannedEndDate).getTime();
    if (Number.isNaN(end)) continue;
    if (end - now > windowMs) continue;
    // Skip if a still-open opportunity is linked to this engagement.
    if (e.opportunityId && openOppEngLinks.has(e.opportunityId)) continue;
    const daysOut = Math.round((end - now) / (24 * 3600 * 1000));
    renewals.push({
      id: `renewal_${e.id}`,
      kind: "renewal",
      title: `Renewal · ${e.name}`,
      detail:
        daysOut >= 0
          ? `Ends in ${daysOut} day${daysOut === 1 ? "" : "s"}`
          : `Ended ${Math.abs(daysOut)} day${daysOut === -1 ? "" : "s"} ago`,
      valueUsd: 0,
      dueDate: e.plannedEndDate,
      refKind: "engagement",
      refId: e.id,
    });
  }

  // Expansions — open opportunities are expansion potential on the account.
  for (const o of opportunities) {
    if (!isOpenOpp(o)) continue;
    renewals.push({
      id: `expansion_${o.id}`,
      kind: "expansion",
      title: `Expansion · ${o.name}`,
      detail: o.nextMilestone
        ? `Next: ${o.nextMilestone}`
        : `${resolveSalesStage(o.salesStage)} stage`,
      valueUsd: round(Number(o.dealSizeHypothesis ?? 0)),
      dueDate: o.nextMilestoneDate ?? null,
      refKind: "opportunity",
      refId: o.id,
    });
  }

  // -------- next-best-actions (deterministic, from signals) --------
  const nextBestActions: NextBestAction[] = [];

  if (f.arOverdueUsd > 0) {
    nextBestActions.push({
      id: "nba_ar",
      label: "Chase overdue receivables",
      detail: `${fmtUsd0(f.arOverdueUsd)} overdue across ${f.overdueInvoiceCount} invoice${f.overdueInvoiceCount === 1 ? "" : "s"}`,
      priority: "high",
      source: "derived",
      refKind: "account",
      refId: accountId,
    });
  }
  if (openRisks.red > 0) {
    nextBestActions.push({
      id: "nba_risk",
      label: "Resolve open red risks",
      detail: `${openRisks.red} red RAID item${openRisks.red === 1 ? "" : "s"} need attention`,
      priority: "high",
      source: "derived",
      refKind: "account",
      refId: accountId,
    });
  }
  const renewalsDue = renewals.filter((r) => r.kind === "renewal");
  if (renewalsDue.length > 0) {
    nextBestActions.push({
      id: "nba_renewal",
      label: "Initiate renewal conversations",
      detail: `${renewalsDue.length} engagement${renewalsDue.length === 1 ? "" : "s"} ending within ${RENEWAL_WINDOW_DAYS} days`,
      priority: "medium",
      source: "derived",
      refKind: renewalsDue[0]?.refKind ?? null,
      refId: renewalsDue[0]?.refId ?? null,
    });
  }
  if (relationshipStrength < 40) {
    nextBestActions.push({
      id: "nba_relationship",
      label: "Strengthen the relationship",
      detail: `Relationship strength is ${round(relationshipStrength)}/100 — schedule an executive touchpoint`,
      priority: "medium",
      source: "derived",
      refKind: "account",
      refId: accountId,
    });
  }
  if (f.activeEngagementCount === 0 && f.openOpportunityCount === 0) {
    nextBestActions.push({
      id: "nba_reengage",
      label: "Re-engage dormant account",
      detail: "No active engagements or open pipeline",
      priority: "medium",
      source: "derived",
      refKind: "account",
      refId: accountId,
    });
  }

  // Reuse the existing action queue (atelier_pane_a_items) where the item
  // targets this account, one of its engagements, or one of its opps.
  const targetIds = [
    accountId,
    ...engagements.map((e) => e.id),
    ...opportunities.map((o) => o.id),
  ];
  const paneRows = targetIds.length
    ? await db
        .select()
        .from(atelierPaneAItems)
        .where(
          and(
            eq(atelierPaneAItems.orgId, orgId),
            inArray(atelierPaneAItems.hrefTargetId, targetIds),
            isNull(atelierPaneAItems.resolvedAt),
            isNull(atelierPaneAItems.deletedAt),
          ),
        )
        .orderBy(desc(atelierPaneAItems.sortKey))
        .limit(20)
    : [];
  const engIdSet = new Set(engagements.map((e) => e.id));
  const oppIdSet = new Set(opportunities.map((o) => o.id));
  const seenPaneTitles = new Set<string>();
  for (const p of paneRows) {
    if (seenPaneTitles.has(p.title)) continue;
    seenPaneTitles.add(p.title);
    const refKind: NextBestAction["refKind"] = engIdSet.has(p.hrefTargetId)
      ? "engagement"
      : oppIdSet.has(p.hrefTargetId)
        ? "opportunity"
        : p.hrefTargetId === accountId
          ? "account"
          : null;
    nextBestActions.push({
      id: `nba_queue_${p.id}`,
      label: p.title,
      detail: p.summary,
      priority:
        p.priority === "high"
          ? "high"
          : p.priority === "low"
            ? "low"
            : "medium",
      source: "action_queue",
      refKind,
      refId: refKind ? p.hrefTargetId : null,
    });
  }

  // Sort renewals: renewals (by soonest end) first, then expansions by value.
  renewals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "renewal" ? -1 : 1;
    if (a.kind === "renewal") {
      return (a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1;
    }
    return b.valueUsd - a.valueUsd;
  });
  // Sort actions by priority.
  const prio = { high: 0, medium: 1, low: 2 } as const;
  nextBestActions.sort((a, b) => prio[a.priority] - prio[b.priority]);

  return { renewals, nextBestActions };
}

// ============================================================
// OPEN RISK COUNTS (shared helper)
// ============================================================

export async function countOpenRisks(args: {
  orgId: string;
  engagementIds: string[];
}): Promise<OpenRiskCounts> {
  const { orgId, engagementIds } = args;
  if (engagementIds.length === 0) return { red: 0, amber: 0 };
  const rows = await db
    .select({
      severity: atelierRaidItems.severity,
      status: atelierRaidItems.status,
    })
    .from(atelierRaidItems)
    .where(
      and(
        inArray(atelierRaidItems.engagementId, engagementIds),
        eq(atelierRaidItems.orgId, orgId),
        isNull(atelierRaidItems.deletedAt),
      ),
    );
  let red = 0;
  let amber = 0;
  for (const r of rows) {
    if (r.status === "closed" || r.status === "mitigated") continue;
    if (r.severity === "red") red += 1;
    else if (r.severity === "amber") amber += 1;
  }
  return { red, amber };
}

// ============================================================
// HIERARCHY ROLL-UP (Task #632)
// ============================================================

/**
 * Aggregated view across an account and every subsidiary beneath it. Counts
 * (account/subsidiary/opportunity) are always populated. The monetary figures
 * (`openPipelineUsd`, `totalRevenueUsd`) and the composite `health` honour the
 * account-financials gate: they are `null` (with `financialsRedacted: true`)
 * for personas without account-wide financial authority.
 */
export interface AccountHierarchyRollup {
  accountCount: number; // family size incl. the root account
  subsidiaryCount: number; // descendants only
  openOpportunityCount: number;
  openPipelineUsd: number | null;
  totalRevenueUsd: number | null; // recognised revenue-to-date across the family
  health: AccountHealth | null; // composite over the combined book of business
  financialsRedacted: boolean;
}

function emptyFinancials(): AccountFinancials {
  return {
    contractValueUsd: 0,
    activeEngagementValueUsd: 0,
    recognisedRevenueUsd: 0,
    billedUsd: 0,
    collectedUsd: 0,
    costToDateUsd: 0,
    grossMarginPct: 0,
    openPipelineUsd: 0,
    weightedPipelineUsd: 0,
    arOutstandingUsd: 0,
    arOverdueUsd: 0,
    aging: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
    invoiceCount: 0,
    overdueInvoiceCount: 0,
    engagementCount: 0,
    activeEngagementCount: 0,
    openOpportunityCount: 0,
  };
}

function sumFinancials(list: AccountFinancials[]): AccountFinancials {
  const agg = emptyFinancials();
  for (const f of list) {
    agg.contractValueUsd += f.contractValueUsd;
    agg.activeEngagementValueUsd += f.activeEngagementValueUsd;
    agg.recognisedRevenueUsd += f.recognisedRevenueUsd;
    agg.billedUsd += f.billedUsd;
    agg.collectedUsd += f.collectedUsd;
    agg.costToDateUsd += f.costToDateUsd;
    agg.openPipelineUsd += f.openPipelineUsd;
    agg.weightedPipelineUsd += f.weightedPipelineUsd;
    agg.arOutstandingUsd += f.arOutstandingUsd;
    agg.arOverdueUsd += f.arOverdueUsd;
    agg.aging.current += f.aging.current;
    agg.aging.d30 += f.aging.d30;
    agg.aging.d60 += f.aging.d60;
    agg.aging.d90 += f.aging.d90;
    agg.aging.d90plus += f.aging.d90plus;
    agg.invoiceCount += f.invoiceCount;
    agg.overdueInvoiceCount += f.overdueInvoiceCount;
    agg.engagementCount += f.engagementCount;
    agg.activeEngagementCount += f.activeEngagementCount;
    agg.openOpportunityCount += f.openOpportunityCount;
  }
  agg.grossMarginPct =
    agg.recognisedRevenueUsd > 0
      ? (agg.recognisedRevenueUsd - agg.costToDateUsd) / agg.recognisedRevenueUsd
      : 0;
  return agg;
}

/**
 * Walk `parentAccountId` edges downward from `rootAccountId` to collect the
 * account itself plus every descendant subsidiary, org-scoped and excluding
 * soft-deleted rows. A visited-set guards against accidental cycles in the
 * (DB-unenforced) reporting graph.
 */
async function collectAccountFamily(
  orgId: string,
  rootAccountId: string,
): Promise<string[]> {
  const visited = new Set<string>([rootAccountId]);
  let frontier = [rootAccountId];
  while (frontier.length > 0) {
    const rows = await db
      .select({ id: atelierAccounts.id })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.orgId, orgId),
          inArray(atelierAccounts.parentAccountId, frontier),
          isNull(atelierAccounts.deletedAt),
        ),
      );
    const next: string[] = [];
    for (const r of rows) {
      if (!visited.has(r.id)) {
        visited.add(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return [...visited];
}

export async function computeAccountHierarchyRollup(args: {
  orgId: string;
  rootAccountId: string;
  canSeeFinancials: boolean;
}): Promise<AccountHierarchyRollup> {
  const { orgId, rootAccountId, canSeeFinancials } = args;

  const familyIds = await collectAccountFamily(orgId, rootAccountId);
  const subsidiaryCount = Math.max(0, familyIds.length - 1);

  const [accounts, engagements, opportunities] = await Promise.all([
    db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.orgId, orgId),
          inArray(atelierAccounts.id, familyIds),
          isNull(atelierAccounts.deletedAt),
        ),
      ),
    db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.orgId, orgId),
          inArray(atelierEngagements.accountId, familyIds),
          isNull(atelierEngagements.deletedAt),
        ),
      ),
    db
      .select()
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, orgId),
          inArray(atelierOpportunities.accountId, familyIds),
          isNull(atelierOpportunities.deletedAt),
        ),
      ),
  ]);

  const openOpportunityCount = opportunities.filter(isOpenOpp).length;

  if (!canSeeFinancials) {
    return {
      accountCount: familyIds.length,
      subsidiaryCount,
      openOpportunityCount,
      openPipelineUsd: null,
      totalRevenueUsd: null,
      health: null,
      financialsRedacted: true,
    };
  }

  const perAccount = await Promise.all(
    accounts.map((acc) =>
      computeAccountFinancials({
        orgId,
        accountId: acc.id,
        engagements: engagements.filter((e) => e.accountId === acc.id),
        opportunities: opportunities.filter((o) => o.accountId === acc.id),
      }),
    ),
  );
  const agg = sumFinancials(perAccount);

  const openRisks = await countOpenRisks({
    orgId,
    engagementIds: engagements.map((e) => e.id),
  });
  const avgRelationship =
    accounts.length > 0
      ? accounts.reduce(
          (s, a) => s + clamp(Number(a.relationshipStrength ?? 0)),
          0,
        ) / accounts.length
      : 0;
  const health = computeAccountHealth({
    relationshipStrength: avgRelationship,
    financials: agg,
    openRisks,
  });

  return {
    accountCount: familyIds.length,
    subsidiaryCount,
    openOpportunityCount,
    openPipelineUsd: agg.openPipelineUsd,
    totalRevenueUsd: agg.recognisedRevenueUsd,
    health,
    financialsRedacted: false,
  };
}

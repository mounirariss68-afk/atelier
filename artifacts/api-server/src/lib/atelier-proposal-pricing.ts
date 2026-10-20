/**
 * Deterministic pricing for the Proposal Composer.
 *
 * The Composer's `pricingModel` (revenue, cost, margin, wedge) used to be
 * whatever Sonnet wrote in its JSON. The firm already has a server-side
 * pricing engine (`atelier-pricing.ts`) and a rate card; this module turns
 * the proposal's team mix and duration into numbers through that engine and
 * hands them to the model to narrate. The model never sets the figures.
 */

import { db, atelierRateCards, atelierRateCardRows, atelierMarginPolicies } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  computePricing,
  classifyMarginGate,
  type MarginPolicy,
  type RateCardRowLite,
  type TeamMixEntry,
} from "./atelier-pricing.js";

export interface ProposalTeamMember {
  role: string;
  /** Allocation in percent of a full-time week (15 = 15 %). */
  alloc: number;
}

export interface ProposalPricingModel {
  totalRevenueUsd: number;
  totalCostUsd: number;
  /** Percent units (45 = 45 %), as the proposal UI renders it. */
  marginPct: number;
  verdict: "green" | "amber" | "red" | "partner_override_required";
  wedgeChart: { role: string; days: number; cost: number; revenue: number }[];
  basis: {
    source: "rate_card" | "fallback_rates";
    rateCardId: string | null;
    rateCardName: string | null;
    durationWeeks: number;
    targetMarginPct: number;
    /** Roles in the team mix that matched no rate-card band (priced at 0). */
    unmatchedRoles: string[];
  };
}

/** Map the free-text roles proposals use onto the six rate-card seniority bands. */
export function seniorityForRole(role: string): string {
  const r = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (r === "partner" || r === "founding_partner") return "Partner";
  if (r === "lead" || r === "principal" || r === "engagement_lead" || r === "project_lead") return "Principal";
  if (r === "sme" || r === "subject_matter_lead" || r === "subjectmatterlead" || r === "subject_matter_expert") {
    return "SubjectMatterLead";
  }
  if (r === "ai_engineer" || r === "aiengineer" || r === "engineer" || r === "developer" || r === "data_scientist") {
    return "AIEngineer";
  }
  if (r === "designer" || r === "ux" || r === "ux_designer") return "Designer";
  // consultant, analyst, associate, business_developer and anything else
  return "Analyst";
}

/** Used only when the tenant has no active rate card yet. */
const FALLBACK_ROWS: RateCardRowLite[] = [
  { seniority: "Partner", dayRateInternalCost: 2000, dayRateClientPrice: 6800, overheadPct: 0.35 },
  { seniority: "Principal", dayRateInternalCost: 1600, dayRateClientPrice: 5200, overheadPct: 0.35 },
  { seniority: "SubjectMatterLead", dayRateInternalCost: 1200, dayRateClientPrice: 3800, overheadPct: 0.35 },
  { seniority: "AIEngineer", dayRateInternalCost: 960, dayRateClientPrice: 3000, overheadPct: 0.35 },
  { seniority: "Designer", dayRateInternalCost: 760, dayRateClientPrice: 2360, overheadPct: 0.35 },
  { seniority: "Analyst", dayRateInternalCost: 560, dayRateClientPrice: 1800, overheadPct: 0.35 },
];

async function loadActiveRateCard(): Promise<{ id: string; name: string; rows: RateCardRowLite[] } | null> {
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(isNull(atelierRateCards.deletedAt), eq(atelierRateCards.status, "active")))
    .orderBy(desc(atelierRateCards.createdAt))
    .limit(1);
  if (!card) return null;
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.rateCardId, card.id), isNull(atelierRateCardRows.deletedAt)));
  if (rows.length === 0) return null;
  return {
    id: card.id,
    name: card.name,
    rows: rows.map((r) => ({
      seniority: r.seniority,
      dayRateInternalCost: r.dayRateInternalCost,
      dayRateClientPrice: r.dayRateClientPrice,
      overheadPct: r.overheadPct,
    })),
  };
}

async function loadMarginPolicy(targetMarginPct: number): Promise<MarginPolicy> {
  const [row] = await db
    .select()
    .from(atelierMarginPolicies)
    .where(and(isNull(atelierMarginPolicies.deletedAt), eq(atelierMarginPolicies.isDefault, true)))
    .limit(1);
  const target = targetMarginPct / 100;
  if (row) {
    // The proposal's own target wins over the firm default for the gate;
    // the amber/red bands come from policy.
    return {
      targetMarginPct: target,
      amberThresholdPct: Math.min(row.amberThresholdPct, target),
      redThresholdPct: Math.min(row.redThresholdPct, target),
      twoPartnerThresholdPct: row.twoPartnerThresholdPct,
    };
  }
  return {
    targetMarginPct: target,
    amberThresholdPct: Math.max(0, target - 0.05),
    redThresholdPct: Math.max(0, target - 0.1),
    twoPartnerThresholdPct: Math.max(0, target - 0.1),
  };
}

export async function computeProposalPricing(args: {
  teamProposed: ProposalTeamMember[];
  durationWeeks: number;
  targetMarginPct: number;
}): Promise<ProposalPricingModel> {
  const card = await loadActiveRateCard();
  const rows = card?.rows ?? FALLBACK_ROWS;
  const policy = await loadMarginPolicy(args.targetMarginPct);
  const durationWeeks = Math.max(0, Number(args.durationWeeks) || 0);

  const teamMix: TeamMixEntry[] = args.teamProposed.map((m) => ({
    role: m.role,
    seniority: seniorityForRole(m.role),
    ftePct: Math.max(0, Math.min(1, (Number(m.alloc) || 0) / 100)),
  }));

  const computed = computePricing({ teamMix, durationWeeks, rateCardRows: rows, policy });
  const gate = classifyMarginGate(computed.computedMarginPct, policy);

  const wedgeChart = computed.perRoleBreakdown.map((b) => ({
    role: b.role ?? b.seniority,
    days: Math.round(b.days * 10) / 10,
    cost: b.cost,
    revenue: b.price,
  }));

  return {
    totalRevenueUsd: computed.computedPriceUsd,
    totalCostUsd: computed.computedCostUsd,
    marginPct: Math.round(computed.computedMarginPct * 1000) / 10,
    verdict: gate.partnerOverrideRequired ? "partner_override_required" : gate.status,
    wedgeChart,
    basis: {
      source: card ? "rate_card" : "fallback_rates",
      rateCardId: card?.id ?? null,
      rateCardName: card?.name ?? null,
      durationWeeks,
      targetMarginPct: args.targetMarginPct,
      unmatchedRoles: computed.perRoleBreakdown.filter((b) => !b.matched).map((b) => b.role ?? b.seniority),
    },
  };
}

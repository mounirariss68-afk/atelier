/**
 * Canonical contractor cost-rate resolution.
 *
 * Every economics consumer must resolve against the work date, never the
 * current roster value.  NEP plans win by default; an engagement term may
 * explicitly opt in to overriding the NEP plan.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierContractors,
  atelierContractorEngagementRates,
  atelierNepCompPlans,
} from "@workspace/db";

export type ContractorRateSource = "nep_plan" | "engagement_term" | "roster" | "fallback";
export interface ResolvedContractorRate {
  dayRateAmount: number;
  currency: string;
  source: ContractorRateSource;
  planId?: string;
  termId?: string;
  agreementRef?: string | null;
  agreementVersionRef?: string | null;
  scope?: string[];
}

export async function resolveContractorRate(args: {
  orgId: string;
  contractorId: string;
  engagementId?: string | null;
  workDate: string;
  fallbackDayRate?: number;
}): Promise<ResolvedContractorRate> {
  const [contractor] = await db.select().from(atelierContractors).where(and(
    eq(atelierContractors.orgId, args.orgId),
    eq(atelierContractors.id, args.contractorId),
    isNull(atelierContractors.deletedAt),
  ));
  const roster: ResolvedContractorRate = {
    dayRateAmount: Number(contractor?.dayRateAmount ?? args.fallbackDayRate ?? 0),
    currency: contractor?.dayRateCurrency ?? "USD",
    source: contractor?.dayRateAmount ? "roster" : "fallback",
  };
  const terms = args.engagementId ? await db.select().from(atelierContractorEngagementRates).where(and(
    eq(atelierContractorEngagementRates.orgId, args.orgId),
    eq(atelierContractorEngagementRates.contractorId, args.contractorId),
    eq(atelierContractorEngagementRates.engagementId, args.engagementId),
    isNull(atelierContractorEngagementRates.deletedAt),
  )) : [];
  const term = terms.filter((r) =>
    r.effectiveFrom <= args.workDate && (!r.effectiveTo || args.workDate <= r.effectiveTo),
  ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const plans = await db.select().from(atelierNepCompPlans).where(and(
    eq(atelierNepCompPlans.orgId, args.orgId),
    eq(atelierNepCompPlans.contractorId, args.contractorId),
    isNull(atelierNepCompPlans.deletedAt),
  ));
  const plan = plans.filter((p) =>
    p.effectiveFrom <= args.workDate && Boolean(p.governingContractId) &&
    Boolean(p.governingContractVersionId),
  ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  // A term only supersedes a NEP plan when its permission is explicit.
  if (term && (!plan || term.allowsNepOverride)) {
    return {
      dayRateAmount: term.dayRateAmount,
      currency: term.currency,
      source: "engagement_term",
      termId: term.id,
      agreementRef: term.agreementRef,
      agreementVersionRef: term.agreementVersionRef,
      scope: term.scope,
    };
  }
  if (plan) return { dayRateAmount: plan.dayRateAmount, currency: plan.currency, source: "nep_plan", planId: plan.id };
  return roster;
}

export const contractorRatePerHour = (rate: ResolvedContractorRate): number =>
  rate.dayRateAmount / 8;
import type { Opportunity, SalesStage } from "@workspace/api-client-react";
import { STALLED_THRESHOLD_DAYS } from "./sales-stages";

export type OpportunityFilters = { stage: SalesStage | "all"; owner: string; partnerFirmId: string };

export function filterPartnerOpportunities(opportunities: Opportunity[], filters: OpportunityFilters): Opportunity[] {
  return opportunities.filter((opp) =>
    (filters.stage === "all" || (opp.salesStage ?? "suspect") === filters.stage) &&
    (filters.owner === "all" || opp.partnerOwnerId === filters.owner) &&
    (filters.partnerFirmId === "all" || (opp.partnerFirms ?? []).some((firm) => firm.id === filters.partnerFirmId)),
  );
}

export function summarizePartnerOpportunities(opportunities: Opportunity[]) {
  const raw: Record<string, number> = {};
  const weighted: Record<string, number> = {};
  let stalled = 0;
  for (const opp of opportunities) {
    const currency = opp.currency ?? "USD";
    raw[currency] = (raw[currency] ?? 0) + opp.dealSizeUsd;
    weighted[currency] = (weighted[currency] ?? 0) + opp.dealSizeUsd * opp.probabilityPct / 100;
    if (opp.stalled ?? opp.daysInStage > STALLED_THRESHOLD_DAYS) stalled++;
  }
  return { count: opportunities.length, raw, weighted, stalled };
}

export function partnerReportQuery(filters: OpportunityFilters): string {
  const query = new URLSearchParams({ partnerFirmId: filters.partnerFirmId });
  if (filters.stage !== "all") query.set("stage", filters.stage);
  if (filters.owner !== "all") query.set("owner", filters.owner);
  return query.toString();
}

export function partnerReportFilename(name: string, date: string): string {
  const stem = name.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "partner";
  return `opportunities-${stem}-${date.replace(/[^0-9-]/g, "")}.pdf`;
}
/**
 * Scenario registry for the Marketplace `/demo/:slug` route.
 *
 * Every marketplace tool now ships a hand-authored Scenario the
 * DemoExperience shell plays back deterministically. No more skeleton
 * stubs — each demo tells its tool's story end-to-end with a real
 * workspace artefact, KPI movement and at least one human checkpoint.
 */

import type { Scenario } from "../types";
import valueRealization from "./value-realization";
import programmeWarRoom from "./programme-war-room";
import citizenServices from "./citizen-services-concierge";
import procurementNegotiation from "./procurement-negotiation-agent";
import networkOps from "./network-ops-war-room";
import samaCompliance from "./sama-compliance-sentinel";
import customerCare from "./customer-care-hive";
import sovereignData from "./sovereign-data-steward";
import knowledgeConcierge from "./enterprise-knowledge-concierge";
import tenderResponse from "./tender-response-studio";
import arcelikTeknik from "./arcelik-fiyat-istihbarati";
import personalAgent from "./maven-personal-agent";

const SCENARIOS: Record<string, Scenario> = {
  "value-realization": valueRealization,
  "programme-war-room": programmeWarRoom,
  "tender-response-studio": tenderResponse,
  "procurement-negotiation-agent": procurementNegotiation,
  "network-ops-war-room": networkOps,
  "sama-compliance-sentinel": samaCompliance,
  "citizen-services-concierge": citizenServices,
  "customer-care-hive": customerCare,
  "sovereign-data-steward": sovereignData,
  "enterprise-knowledge-concierge": knowledgeConcierge,
  "arcelik-fiyat-istihbarati": arcelikTeknik,
  "arcelik-fiyat-istihbarati/teknik": arcelikTeknik,
  "maven-personal-agent": personalAgent,
};

export function getScenario(slug: string, variant?: string): Scenario | undefined {
  if (variant) {
    return SCENARIOS[`${slug}/${variant}`];
  }
  return SCENARIOS[slug];
}

export function listScenarioSlugs(): string[] {
  return Object.keys(SCENARIOS);
}

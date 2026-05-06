/**
 * Network-Ops agent layer.
 *
 * Thin derivation module that turns the static `network-ops-seed`
 * data and the canonical `network-ops-war-room` scenario script into
 * the live "agent recommendations" surface consumed by the NOC
 * Director Console (approvals queue, AI chat, KPI tiles).
 *
 * This keeps the seed pure (data) and the scenario authoritative
 * (script), while letting views read derived values through one stable
 * shape via `useNetworkOpsData`.
 */

import {
  APPROVALS,
  CREWS,
  INCIDENTS,
  SERVICES,
  SITES,
  computeKpis,
  type ApprovalItem,
  type Crew,
  type Incident,
  type ServiceSla,
  type Site,
} from "./network-ops-seed";
import networkOpsScenario from "@/lib/sim/scenarios/network-ops-war-room";
import type { Scenario } from "@/lib/sim/types";

export type AgentSeverity = "p1" | "p2" | "p3" | "p4";

export interface ScenarioCheckpointApproval extends ApprovalItem {
  /** True when this approval was derived from a scenario checkpoint. */
  fromScenario: true;
  scenarioCheckpointId: string;
}

/**
 * Map the two human checkpoints from the canonical scenario script
 * (`noc-engineer`, `regulator-filing`) into approval-card shape so the
 * Approvals view stays grounded in the same source of truth as the
 * agent cockpit.
 */
function deriveScenarioCheckpointApprovals(scenario: Scenario): ScenarioCheckpointApproval[] {
  return scenario.checkpoints.map((c, idx) => {
    const recommended = c.options.find((o) => o.recommended) ?? c.options[0];
    const isRollback = c.id === "noc-engineer";
    return {
      id: `chk-${c.id}`,
      incidentId: "INC-2026-3041",
      title: isRollback
        ? { en: "Rollback TX-NORTH-04 + re-route", ar: "تراجع TX-NORTH-04 + إعادة التوجيه" }
        : { en: "TDRA major-incident filing", ar: "إيداع TDRA لحادث كبير" },
      detail: c.question,
      raisedBy: c.human,
      severity: idx === 0 ? "p1" : "p1",
      confidence: idx === 0 ? 96 : 94,
      raisedAt: idx === 0 ? "2026-05-01T14:08:00Z" : "2026-05-01T14:11:30Z",
      recommendation: {
        en: `${recommended.label.en} — ${c.rationale.en}`,
        ar: `${recommended.label.ar} — ${c.rationale.ar}`,
      },
      fromScenario: true,
      scenarioCheckpointId: c.id,
    };
  });
}

export interface NetworkOpsAgentData {
  sites: Site[];
  incidents: Incident[];
  services: ServiceSla[];
  crews: Crew[];
  /** Scenario checkpoints first, then incident-level approvals. */
  approvals: (ApprovalItem | ScenarioCheckpointApproval)[];
  scenarioApprovals: ScenarioCheckpointApproval[];
  kpis: ReturnType<typeof computeKpis>;
  scenario: Scenario;
}

export function getNetworkOpsAgentData(): NetworkOpsAgentData {
  const scenarioApprovals = deriveScenarioCheckpointApprovals(networkOpsScenario);
  const scenarioIds = new Set(scenarioApprovals.map((a) => a.scenarioCheckpointId));
  // Suppress legacy seed approvals that duplicate the canonical scenario checkpoints.
  const incidentApprovals = APPROVALS.filter(
    (a) =>
      !(a.id === "apv-001" && scenarioIds.has("noc-engineer")) &&
      !(a.id === "apv-002" && scenarioIds.has("regulator-filing")),
  );
  return {
    sites: SITES,
    incidents: INCIDENTS,
    services: SERVICES,
    crews: CREWS,
    approvals: [...scenarioApprovals, ...incidentApprovals],
    scenarioApprovals,
    kpis: computeKpis(),
    scenario: networkOpsScenario,
  };
}

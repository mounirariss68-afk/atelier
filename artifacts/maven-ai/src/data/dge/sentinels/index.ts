/**
 * DGE Effortless 2.0 — Sentinel registry.
 *
 * One file per Sentinel. Each Sentinel exports its prompt, tool
 * allow-list, behavioural contract (may / mayOnlyWithHuman /
 * mustNever) and UX Authority contract (which surfaces it can
 * render on, who can authorise it). The shell consumes this
 * registry to render the Stack panel and to enforce contract
 * violations at runtime via `checkContract`.
 *
 * Sentinels are grouped by Agentic Factory (see `../factories.ts`).
 */
import type { BiText } from "@/lib/sim/types";
import type { BehaviouralContract, UXAuthorityContract } from "@/lib/dge/runtime";

export interface Sentinel {
  id: string;
  factory: string;
  name: BiText;
  role: BiText;
  prompt: BiText;
  tools: string[];
  behavioural: BehaviouralContract;
  ux: UXAuthorityContract;
}

import { catalogueChannelSentinels } from "./catalogueChannel";
import { complaintRecoverySentinels } from "./complaintRecovery";
import { qrFeedbackSentinels } from "./qrFeedback";
import { redTeamSentinels } from "./redTeam";
import { serviceRedesignSentinels } from "./serviceRedesign";
import { spokesReviewSentinels } from "./spokesReview";
import { perceptionSentinels } from "./perception";
import { prototypeSentinels } from "./prototype";

export const SENTINELS: Sentinel[] = [
  ...catalogueChannelSentinels,
  ...complaintRecoverySentinels,
  ...qrFeedbackSentinels,
  ...redTeamSentinels,
  ...serviceRedesignSentinels,
  ...spokesReviewSentinels,
  ...perceptionSentinels,
  ...prototypeSentinels,
];

export function sentinelsForFactory(factoryId: string): Sentinel[] {
  return SENTINELS.filter((s) => s.factory === factoryId);
}

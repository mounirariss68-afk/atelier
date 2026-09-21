import { createHash } from "node:crypto";

export type ExecutionClass = "executable" | "advisory" | "unsupported" | "utility";
export type OperationalStatus = "mvp" | "registered" | "runtime-only" | "utility" | "unsupported";
export type LensSourceMode = "runtime-registry" | "manual-record" | "not-applicable";
export interface AgentsLensLink { recordKey: string | null; sourceMode: LensSourceMode; }
export interface ApprovedDivergence { id: string; reason: string; owner: string; reviewBy: string; }

export interface CrmManifestEntry {
  id: string;
  name: string;
  aliases: string[];
  classification: ExecutionClass;
  registryId: string | null;
  runner: { file: string; symbol: string } | null;
  route: { file: string; hint: string } | null;
  promptRef: string | null;
  inputSchemaHash: string | null;
  outputSchemaHash: string | null;
  fixtureRefs: string[];
  agentsLens: AgentsLensLink;
  uiMounts: string[];
  operationalStatus: OperationalStatus;
  deterministicEvalIds: string[];
  approvedDivergences: ApprovedDivergence[];
  sourceHash?: string;
  promptHash?: string | null;
}

const runner = (symbol: string) => ({ file: "artifacts/api-server/src/lib/atelier-agents/runner.ts", symbol });
const route = (file: string, hint: string) => ({ file, hint });
const fixture = (id: string) => {
  const covered = new Set(["ag_pursuit_scout", "ag_pov_author", "ag_pov_draft", "ag_meeting_scribe", "ag_proposal_composer", "ag_charter_architect", "ag_case_study_picker", "ag_theme_curator", "ag_pricing_strategist", "ag_pricing_analyst", "ag_relationship_health", "ag_next_best_action", "ag_pre_meeting_briefing", "ag_win_loss_interviewer", "ag_synthesis_critic", "ag_brand_profile_writer", "ag_strategy_developer", "ag_procurement_navigator"]);
  return covered.has(id) ? `artifacts/api-server/tests/agents/${id}/golden.json` : null;
};
const QUALITY_FIXTURE = "artifacts/api-server/tests/crm-agent-contracts/v1.reviewed.json";
const GENERIC_AGENT_UI = [
  "artifacts/atelier/src/pages/Agents.tsx",
  "artifacts/atelier/src/pages/AgentProfile.tsx",
  "artifacts/atelier/src/pages/AgentRun.tsx",
];

function evalsFor(id: string): string[] {
  if (id === "ag_account_cartographer") return ["eval-contact-cartographer-v1"];
  if (id === "ag_executive_mapper") return ["eval-contact-executive-mapper-v1"];
  if (["ag_pursuit_scout", "ag_pov_researcher", "ag_pre_meeting_briefing"].includes(id)) {
    return ["eval-citation-refusal-fact-v1"];
  }
  if (["ag_pov_author", "ag_pov_draft"].includes(id)) return ["eval-pov-fact-promotion-v1"];
  if (id === "ag_proposal_composer") return ["eval-proposal-approval-v1"];
  if (["ag_pricing_analyst", "ag_pricing_researcher", "ag_pricing_strategist"].includes(id)) {
    return ["eval-pricing-margin-override-v1"];
  }
  if (id === "ag_pipeline_forecaster") return ["eval-pipeline-forecast-calibration-v1"];
  if (["ag_case_study_picker", "ag_riser_orchestrator", "ag_partner_fit_context", "ag_run_staleness", "ag_scout_persistence"].includes(id)) {
    return [];
  }
  return ["eval-global-security-tenant-write-v1"];
}

function uiMountsFor(id: string, registryId: string | null, classification: ExecutionClass): string[] {
  if (classification === "unsupported" || classification === "utility") return [];
  if (registryId) return GENERIC_AGENT_UI;
  if (["ag_account_cartographer", "ag_executive_mapper", "ag_whitespace_mapper", "ag_qbr_composer"].includes(id)) {
    return ["artifacts/atelier/src/pages/Account.tsx"];
  }
  if (id === "ag_pricing_researcher") {
    return ["artifacts/atelier/src/components/tabs/PricingStructuresPanel.tsx"];
  }
  if (id === "ag_pipeline_forecaster") return [];
  return ["artifacts/atelier/src/pages/Opportunity.tsx"];
}

/** Reviewed inventory from atelier-crm-agent-workflows-audit.md §Authoritative inventory. */
type CrmContractRow = [
  name: string,
  id: string,
  aliases: string[],
  classification: ExecutionClass,
  registryId: string | null,
  runnerSymbol: string | null,
  routeFile: string | null,
  routeHint: string | null,
  prompt: string | null,
  status: OperationalStatus,
];

const CRM_CONTRACT_ROWS: CrmContractRow[] = [
  ["Account Cartographer", "ag_account_cartographer", ["account research/enrichment", "cartographer/refresh"], "advisory", "ag_account_cartographer", "runAccountCartographer", "accountRoutes.ts", "queueCartographerResearch", null, "registered"],
  ["Executive Mapper", "ag_executive_mapper", ["executive sweep/coverage"], "advisory", "ag_executive_mapper", "runExecutiveMapper", "accountRoutes.ts", "executive", null, "registered"],
  ["Pursuit Scout", "ag_pursuit_scout", ["Scout", "opportunity research"], "executable", "ag_pursuit_scout", "runPursuitScout", "agentRoutes.ts", "opportunity", "pursuit_scout", "mvp"],
  ["POV Deep Researcher", "ag_pov_researcher", ["POV research", "research pass"], "advisory", "ag_pov_researcher", "runPovDeepResearch", "agentRoutes.ts", "pov-research", "pov_author", "registered"],
  ["POV Author (outline)", "ag_pov_author", ["POV outline"], "executable", "ag_pov_author", "runPovOutline", "agentRoutes.ts", "pov_author", "pov_author", "mvp"],
  ["POV Draft", "ag_pov_draft", ["HTML draft/revision"], "executable", "ag_pov_draft", "runPovDraft", "agentRoutes.ts", "pov_draft", "pov_author", "registered"],
  ["Meeting Scribe", "ag_meeting_scribe", ["transcript/recording scribe"], "executable", "ag_meeting_scribe", "runMeetingScribe", "agentRoutes.ts", "meeting", "meeting_scribe", "mvp"],
  ["Proposal Composer", "ag_proposal_composer", ["proposal writer"], "executable", "ag_proposal_composer", "runProposalComposer", "proposalRoutes.ts", "proposal", "proposal_composer", "mvp"],
  ["Charter Architect", "ag_charter_architect", ["engagement charter"], "executable", "ag_charter_architect", "runCharterArchitect", "engagementRoutes.ts", "charter", "charter_architect", "mvp"],
  ["Case Study Picker", "ag_case_study_picker", [], "unsupported", null, null, null, null, null, "unsupported"],
  ["Theme Curator", "ag_theme_curator", [], "advisory", "ag_theme_curator", "runThemeCurator", "winLossRoutes.ts", "theme", "theme_curator", "registered"],
  ["Pricing Strategist", "ag_pricing_strategist", ["commercial/pricing assistant"], "executable", "ag_pricing_strategist", "runPricingStrategist", "pricingRoutes.ts", "runPricingStrategist", "pricing_strategist", "mvp"],
  ["Pricing Analyst", "ag_pricing_analyst", ["pricing structure simulator"], "advisory", "ag_pricing_analyst", "runPricingAnalyst", "pricingRoutes.ts", "runPricingAnalyst", "pricing_analyst", "registered"],
  ["Pricing Researcher", "ag_pricing_researcher", ["runtime pricing-research alias"], "advisory", null, "runPricingResearcher", "pricingRoutes.ts", "runPricingResearcher", null, "runtime-only"],
  ["Pipeline Forecaster", "ag_pipeline_forecaster", ["forecast/scenario"], "advisory", null, "runPipelineForecaster", "agentRoutes.ts", "forecast", null, "runtime-only"],
  ["Strategy Developer", "ag_strategy_developer", ["account strategy developer"], "advisory", "ag_strategy_developer", "runStrategyDeveloper", "accountRoutes.ts", "strategy-developer", "strategy_developer", "mvp"],
  ["Procurement Navigator", "ag_procurement_navigator", ["procurement/vendor registration guide"], "advisory", "ag_procurement_navigator", "runProcurementNavigator", "accountRoutes.ts", "procurement-navigator", "procurement_navigator", "mvp"],
  ["Relationship-Health", "ag_relationship_health", ["relationship intelligence"], "advisory", "ag_relationship_health", "runRelationshipHealth", "accountRoutes.ts", "relationship-health", "relationship_health", "mvp"],
  ["Next-Best-Action", "ag_next_best_action", [], "advisory", "ag_next_best_action", "runNextBestAction", "accountRoutes.ts", "next-best-action", "next_best_action", "mvp"],
  ["Pre-Meeting Briefing", "ag_pre_meeting_briefing", [], "advisory", "ag_pre_meeting_briefing", "runPreMeetingBriefing", "accountRoutes.ts", "pre-meeting-briefing", "pre_meeting_briefing", "mvp"],
  ["Whitespace Mapper", "ag_whitespace_mapper", [], "advisory", null, "runWhitespaceMapper", "accountRoutes.ts", "runWhitespaceMapper", null, "runtime-only"],
  ["QBR Composer", "ag_qbr_composer", [], "advisory", null, "runQbrComposer", "accountRoutes.ts", "runQbrComposer", null, "runtime-only"],
  ["Riser", "ag_riser_orchestrator", ["Chat Orchestrator", "generic Riser dispatch"], "utility", "ag_riser_orchestrator", "runSalonConcierge", "agentRoutes.ts", "chat", "chat_orchestrator", "registered"],
  ["Partner-fit context", "ag_partner_fit_context", ["alliance capability matching"], "utility", null, "buildAllianceCapabilityContext", "agentRoutes.ts", "opportunities", null, "utility"],
  ["Win/Loss Interviewer", "ag_win_loss_interviewer", ["debrief"], "advisory", "ag_win_loss_interviewer", "runWinLossInterviewer", "winLossRoutes.ts", "debrief", "win_loss_interviewer", "mvp"],
  ["Brand Profile Writer", "ag_brand_profile_writer", ["brand/boilerplate"], "executable", "ag_brand_profile_writer", "runBrandProfileWriter", "firmProfileRoutes.ts", "brand-profile", "brand_profile_writer", "mvp"],
  ["Synthesis Critic", "ag_synthesis_critic", ["deliverable quality gate"], "advisory", "ag_synthesis_critic", "runSynthesisCritic", "engagementRoutes.ts", "synthesis", "synthesis_critic", "mvp"],
  ["Scout persistence / citation guardrail", "ag_scout_persistence", ["Scout persistence", "citation guardrail"], "utility", null, "persistBriefAndFacts", "agentRoutes.ts", "scout", null, "utility"],
  ["Run staleness / launch visibility", "ag_run_staleness", ["run staleness", "launch visibility"], "utility", null, "startRun", "agentRoutes.ts", "launch", null, "utility"],
];

export const CRM_CONTRACT_ENTRIES: CrmManifestEntry[] = CRM_CONTRACT_ROWS.map(
([name, id, aliases, classification, registryId, runnerSymbol, routeFile, routeHint, prompt, status]) => ({
  id, name, aliases: [...new Set([id.replace(/^ag_/, ""), ...aliases])], classification, registryId,
  runner: id === "ag_case_study_picker" ? null : id === "ag_riser_orchestrator"
    ? { file: "artifacts/api-server/src/lib/atelier-cli/index.ts", symbol: "runTurn" }
    : id === "ag_executive_mapper"
    ? { file: "artifacts/api-server/src/lib/atelier-agents/executive-mapper-chain.ts", symbol: "runExecutiveMapperAndQueue" }
    : id === "ag_partner_fit_context"
    ? { file: "artifacts/api-server/src/lib/atelier-agents/alliance-capability-context.ts", symbol: runnerSymbol }
    : id === "ag_run_staleness"
    ? { file: "artifacts/api-server/src/lib/atelier-agents/run-staleness.ts", symbol: "agentRunRowIsStale" }
    : id === "ag_scout_persistence"
    ? { file: "artifacts/api-server/src/lib/atelier-agents/scout-persist.ts", symbol: runnerSymbol }
    : runner(runnerSymbol!),
  route: id === "ag_case_study_picker" || id === "ag_partner_fit_context" || id === "ag_run_staleness"
    ? null
    : id === "ag_riser_orchestrator"
    ? route("artifacts/api-server/src/routes/atelier/cliRoutes.ts", "/cli/turn")
    : route(
        `artifacts/api-server/src/routes/atelier/${routeFile!}`,
        id === "ag_executive_mapper"
          ? "runExecutiveMapperAndQueue"
          : id === "ag_pipeline_forecaster"
          ? "runForecasterHandler"
          : id === "ag_account_cartographer"
          ? routeHint!
          : runnerSymbol!,
      ),
  promptRef: id === "ag_account_cartographer"
    ? "prompts/account_cartographer/v1.md"
    : id === "ag_executive_mapper"
    ? "prompts/executive_mapper/v2.md"
    : id === "ag_pricing_researcher"
    ? "inline:artifacts/api-server/src/lib/atelier-agents/runner.ts#You are Cognirise's Pricing Researcher"
    : id === "ag_whitespace_mapper"
    ? "inline:artifacts/api-server/src/lib/atelier-agents/runner.ts#You are Whitespace Mapper"
    : id === "ag_qbr_composer"
    ? "inline:artifacts/api-server/src/lib/atelier-agents/runner.ts#You are QBR Composer"
    : status === "runtime-only" || status === "utility" || status === "unsupported"
    ? null
    : prompt
    ? `prompts/${prompt}/v1.md`
    : null,
  inputSchemaHash: registryId ? "generated" : null,
  outputSchemaHash: registryId ? "generated" : null,
  fixtureRefs: classification === "unsupported" || classification === "utility"
    ? []
    : [QUALITY_FIXTURE, ...(registryId && fixture(registryId) ? [fixture(registryId)!] : [])],
  agentsLens: {
    recordKey: registryId
      ? registryId
      : classification === "utility" || classification === "unsupported"
      ? null
      : id.replace(/^ag_/, ""),
    sourceMode: registryId
      ? "runtime-registry"
      : classification === "utility" || classification === "unsupported"
      ? "not-applicable"
      : "manual-record",
  },
  uiMounts: uiMountsFor(id, registryId, classification),
  operationalStatus: status,
  deterministicEvalIds: evalsFor(id),
  approvedDivergences: id === "ag_case_study_picker"
    ? [{ id: "div_case_study_embedded_label", reason: "Embedded Proposal Composer progress label; no separate executor exists.", owner: "atelier-platform", reviewBy: "2026-12-31" }]
    : [],
} as CrmManifestEntry));

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Canonical, field-sensitive Zod fingerprint input. Zod v3 keeps object
 * fields behind `_def.shape()`, so JSON-stringifying `_def` silently drops
 * the most important schema information.
 */
export function schemaFingerprint(schema: unknown): unknown {
  const visit = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return `[function:${value.name || "anonymous"}]`;
    if (typeof value === "undefined") return "[undefined]";
    if (typeof value !== "object") return String(value);

    const object = value as Record<string, unknown>;
    if (seen.has(object)) return "[circular]";
    seen.add(object);
    try {
      if ("_def" in object) return visit(object._def, seen);
      if (Array.isArray(value)) return value.map((item) => visit(item, seen));
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Map) {
        return [...value.entries()]
          .map(([key, item]) => [String(key), visit(item, seen)])
          .sort(([a], [b]) => String(a).localeCompare(String(b)));
      }

      const out: Record<string, unknown> = {};
      for (const key of Object.keys(object).sort()) {
        if (key === "shape" && typeof object[key] === "function") {
          const shape = (object[key] as () => Record<string, unknown>)();
          out.shape = Object.fromEntries(
            Object.keys(shape).sort().map((field) => [field, visit(shape[field], seen)]),
          );
        } else {
          out[key] = visit(object[key], seen);
        }
      }
      return out;
    } finally {
      seen.delete(object);
    }
  };
  return visit(schema, new WeakSet<object>());
}

export function sortedEntries(): CrmManifestEntry[] {
  return [...CRM_CONTRACT_ENTRIES].sort((a, b) => a.id.localeCompare(b.id));
}
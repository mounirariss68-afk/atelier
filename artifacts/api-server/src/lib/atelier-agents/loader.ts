import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { db, atelierPrompts } from "@workspace/db";
import { getAgent } from "@workspace/agents";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAssistantProviderContext } from "../assistant/provider-context.js";

// In dev (`tsx`-like) and production (esbuild bundle) we must locate the
// `prompts/` directory relative to the package root. It is shipped beside
// the bundled `dist/` and source `src/` trees, so step up until we find it.
function findPromptDir(): string {
  // Prefer an env-overrideable location (useful for tests/deployments).
  if (process.env.ATELIER_PROMPT_DIR) return process.env.ATELIER_PROMPT_DIR;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const candidate = resolve(dir, "prompts");
      readFileSync(resolve(candidate, "pursuit_scout/v1.md"));
      return candidate;
    } catch {
      // walk up
    }
    dir = resolve(dir, "..");
  }
  // Fall back to the in-repo path so dev mode never silently breaks.
  return resolve(process.cwd(), "artifacts/api-server/prompts");
}

const PROMPT_DIR = findPromptDir();

export type AtelierAgentId =
  | "pursuit_scout"
  | "pov_author"
  | "meeting_scribe"
  | "charter_architect"
  | "synthesis_critic"
  | "agent_architect"
  | "prototype_forge"
  | "proposal_composer"
  | "pricing_analyst"
  | "pricing_strategist"
  // Task #663 — Pricing Researcher (web-search market benchmarks, review-only)
  | "pricing_researcher"
  | "case_study_picker"
  | "compliance_reviewer"
  | "win_loss_interviewer"
  | "theme_curator"
  | "utilization_analyst"
  | "burn_sentinel"
  | "expense_auditor"
  | "account_cartographer"
  | "executive_mapper"
  | "brand_profile_writer"
  // v5 — Press
  | "linkedin_composer"
  | "press_monitor"
  | "field_notes_scheduler"
  // v5 — Alliances (Task #513: alliance_choreographer removed to backlog)
  | "certification_tracker"
  // Task #526 — Alliance Partner Evaluation Framework agents
  | "alliance_cartographer"
  | "alliance_executive_mapper"
  // v5 — Studio (recruiting)
  | "interview_designer"
  | "reference_caller"
  | "offer_composer"
  // v5 — Guardhouse (security & compliance)
  | "compliance_sentinel"
  | "incident_responder"
  | "dsar_concierge"
  | "backup_auditor"
  // v5 — IP / Asset catalog
  | "ip_steward"
  | "oss_compliance_sentinel"
  | "demo_environment_curator"
  // L2C Wave 1 — Codex (CLM)
  | "contract_composer"
  | "redline_analyst"
  | "esign_orchestrator"
  | "dpa_sentinel"
  | "renewal_watchdog"
  // Account-management agents (Next-Best-Action, Relationship-Health, Pre-Meeting Briefing)
  | "next_best_action"
  | "relationship_health"
  | "pre_meeting_briefing"
  // Task #699 — Account Strategy Developer
  | "strategy_developer"
  // Task #722 — Procurement Navigator (vendor-registration research)
  | "procurement_navigator";

/**
 * Load an agent prompt from `prompts/<agentId>/v<version>.md`.
 *
 * Task #306 (v5) — Some v1 agents grew "mode" extensions instead of being
 * cloned into parallel agents (see `artifacts/atelier/docs/v5-scale-and-trust.md`
 * for the conflict-resolution discipline). Mode files live alongside the
 * base version as `v<version>_<mode>_mode.md`. Pass `mode` to load one:
 *
 *   loadPrompt("pov_author", 2, "press")           // v2_press_mode.md
 *   loadPrompt("account_cartographer", 2, "partner") // v2_partner_mode.md
 *   loadPrompt("pursuit_scout", 2, "recruiting")    // v2_recruiting_mode.md
 *
 * Without `mode`, the loader resolves `v<version>.md` as before.
 */
export function loadPrompt(
  agentId: AtelierAgentId,
  version = 1,
  mode?: string,
): string {
  const filename = mode ? `v${version}_${mode}_mode.md` : `v${version}.md`;
  const path = resolve(PROMPT_DIR, agentId, filename);
  return readFileSync(path, "utf8");
}

/** Resolve an org override, falling back to the immutable filesystem prompt. */
export async function resolveEffectiveAgentPrompt(args: {
  orgId?: string | null;
  agentId: AtelierAgentId | string;
  version?: number;
  mode?: string;
}): Promise<{ body: string; source: "override" | "filesystem"; version: number; baseRef: string; updatedAt: Date }> {
  const version = args.version ?? 1;
  const runtime = getAgent(args.agentId);
  const canonicalAgentId = runtime?.id ?? (args.agentId.startsWith("ag_") ? args.agentId : `ag_${args.agentId}`);
  if (args.orgId) {
    const [override] = await db.select().from(atelierPrompts).where(and(
      eq(atelierPrompts.orgId, args.orgId),
      eq(atelierPrompts.agentId, canonicalAgentId),
      eq(atelierPrompts.status, "active"),
      isNull(atelierPrompts.deletedAt),
    )).orderBy(desc(atelierPrompts.version)).limit(1);
    if (override) {
      return { body: override.body, source: "override", version: override.version, baseRef: `v${version}`, updatedAt: override.updatedAt };
    }
  }
  const logicalId = runtime?.id.replace(/^ag_/, "") ?? args.agentId.replace(/^ag_/, "");
  const requestedRef = args.mode
    ? `prompts/${logicalId}/v${version}_${args.mode}_mode.md`
    : args.version !== undefined
      ? `prompts/${logicalId}/v${version}.md`
      : runtime?.systemPromptRef;
  const safeRef = requestedRef?.startsWith("prompts/") && !requestedRef.includes("..")
    ? requestedRef.slice("prompts/".length)
    : undefined;
  const fallbackRef = runtime?.systemPromptRef?.startsWith("prompts/") && !runtime.systemPromptRef.includes("..")
    ? runtime.systemPromptRef.slice("prompts/".length)
    : undefined;
  let body: string;
  let baseRef: string;
  try {
    if (!safeRef) throw new Error("missing prompt reference");
    body = readFileSync(resolve(PROMPT_DIR, safeRef), "utf8");
    baseRef = requestedRef!;
  } catch (error) {
    if (!fallbackRef || fallbackRef === safeRef) throw error;
    body = readFileSync(resolve(PROMPT_DIR, fallbackRef), "utf8");
    baseRef = runtime!.systemPromptRef;
  }
  return { body, source: "filesystem", version, baseRef, updatedAt: new Date() };
}

export async function loadEffectivePrompt(
  agentId: AtelierAgentId,
  version?: number,
  mode?: string,
  orgId?: string | null,
): Promise<string> {
  let effectiveOrg = orgId;
  if (!effectiveOrg) {
    try { effectiveOrg = requireAssistantProviderContext().orgId; } catch { /* legacy callers use filesystem */ }
  }
  return (await resolveEffectiveAgentPrompt({ orgId: effectiveOrg, agentId, version, mode })).body;
}

export function promptSha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

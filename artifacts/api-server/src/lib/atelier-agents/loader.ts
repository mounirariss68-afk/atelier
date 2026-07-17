import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
  // v5 — Alliances
  | "alliance_choreographer"
  | "certification_tracker"
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
  | "pre_meeting_briefing";

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

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
  | "compliance_reviewer";

export function loadPrompt(agentId: AtelierAgentId, version = 1): string {
  const path = resolve(PROMPT_DIR, agentId, `v${version}.md`);
  return readFileSync(path, "utf8");
}

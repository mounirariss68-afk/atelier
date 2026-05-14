/**
 * pnpm test:agents — Atelier agent fixture validator.
 *
 * Walks every fixture under `tests/agents/<agent_id>/golden*.json`,
 * looks up the registry entry, and validates `input` against the
 * registry's Zod `inputSchema`. If the fixture also contains an
 * `expectedOutput` block, that is validated against `outputSchema`.
 *
 * The point is to protect the contract — not the LLM's prose. See
 * `artifacts/atelier/AGENT_STANDARD.md` §11 for the convention.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATELIER_AGENTS, getAgent } from "@workspace/agents";

const ROOT = resolve(fileURLToPath(import.meta.url), "..");

interface Fixture {
  agentId: string;
  input: unknown;
  expectedOutput?: unknown;
  expectedOutputShape?: string;
  notes?: string;
}

interface Failure {
  agentId: string;
  fixture: string;
  error: string;
}

function listFixtures(): Array<{ agentId: string; path: string }> {
  const out: Array<{ agentId: string; path: string }> = [];
  const entries = readdirSync(ROOT);
  for (const dir of entries) {
    const full = join(ROOT, dir);
    if (!statSync(full).isDirectory()) continue;
    if (!dir.startsWith("ag_")) continue;
    for (const f of readdirSync(full)) {
      if (!f.endsWith(".json")) continue;
      out.push({ agentId: dir, path: join(full, f) });
    }
  }
  return out;
}

function main(): void {
  const failures: Failure[] = [];
  const passes: string[] = [];
  const registryIds = new Set(ATELIER_AGENTS.map((a) => a.id));
  const fixtures = listFixtures();

  for (const { agentId, path } of fixtures) {
    const raw = readFileSync(path, "utf8");
    let fixture: Fixture;
    try {
      fixture = JSON.parse(raw) as Fixture;
    } catch (err) {
      failures.push({ agentId, fixture: path, error: `invalid JSON: ${(err as Error).message}` });
      continue;
    }
    if (fixture.agentId !== agentId) {
      failures.push({
        agentId,
        fixture: path,
        error: `fixture.agentId="${fixture.agentId}" does not match directory "${agentId}"`,
      });
      continue;
    }
    const agent = getAgent(agentId);
    if (!agent) {
      failures.push({ agentId, fixture: path, error: `no registry entry for ${agentId}` });
      continue;
    }
    const inputParse = agent.inputSchema.safeParse(fixture.input);
    if (!inputParse.success) {
      failures.push({
        agentId,
        fixture: path,
        error: `input failed schema: ${inputParse.error.message}`,
      });
      continue;
    }
    if (fixture.expectedOutput !== undefined) {
      const outParse = agent.outputSchema.safeParse(fixture.expectedOutput);
      if (!outParse.success) {
        failures.push({
          agentId,
          fixture: path,
          error: `expectedOutput failed schema: ${outParse.error.message}`,
        });
        continue;
      }
    }
    passes.push(`${agentId}: ${path.split("/").pop()}`);
  }

  // Coverage check — every MVP / registered agent should have ≥1 fixture.
  const covered = new Set(fixtures.map((f) => f.agentId));
  const missing = ATELIER_AGENTS.filter(
    (a) => (a.status === "mvp" || a.status === "registered") && !covered.has(a.id) && !a.id.match(/^ag_(triage|raid_watchdog|knowledge_concierge|atelier_curator|prompt_librarian|diagnostic_memo|workplan_architect|adoption_coach|value_case_tracker|compliance_reviewer|pricing_analyst|bench_planner|brand_translator|storyboarder)$/),
  );

  console.log(`\n[test:agents] ran ${fixtures.length} fixture(s) across ${registryIds.size} registered agents`);
  for (const p of passes) console.log(`  ✓ ${p}`);
  for (const f of failures) console.log(`  ✗ ${f.fixture}\n    ${f.error}`);
  if (missing.length) {
    console.log("\n  ⚠ MVP/registered agents without a fixture:");
    for (const a of missing) console.log(`    - ${a.id} (${a.status})`);
  }

  if (failures.length > 0) {
    console.error(`\n[test:agents] FAILED — ${failures.length} fixture(s) did not pass.`);
    process.exit(1);
  }
  console.log(`\n[test:agents] OK — all ${fixtures.length} fixtures pass.`);
}

main();

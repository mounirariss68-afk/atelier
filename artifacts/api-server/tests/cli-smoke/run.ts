/**
 * Task #338 — Smoke prompts.
 *
 * Drives a small set of natural-language prompts through the
 * mock-model intent router and asserts each lands on the right
 * catalog tool with a confirmation envelope. This is the build-time
 * sentinel for the "any UI action ↔ assistant phrasing" promise.
 *
 * Pure / in-process — no DB writes (we stop at the confirm phase).
 */
import assert from "node:assert/strict";
import { routePromptToCapability } from "../../src/lib/atelier-cli/index.js";
import "../../src/lib/atelier-cli/capability-seed.js";
import "../../src/lib/atelier-cli/attachment-capabilities.js";
import "../../src/lib/atelier-cli/parity-capabilities.js";

interface Smoke {
  prompt: string;
  expectTool: string;
}

const SMOKES: Smoke[] = [
  { prompt: "Add a new account Ministry of Energy in the UAE", expectTool: "account_create" },
  { prompt: "Create an opportunity for Tasama Holding", expectTool: "opportunity_create" },
  { prompt: "Move Acme to pursue", expectTool: "opportunity_move_stage" },
  { prompt: "Approve Sara's timesheet for last week", expectTool: "ledger_approve_timesheet" },
  { prompt: "Close RAID item raid_204", expectTool: "raid_close" },
  { prompt: "Compose a proposal for the DEWA opp", expectTool: "proposal_compose" },
  { prompt: "Send the DEWA proposal to procurement@dewa.gov.ae", expectTool: "proposal_send" },
  { prompt: "Draft a POV for opp_dewa on cost-to-serve", expectTool: "opportunity_draft_pov" },
  { prompt: "Approve the latest charter as partner on eng_acme", expectTool: "engagement_approve_charter" },
  { prompt: "Add a 45 USD client lunch at Sushi Roku on 2026-05-12", expectTool: "wallet_create_expense" },
];

let pass = 0;
let fail = 0;

console.log("Task #338 — CLI smoke prompts");

for (const s of SMOKES) {
  try {
    const route = routePromptToCapability(s.prompt);
    assert.ok(route, `no catalog match for: ${s.prompt}`);
    assert.equal(route.toolName, s.expectTool, `${s.prompt} → got ${route.toolName}, expected ${s.expectTool}`);
    pass++;
    console.log(`  ✓ "${s.prompt}" → ${route.toolName}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ "${s.prompt}"\n      ${(err as Error).message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

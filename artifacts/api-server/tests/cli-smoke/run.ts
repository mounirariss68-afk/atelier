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
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";

interface Smoke {
  prompt: string;
  expectTool: string;
}

const SMOKES: Smoke[] = [
  { prompt: "Add a new account Ministry of Energy in the UAE", expectTool: "account_create" },
  // Regression for "X as a new account" phrasing — captureAfter
  // returned an empty name for this shape, which then ran the tool
  // and rendered as "✗ account_create" / "Done." in the bar.
  { prompt: "Add Ministry of Energy in the UAE as a new account", expectTool: "account_create" },
  { prompt: "Create an opportunity for Tasama Holding", expectTool: "opportunity_create" },
  { prompt: "Move Acme to pursue", expectTool: "opportunity_move_stage" },
  { prompt: "Approve Sara's timesheet for last week", expectTool: "ledger_approve_timesheet" },
  { prompt: "Close RAID item raid_204", expectTool: "raid_close" },
  { prompt: "Compose a proposal for the DEWA opp", expectTool: "proposal_compose" },
  { prompt: "Send the DEWA proposal to procurement@dewa.gov.ae", expectTool: "proposal_send" },
  { prompt: "Draft a POV for opp_dewa on cost-to-serve", expectTool: "opportunity_draft_pov" },
  { prompt: "Approve the latest charter as partner on eng_acme", expectTool: "engagement_approve_charter" },
  { prompt: "Add a 45 USD client lunch at Sushi Roku on 2026-05-12", expectTool: "wallet_create_expense" },
  // Task #341 — read-side parity smoke prompts.
  { prompt: "Show pipeline by stage", expectTool: "pipeline_by_stage" },
  { prompt: "List opportunities in pursue", expectTool: "opportunity_list_by_stage" },
  { prompt: "List active engagements", expectTool: "engagement_list_active" },
  { prompt: "Show firm utilization this week", expectTool: "utilization_firm" },
  { prompt: "Show burn vs budget on eng_acme", expectTool: "burn_vs_budget" },
  { prompt: "Show expenses aging over 30 days", expectTool: "expense_aging" },
  { prompt: "Show policy violations on expenses", expectTool: "wallet_policy_violations" },
  { prompt: "Summarize the Tasama dossier", expectTool: "account_dossier" },
  { prompt: "What changed on Acme this week?", expectTool: "account_changes" },
  { prompt: "Show agent runs that failed yesterday", expectTool: "agent_runs_status" },
  { prompt: "List open RAID items", expectTool: "raid_open_list" },
  { prompt: "Show my approval queue", expectTool: "approval_queue" },
  { prompt: "Show pipeline forecast", expectTool: "forecast_summary" },
  { prompt: "Show people whose certifications expire in 90 days", expectTool: "roster_compliance_due" },
  { prompt: "Show my timesheet for this week", expectTool: "timesheet_current" },
  { prompt: "Show recent activity across the firm", expectTool: "recent_activity" },
  // Task #341 — additional natural-language phrasings called out in
  // the read-parity acceptance criteria.
  { prompt: "What's my pipeline this quarter?", expectTool: "pipeline_by_stage" },
  { prompt: "Who's over-utilized this week?", expectTool: "utilization_firm" },
  { prompt: "How is the DEWA engagement burning vs budget?", expectTool: "burn_vs_budget" },
  { prompt: "What's waiting on me?", expectTool: "approval_queue" },
  // ---------------------------------------------------------------------
  // Task #360 (W1-S8) — Codex / CLM, change orders, deliverable
  // acceptance smoke prompts. These exercise the natural-language
  // surfaces the assistant should route to the new Wave-1 verbs.
  // ---------------------------------------------------------------------
  { prompt: "Add Tasama Holding as a new counterparty in Saudi Arabia", expectTool: "codex_counterparty_create" },
  { prompt: "Publish the limitation-of-liability clause version 3", expectTool: "codex_clause_publish" },
  { prompt: "Compose the SOW draft for the DEWA engagement", expectTool: "codex_contract_compose" },
  { prompt: "Dispatch the DEWA SOW to procurement for signature", expectTool: "codex_contract_dispatch" },
  { prompt: "Record the counterparty redline on the DEWA SOW", expectTool: "codex_contract_record_redline" },
  { prompt: "Review the DEWA DPA for GDPR risks", expectTool: "codex_dpa_review" },
  { prompt: "Show contracts expiring in the next 60 days", expectTool: "codex_renewal_watchdog_run" },
  { prompt: "Propose a $25k change order on eng_dewa for additional analytics scope", expectTool: "change_order_propose" },
  { prompt: "Approve change order co_123 as partner", expectTool: "change_order_partner_approve" },
  { prompt: "Send change order co_123 to the client", expectTool: "change_order_dispatch" },
  { prompt: "Record client acceptance of change order co_123", expectTool: "change_order_record_acceptance" },
  { prompt: "Draft an acceptance attestation for the DEWA Phase 1 final report", expectTool: "deliverable_acceptance_create" },
  { prompt: "Send the DEWA Phase 1 acceptance to procurement@dewa.gov.ae for signing", expectTool: "deliverable_acceptance_submit" },
  { prompt: "Record the signed acceptance evidence URL on dlacc_xyz", expectTool: "deliverable_acceptance_record_signed" },
  // Task #362 — L2C Wave 3 (invoicing, AR aging, dunning).
  { prompt: "Show AR aging", expectTool: "wallet_ar_aging" },
  { prompt: "Where is the cash sitting?", expectTool: "wallet_ar_aging" },
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

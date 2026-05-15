/**
 * Task #339 — single boot-time entry point for the capability catalog.
 *
 * Imported once by the orchestrator (`./index.ts`). Side-effect loads
 * every capability source in a deterministic order:
 *
 *   1. CLI-only entries (help, lookup, mock high-blast-radius writes).
 *   2. Attachment + rubric capabilities (Task #334 read+ingest verbs).
 *   3. Agent capabilities — auto-derived from `@workspace/agents`.
 *
 * Once `defineRouteCapability` migrations land in downstream tasks,
 * the route files themselves will be imported here too. They cannot
 * be discovered automatically because the route module graph is
 * traversed by the Express router, not by this file.
 */

import "./cli-only-capabilities.js";
import "./cli-only-capabilities-reads.js";
import "./attachment-capabilities.js";
import "./undo.js";
import "./parity-capabilities.js";
// L2C Wave 1 (Task #360, W1-S8) — Codex/CLM, change order, and
// deliverable-acceptance verbs. The catalog gate
// (`capabilitiesForPersona`) strips the entire codex / change_order /
// deliverable_acceptance modules from the slice the orchestrator sees
// for restricted personas (contractor / partner_firm_resource /
// recruiter) and board observers — defence in depth above each
// entry's `requiredRoles`.
import "./codex-capabilities.js";
// L2C Wave 2 (Task #361) — revenue recognition, period postings,
// adjustments, WIP, margin, leakage. Catalog gate strips the
// `revrec`/`wip`/`margin`/`leakage` modules from restricted personas
// and from board_observer EXCEPT the rollup ids in
// `BOARD_OBSERVER_ROLLUP_ALLOWLIST` (wip_report, leakage_report,
// revrec_compute_schedule).
import "./revrec-capabilities.js";
import "./l2c-wave3-capabilities.js";
// L2C Wave 4 (Task #363) — cash application, bank reconciliation,
// 13-week cash forecast, renewals & NRR. Restricted personas are
// stripped at the catalog gate (`RESTRICTED_DENIED_MODULES`); board
// observer is allow-listed only onto `cash_forecast_13w`.
import "./l2c-wave4-capabilities.js";
import { registerAgentCapabilities } from "./agent-capabilities.js";

let bootstrapped = false;

/**
 * Idempotent bootstrap. The orchestrator invokes this implicitly via
 * the side-effect imports above; tests that reset the catalog call it
 * explicitly to repopulate.
 */
export function bootstrapCapabilities(): void {
  if (bootstrapped) return;
  registerAgentCapabilities();
  bootstrapped = true;
}

bootstrapCapabilities();

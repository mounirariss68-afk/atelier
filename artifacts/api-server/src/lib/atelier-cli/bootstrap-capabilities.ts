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
// Task #406 — Chat Orchestrator coordinator tools (resolve_entity,
// prefill_from_specialist, evaluate_gate, propose_write). These are
// catalog-only verbs; the orchestration logic IS the existing runTurn
// loop driven by the system prompt at prompts/chat_orchestrator/v1.md.
import "./orchestrator-capabilities.js";
// Task #411 — coverage expansion: 15 new chat-owned write entities
// (meeting / raid_item / timesheet_entry / invoice / rate_card /
//  partner_firm / win_theme / win_loss_debrief / brief / agent_design /
//  renewal). Each entry is a thin wrapper consumed by the propose_write
// dispatcher in `write-dispatch.ts`.
import "./coverage-capabilities.js";
// Task #159 — contract lifecycle (prepare / send-for-signature / status).
import "./contract-capabilities.js";
// Task #405 — Me-lens self-service reads (leave, payslips, contract,
// reviews/goals, learning, notifications, profile). Every entry is
// identity-locked: empty input schema + subject always resolved from
// the session persona, never from model-supplied arguments.
import "./me-capabilities.js";
// Task #583 — Me-lens self-service WRITES (leave request, expense
// create + receipt, timesheet log/submit, profile edit, personal
// documents, notification dismiss). Identity-locked + confirm-gated.
import "./me-write-capabilities.js";
// Task #406 — read-only finance reports (P&L/BS/CF/profitability),
// entity expiries, win/loss knowledge, manager-scoped leave queues, and
// contract/template browsing. Mirrors REST ACLs with explicit refusals.
import "./finance-ops-capabilities.js";
// Task #404 — read-only people / contact / meeting / document /
// opportunity / engagement / expense chat reads (ACL-parity with REST).
import "./people-read-capabilities.js";
// Task #553 — internal-meeting scheduling assistant (Microsoft calendars).
import "./internal-meeting-capabilities.js";
// Task #570 — read-only availability / free-slot lookups.
import "./meeting-availability-capabilities.js";
// Task #568 — client meetings from chat: attach to an opportunity or
// engagement (account references disambiguate), invite client contacts
// by email + roster colleagues, same availability/preview/confirm flow.
import "./client-meeting-capabilities.js";
// Task #526 — Alliance partner chat flow: "add alliance partner <X>"
// (dedupe → candidate/agreed clarification → confirm → create + launch
// Alliance Cartographer, mapper auto-chains) + evaluation read.
import "./alliance-partner-capabilities.js";
// Email COMPANY documents from the Document Library to named recipients
// ("email our registration certificate to Gokhan") — visibility-scoped
// via canSeeDocument, recipients resolved against roster + CRM contacts.
import "./document-email-capabilities.js";
// Task #706 — travel search (Duffel flights + Stays, Airbnb deep links).
// Read-only; booking is a deep-link handoff in v1.
import "./travel-capabilities.js";
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

# UAT — Atelier Chat: Client & Opportunity Management

Date: 2026-07-09 · Scope: all chat-reachable functionality for client (account) and opportunity management, including the chat turn protocol itself.

## Test layers

| Layer | What it validates | How executed |
| --- | --- | --- |
| L1 Capability | Every account/opportunity/contact chat capability contract: inputs, two-phase confirm envelope, RBAC, validation, side effects | In-process `catalog.run(input, ctx)` probes + existing `test:crm` suite (mocked agents) |
| L2 Turn protocol | SSE frames, needs_confirmation → confirm/cancel endpoints, idempotent confirm, clientTurnKey replay, audit rows | HTTP against running api-server (`test:cli` + new probes) |
| L3 Live NL turns | Intent routing, clarification/continuation, disambiguation, pageContext grounding, graceful failure (real Claude) | Small curated set over HTTP SSE |

Personas: `founding_partner` (full authority), `consultant` (create-denied), `partner_firm_resource` (restricted scope), `board_observer` (read-only, no CRM writes).

## Scenario matrix

### A. Client (account) management

| ID | Scenario | Expected |
| --- | --- | --- |
| A1 | Create account via chat, two-phase (propose → confirm) | Phase 1 returns confirm envelope; phase 2 with `confirm:true` creates row + audit event |
| A2 | Create with missing required field (e.g. country) | `needs_clarification` with field + question; continuation merges answer and completes |
| A3 | Create duplicate name | Duplicate rejected or flagged, no silent second row |
| A4 | Create as `consultant` / `board_observer` | Denied with explicit permission error, no row |
| A5 | Create with over-cap field values (prefill clamp) | Values clamped or clean validation error — never opaque 400 |
| A6 | Resolve account by name: exact, fuzzy, ambiguous | Exact/fuzzy resolves; ambiguous → disambiguation options |
| A7 | Account dossier read | Returns dossier for in-scope account; denied out-of-scope |
| A8 | Account changes/history read | Recent changes projection returned |
| A9 | Update account fields (valid, invalid, out-of-scope) | Valid persists + audit; invalid → clean error; out-of-scope denied |
| A10 | Archive → restore lifecycle | Archive reversible; restore returns child state; idempotency handled |
| A11 | Permanent delete | `founding_partner` only; financial gate honored; idempotent |
| A12 | Merge accounts (survivor + duplicate) | Dup archived, idempotent `already_merged`, RBAC enforced |
| A13 | Cartographer profile update decision (accept/reject) | Decision persists, audit trail |
| A14 | Refresh cartographer (mocked agent) | Run recorded; degraded path handled without STOP |
| A15 | Firmographics update + history/revert (REST parity) | History projection + revert re-PATCH works |

### B. Contacts (client-side)

| ID | Scenario | Expected |
| --- | --- | --- |
| B1 | Contact create (confirm envelope, account scoping) | Two-phase; row scoped to account |
| B2 | Contact update/delete out-of-scope persona | Denied (403-equivalent), no mutation |
| B3 | Reports-to relationship create/delete | Edge created/removed; cycle-safety maintained |
| B4 | Contact disposition update | Persists + audit |

### C. Opportunity management

| ID | Scenario | Expected |
| --- | --- | --- |
| C1 | Create opp: phase 1 missing fields → follow-up; phase 2 confirm | Two-phase completes; `dealSizeUsd → dealSizeHypothesis` parity holds |
| C2 | Create with scout disabled/failed | Committed create surfaces structured `scout.status`, never rollback |
| C3 | Edit opp fields (probability, deal size); no-op edit | Edits persist; no-op handled gracefully |
| C4 | Move stage: legal transition, contract=won invariant, illegal transition | Legal moves persist; illegal rejected with reason |
| C5 | Qualifier update + rubric gate | "Decline" band blocks go decision unless partner override |
| C6 | Archive opp (two-phase, then act on archived) | Archived; second archive/edit on gone entity → clean error |
| C7 | List by stage / pipeline read | Correct scoping per persona |
| C8 | Win/loss debrief create/update | Persists; role gates honored |
| C9 | Capture meeting / draft POV (mocked agents) | Runs recorded; outputs linked to opp |

### D. Chat turn protocol (HTTP SSE)

| ID | Scenario | Expected |
| --- | --- | --- |
| D1 | Read-only NL turn | `final` frame; turn row persisted; `cli.turn` audit; no mutation |
| D2 | NL write → needs_confirmation → confirm endpoint | Commit + `cli.turn.confirmed` audit |
| D3 | Cancel endpoint | pendingWrite cleared, status=cancelled |
| D4 | Replay confirm on finished turn | Idempotent final frame, no second insert |
| D5 | clientTurnKey replay | Original frames returned, no new turn row |
| D6 | NL clarification → continuation turn | Answer merged at top level; draft preserved |
| D7 | NL ambiguous entity → disambiguation | Options frame; selection completes action |
| D8 | Denied persona over HTTP | Clean permission message, no 5xx |
| D9 | pageContext grounding (accountId/oppId) | "this account/opportunity" resolves from context |
| D10 | Nonsense/off-domain prompt | Graceful response, no crash/hang |

### E. Cross-cutting

| ID | Scenario | Expected |
| --- | --- | --- |
| E1 | Undo last action | Reverses last write; audit |
| E2 | Audit events on every write path | Present with correct payloads |
| E3 | Org/scope filtering of lists for restricted persona | Only in-scope rows |

## Results

_To be filled during execution._

## Findings & root cause analysis

_To be filled after execution._

## Fix plan

_To be filled after RCA._

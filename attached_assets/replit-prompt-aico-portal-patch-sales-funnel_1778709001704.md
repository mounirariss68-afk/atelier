# Replit Build Prompt — Patch to v2: AICo's 5-Stage Sales Funnel

**For:** AICo (working name "Maven AI").
**Authored:** May 12 2026 — Mounir Ariss with Claude.
**Type:** Patch document. Modifies the v2 PRD (`replit-prompt-aico-employee-portal-v2.md`) §2.3, §2.6, §5 (reports), §6 (Pipeline Forecaster), §7.3 (acceptance criteria), and the seed data.
**Status:** Drop-in patch. Apply during the v2 build, or as a follow-up if v2 has already shipped.

---

## How to use this document

Paste everything below `<<<REPLIT PROMPT BEGINS>>>` into Replit's AI Agent on the same repo as v1 + v2. The agent will rename and re-map the sales-funnel stages, update kanban columns, funnel charts, reports, and seed data, and write a Drizzle migration that preserves all existing opportunity history.

The decision in plain terms:

| Old (v2 §2.3 — 10 stages) | New (this patch — 5 stages) |
|---|---|
| Lead | **Suspect** |
| Qualified | **Prospect** |
| Discovery scheduled | **Prospect** |
| POV in flight | **Convert** |
| Proposal in flight | **Convert** |
| Submitted | **Convert** |
| Verbal commit | **Runner** |
| Signed | **Contract** |
| Lost / No-decision | (unchanged) |
| Withdrawn / No-go | (unchanged) |

The five active stages become the primary funnel taxonomy. The finer-grained activity of the old stages survives as an optional **`sub_status`** field on the opportunity, used by the Pipeline Forecaster and the kanban-card hover, but never as a stage. The kanban and the funnel chart show **only five columns**.

---

<<<REPLIT PROMPT BEGINS>>>

# Project Patch: 5-Stage Sales Funnel

Replace v2's 10-stage opportunity lifecycle with AICo's 5-stage funnel. Everything else in v2's CRM design (account-based selling, qualification, pricing, win/loss, forecasting) is unchanged — only the **stage taxonomy** changes.

Inherit all v1 + v2 non-negotiables (agents prepare, humans commit; show the work; source-grounded; partner authority lock; immutable audit).

---

## 1. The 5 stages — definitions, gate criteria, defaults

| # | Stage | Definition (in plain words) | PLM stage | Default stage % | Exit criteria (gate to advance) |
|---|---|---|---|---|---|
| 1 | **Suspect** | A named target inside our ICP who we *suspect* could become a buyer. Interest is unverified. We are researching, mapping decision-makers, and shaping a hypothesis. | Identify | **5%** | Account confirmed in-ICP, buyer hypothesized, Partner-of-account named, **5C Qualify verdict = GO**. |
| 2 | **Prospect** | A qualified opportunity. The buyer has a verified need, authority, and a hypothesized budget. We have engaged them — discovery meeting held, POV draft shared or in flight, value hypothesis logged. | Shape | **20%** | Client problem articulated by the client (their words, captured in a meeting); POV approved by Partner; budget signal logged; first proposal ask received or scoped. |
| 3 | **Convert** | We are actively converting. Proposal drafted, pricing approved, ROI demonstrated, objections being navigated. The Partner is in commercial conversations with the buyer. | Pursue | **50%** | Proposal submitted; client engaged in commercial conversation; objections being navigated; Pricing Strategist margin chip is at least AMBER (RED requires two-Partner sign-off to remain in Convert). |
| 4 | **Runner** | The deal is verbally won and *running* through legal review, redlines, procurement, internal sign-offs, and signature collection. No more substantive selling — the work now is to keep momentum and resolve paperwork. | Pursue → Mobilize | **80%** | Client verbal accept logged with date + named decider; legal terms in draft; signature path mapped (named signatories + sequence). |
| 5 | **Contract** | The deal is official. A binding instrument (LOI, SOW, or MSA) is signed by AICo and the client. The engagement is born. | Mobilize | **100%** | Fully executed instrument file uploaded; engagement entity created via mobilization flow; charter underway. |
|  | **Lost** | The client picked another path (another vendor, or status quo, or another internal team). | — | **0%** | Closed; Win/Loss debrief triggered. |
|  | **No-Decision** | The client did not pick anyone; the buying process stalled past the configured threshold. | — | **0%** | Closed; Win/Loss debrief triggered with `hidden_competitor = status_quo`. |
|  | **Withdrawn** | AICo withdrew (qualification verdict changed, capacity gap, conflict, or strategic call). | — | **0%** | Closed with documented reason; no Win/Loss debrief required but a Withdrawal note is mandatory. |

### Notes on Runner

"Runner" is intentionally distinct from "Convert" — they describe fundamentally different work modes:

- In **Convert**, the firm is still selling. The Partner is in the buyer's office demonstrating value.
- In **Runner**, the firm is shepherding paper. The Partner is on the phone with procurement, redlining the SOW, chasing signatures. The deal is *running* — fast, with no more selling to do.

Conflating the two stages hides the most common stall point in GCC enterprise sales: deals that look verbally won but die in procurement. By giving Runner its own stage, the portal surfaces aged-Runner opportunities as a distinct risk class.

### Sub-status (optional, not a stage)

For finer tracking within a stage, an opportunity may carry an optional `sub_status` text label. The Pipeline Forecaster surfaces it on hover; reports filter on it; but the kanban and the funnel chart never split by it. Suggested sub-status values per stage:

| Stage | Common sub-statuses (free text; suggested values) |
|---|---|
| Suspect | `researching`, `outreach_drafted`, `awaiting_first_response` |
| Prospect | `discovery_scheduled`, `discovery_done`, `pov_in_flight`, `pov_shared`, `value_hypothesis_logged` |
| Convert | `proposal_drafting`, `proposal_submitted`, `clarifications`, `presenting_to_committee`, `pricing_negotiation` |
| Runner | `legal_redlines`, `procurement_review`, `awaiting_signature`, `signature_chain_in_flight` |
| Contract | `signed_kickoff_scheduled`, `mobilizing` |

The sub-status is captured at every stage transition and editable on the opportunity workspace via a small inline editor next to the stage chip.

---

## 2. Schema changes

### 2.1 Replace `opportunities.sales_stage` enum

```ts
// before (v2):
sales_stage: 'lead' | 'qualified' | 'discovery_scheduled' | 'pov_in_flight'
            | 'proposal_in_flight' | 'submitted' | 'verbal_commit' | 'signed'
            | 'lost' | 'no_decision' | 'withdrawn'

// after (this patch):
sales_stage: 'suspect' | 'prospect' | 'convert' | 'runner' | 'contract'
            | 'lost' | 'no_decision' | 'withdrawn'
```

### 2.2 Add `opportunities.sub_status` and `opportunities.runner_entered_at`

```ts
sub_status: text                         // nullable; per-stage editable
runner_entered_at: timestamptz           // set when sales_stage flips to 'runner'; null otherwise
contract_signed_at: timestamptz          // set when sales_stage flips to 'contract'
```

`runner_entered_at` powers the **Runner aging report** (§4) — the most important hygiene view this patch adds.

### 2.3 Update `opportunity_stage_transitions`

No schema change; the `from_stage` and `to_stage` columns simply now carry the new enum values. The migration (§3) re-maps historical rows.

### 2.4 Keep `plm_stage` derived

The PLM stage (Identify / Shape / Pursue / Mobilize / Deliver / Compound) remains a generated column. The mapping is:

```
suspect    → identify
prospect   → shape
convert    → pursue
runner     → pursue
contract   → mobilize
lost       → (last active PLM before close, preserved as `final_plm_stage` text)
no_decision→ (same)
withdrawn  → (same)
```

---

## 3. Data migration

Write a Drizzle migration that:

1. Renames the enum type on `opportunities.sales_stage` and seeds the new values.
2. Adds `sub_status`, `runner_entered_at`, `contract_signed_at`, and `final_plm_stage` columns.
3. Re-maps every existing opportunity:
   - `lead` → `suspect`, `sub_status = null`
   - `qualified` → `prospect`, `sub_status = 'qualified_pre_discovery'`
   - `discovery_scheduled` → `prospect`, `sub_status = 'discovery_scheduled'`
   - `pov_in_flight` → `prospect`, `sub_status = 'pov_in_flight'`
   - `proposal_in_flight` → `convert`, `sub_status = 'proposal_drafting'`
   - `submitted` → `convert`, `sub_status = 'proposal_submitted'`
   - `verbal_commit` → `runner`, `sub_status = 'awaiting_signature'`, `runner_entered_at = transitioned_at` (best guess from history) or `now()` if unknown
   - `signed` → `contract`, `contract_signed_at = transitioned_at` or `now()`
   - `lost` / `no_decision` / `withdrawn` → unchanged; `final_plm_stage` set from prior PLM
4. Re-maps the `opportunity_stage_transitions.from_stage` and `to_stage` history (preserve a `legacy_stage_label` text column on each row recording the original label for audit).
5. Updates the stage % defaults (§1) in the firm configuration table.
6. Re-runs the Pipeline Forecaster once so weighted-value rolls reflect the new % defaults.

Migration must be **idempotent** (safe to re-run) and write to the immutable audit log: one `audit_events` row per remapped opportunity recording the old and new values.

---

## 4. UI changes

### 4.1 Pipeline kanban (`/crm/opportunities`)

Replace the kanban columns. Five active columns + a closed lane:

```
[ Suspect ] [ Prospect ] [ Convert ] [ Runner ] [ Contract ]   |   [ Closed (Lost · No-Decision · Withdrawn) ]
```

Each column header shows: stage name, count, total weighted USD value, and a small stage % badge (5 / 20 / 50 / 80 / 100). Closed column groups by outcome with a tab switcher.

Card content (unchanged from v2 layout, with two additions):
- Sub-status chip directly under the deal name (gold-bordered, small).
- For Runner cards, an **age indicator** in days since `runner_entered_at`. ≥ 21 days → AMBER border; ≥ 45 days → RED border.

### 4.2 Funnel chart in reports

Replace any v2 funnel chart (the 10-stage waterfall in §5 report 1) with a 5-stage funnel. The funnel renders as a clean inverted pyramid: Suspect → Prospect → Convert → Runner → Contract, with conversion rates between adjacent stages.

A second variant — the **Runner aging funnel** — splits Runner into three bands (≤ 21 d / 21–45 d / > 45 d) and shows the conversion rate from each band to Contract. This is the new view that surfaces procurement-stuck deals.

### 4.3 Opportunity workspace stage strip

The horizontal stage history strip on the opportunity workspace renders the five stages as gold-rimmed circles, with the active stage filled gold. Sub-status sits in a small italic label beneath the active circle. Hovering any historical stage shows the transition rationale and the sub-status it ended on.

### 4.4 Stage transition modal

The "Move stage" modal now offers the 5 stages. When the user picks **Runner**, the modal requires three fields (per the Runner gate criteria in §1): named decider, verbal-commit date, and a 1-line signature-path map. The Pipeline Forecaster blocks the transition until those are filled.

When the user picks **Contract**, the modal requires the executed instrument file upload (LOI, SOW, or MSA). On confirmation, the system fires the Charter Architect agent (v1) and creates the Engagement record.

---

## 5. Reports patch

Patch the v2 §5 report list:

1. **Report 1 — "Pipeline by stage (funnel)"** — replace 10-stage waterfall with 5-stage funnel (per §4.2 above).
2. **NEW Report 1b — "Runner aging funnel"** — adds the band split per §4.2. This is the report Partners will look at every Monday.
3. **Report 2 — "Forecast roll-up by Partner"** — no schema change; the underlying stages just collapse from 10 to 5.
4. **Report 3 — "Margin watch"** — unchanged.
5. **Report 4 — "Account heat map"** — unchanged.
6. **Report 5 — "Win/loss rate by offering"** — unchanged.
7. **Report 6 — "Hidden competitor distribution"** — unchanged.
8. **Report 7 — "Salon engagement health"** — unchanged.
9. **Report 8 — "Atelier reuse leaderboard"** — unchanged.
10. **Report 9 — "Senior-delivery proof"** — unchanged.
11. **NEW Report 10 — "Convert-to-Runner conversion by Partner"** — measures how many Convert deals each Partner pushes into Runner per quarter. A core BD discipline metric.
12. **NEW Report 11 — "Runner-to-Contract closure time"** — measures days from `runner_entered_at` to `contract_signed_at` by client, by sector, by procurement type. Critical for negotiating realistic close dates with the firm and with investors.

---

## 6. Agent patches

### 6.1 Pipeline Forecaster (v2 §6 — patched)

- Treats Runner as a first-class stage with its own miscalibration heuristics. Specifically, Runner > 30 days with no `last_client_touch` event → recommends reverting to Convert with a rationale prompt.
- The 5C Qualify gate is now run on **Suspect → Prospect** (was Shape → Pursue in v2). A Suspect cannot be promoted to Prospect until a 5C verdict is GO.

### 6.2 Pursuit Scout (v1 §8.4.1 — patched)

- Adds a `target_stage_at_creation` input parameter (default `suspect`). When the Scout produces an opportunity brief and the user creates an opportunity from it, the opportunity defaults to Suspect.

### 6.3 Proposal Composer (v1 §8.4.3 — patched)

- The "Send to client" action now flips `sales_stage` from Convert → (auto-stays in Convert with `sub_status = 'proposal_submitted'`). Manual stage advance to Runner remains a human action with the gate fields.

### 6.4 Charter Architect (v1 §8.4.5 — patched)

- Fires automatically when `sales_stage` transitions to **Contract** (was `signed` in v2).

### 6.5 Win/Loss Interviewer (v2 §6.1.3 — patched)

- Triggers when `sales_stage` transitions to **Lost** or **No-Decision** (was `lost` or `no_decision` in v2 — name change only).

---

## 7. Seed data

Update v2 seed data so the seeded pipeline reflects the new stages. The seeded distribution (covers all stages with realistic GCC accounts):

| Account | Sales stage | Sub-status | Deal size hypothesis | Runner aged |
|---|---|---|---|---|
| Tahakom | Suspect | researching | $1.8M | — |
| NHC | Suspect | outreach_drafted | $900K | — |
| Dubai Municipality (Workstream 2) | Prospect | discovery_done | $1.4M | — |
| STC | Prospect | pov_in_flight | $2.1M | — |
| DGE Effortless 2.0 | Convert | proposal_submitted | $2.6M | — |
| Aldrees (BOQ next phase) | Convert | clarifications | $700K | — |
| Tasama (Agentic BPO Phase 2) | Runner | legal_redlines | $1.9M | 8 days |
| (anonymous PIF subsidiary) | Runner | awaiting_signature | $1.1M | **31 days (AMBER)** |
| Tasama Agentic BPO Phase 1 | Contract | mobilizing | $2.3M | — |
| (anonymous KSA telco) | Lost | competitor_won | $1.7M | — |
| (anonymous UAE BFSI) | No-Decision | status_quo | $850K | — |
| (anonymous KSA real estate) | Withdrawn | capacity_conflict | $600K | — |

---

## 8. Acceptance criteria (extends v2 §7.3)

A reviewer should be able to:

1. Open `/crm/opportunities` and see exactly **five** active kanban columns plus a closed lane.
2. Drag a card from Suspect to Prospect and be required to record the 5C Qualify verdict before the transition completes.
3. Drag a card from Convert to Runner and be required to fill named decider + verbal-commit date + signature-path map; the transition fails if any field is missing.
4. Drag a card from Runner to Contract and be required to upload an executed instrument file; on success, see the Engagement record auto-created and the Charter Architect run.
5. Open `/forecast` and see the 5-stage funnel chart with conversion rates between adjacent stages.
6. Open the Runner aging report and see at least one AMBER-flagged Runner deal aged > 21 days.
7. Open an opportunity that was in `verbal_commit` before this patch and confirm it's now in **Runner** with `runner_entered_at` set and the legacy stage label preserved in the audit feed.
8. Edit an opportunity's sub-status inline on the kanban card and see the change reflected on hover and in the opportunity workspace stage strip.
9. Run a saved report from before the patch ("Mounir's Monday morning") and see it correctly aggregate against the new 5-stage taxonomy without errors.

---

## 9. Out of scope for this patch

- Adding new stages beyond the five (e.g., "Aftercare" or "Onboarding") — engagement lifecycle continues in The Atelier post-Contract, not in the funnel.
- Changing the closed-state taxonomy (Lost / No-Decision / Withdrawn) — unchanged.
- Changing the 5C Qualify model — unchanged.
- Changing pricing, win/loss, account, or Salon modules — unchanged.

---

## 10. Build order

1. Migration + enum changes + new columns.
2. Audit-log entries for every remapped opportunity.
3. Kanban columns + card chip changes.
4. Stage transition modal (Runner + Contract gate fields).
5. Pipeline Forecaster patches.
6. Funnel chart + Runner aging report + Convert-to-Runner + Runner-to-Contract reports.
7. Seed data refresh.
8. Acceptance walkthrough; ship.

---

## 11. North star for this patch (paste into first system prompt)

> AICo's pipeline runs on five words: **Suspect, Prospect, Convert, Runner, Contract**. Each word means something specific. Suspect is research. Prospect is qualification. Convert is selling. Runner is paperwork. Contract is the start of the work. The portal must surface the difference between Convert and Runner relentlessly — most deals in GCC don't die in selling, they die in procurement, and the firm wins by being the firm that knows the difference.

<<<REPLIT PROMPT ENDS>>>

---

*End of patch. Sequence: apply after v2 ships (or alongside the v2 build if not yet shipped). Pairs cleanly with the proposal-system patch and the v4 finance work to follow.*
